"use strict";
const { access, readFile, writeFile } = require("fs").promises;
const { watch } = require("fs");
const { join } = require("path");
const { promisify } = require("util");
const zlib = require("node:zlib");
const dgram = require("dgram");
const crypto = require("crypto");
const msgpack = require("@msgpack/msgpack");
const { encryptBinary, decryptBinary, validateSecretKey } = require("./crypto");
const { encodeDelta, decodeDelta, getAllPaths, PATH_CATEGORIES } = require("./pathDictionary");
const Monitor = require("ping-monitor");

// Promisify zlib functions for async/await
const brotliCompressAsync = promisify(zlib.brotliCompress);
const brotliDecompressAsync = promisify(zlib.brotliDecompress);

/**
 * Circular buffer for efficient history tracking
 */
class CircularBuffer {
  constructor(size) {
    this.buffer = new Array(size);
    this.size = size;
    this.index = 0;
    this.filled = false;
  }

  push(item) {
    this.buffer[this.index] = item;
    this.index = (this.index + 1) % this.size;
    if (this.index === 0) {
      this.filled = true;
    }
  }

  toArray() {
    if (!this.filled) {
      return this.buffer.slice(0, this.index);
    }
    return [...this.buffer.slice(this.index), ...this.buffer.slice(0, this.index)];
  }

  get length() {
    return this.filled ? this.size : this.index;
  }
}

module.exports = function createPlugin(app) {
  // Constants - extracted magic numbers
  const DEFAULT_DELTA_TIMER = 1000; // milliseconds
  const PING_TIMEOUT_BUFFER = 10000; // milliseconds - extra buffer for ping timeout
  const MILLISECONDS_PER_MINUTE = 60000;
  const MAX_DELTAS_BUFFER_SIZE = 1000; // prevent memory leaks
  const FILE_WATCH_DEBOUNCE_DELAY = 300; // milliseconds - debounce delay for file watcher events
  const MAX_SAFE_UDP_PAYLOAD = 1400; // Maximum safe UDP payload size (avoid fragmentation)
  const BROTLI_QUALITY_HIGH = 10; // Maximum Brotli compression quality
  const UDP_RETRY_MAX = 3; // Maximum UDP send retries
  const UDP_RETRY_DELAY = 100; // milliseconds - base retry delay
  const CONTENT_HASH_ALGORITHM = "md5"; // Faster than SHA-256 for file change detection

  // Smart batching constants - prevent UDP packets from exceeding MTU
  const SMART_BATCH_SAFETY_MARGIN = 0.85; // Target 85% of MTU (leaves room for variance)
  const SMART_BATCH_SMOOTHING = 0.2; // Rolling average weight (20% new, 80% old)
  const SMART_BATCH_INITIAL_ESTIMATE = 200; // Initial bytes-per-delta estimate
  const SMART_BATCH_MIN_DELTAS = 1; // Always allow at least 1 delta per packet
  const SMART_BATCH_MAX_DELTAS = 50; // Cap to prevent excessive batching latency

  const plugin = {};
  plugin.id = "signalk-data-connector";
  plugin.name = "Signal K Data Connector";
  plugin.description =
    "Server & client solution for encrypted compressed UDP data transfer between Signal K units";
  let unsubscribes = [];
  let localSubscription;
  let socketUdp;
  let readyToSend = false;
  let helloMessageSender;
  let pingTimeout;
  let pingMonitor;
  let deltaTimer;
  let deltaTimerTime = DEFAULT_DELTA_TIMER;
  let deltas = [];
  let deltasFixed = [];
  let timer = false;
  let pluginOptions; // Store options for access in event handlers
  let lastPacketTime = 0; // Track last packet send time for hello message suppression

  // Smart batching state - dynamically adjusts batch size to keep packets under MTU
  let avgBytesPerDelta = SMART_BATCH_INITIAL_ESTIMATE; // Rolling average of bytes per delta
  let maxDeltasPerBatch = Math.floor(
    (MAX_SAFE_UDP_PAYLOAD * SMART_BATCH_SAFETY_MARGIN) / SMART_BATCH_INITIAL_ESTIMATE
  ); // Calculated limit

  // Persistent storage file paths - initialized in plugin.start
  let deltaTimerFile;
  let subscriptionFile;
  let sentenceFilterFile;

  // Debounce timers for configuration file changes
  let deltaTimerDebounceTimer;
  let subscriptionDebounceTimer;
  let sentenceFilterDebounceTimer;

  // Track server mode status
  let isServerMode = false;

  // Track last file content hashes to prevent duplicate processing
  let lastDeltaTimerHash = null;
  let lastSubscriptionHash = null;
  let lastSentenceFilterHash = null;

  // Sentence filter - list of NMEA sentences to exclude (e.g., GSV, GSA)
  let excludedSentences = ["GSV"]; // Default: filter GSV (verbose satellite data)

  // Simple rate limiting for API endpoints
  const rateLimitMap = new Map(); // key: IP address, value: { count, resetTime }
  const RATE_LIMIT_WINDOW = 60000; // 1 minute
  const RATE_LIMIT_MAX_REQUESTS = 20; // 20 requests per minute per IP
  let rateLimitCleanupInterval; // Interval for cleaning up old rate limit entries

  // Metrics tracking
  const BANDWIDTH_HISTORY_MAX = 60; // Keep 60 data points (5 minutes at 5s intervals)
  const metrics = {
    startTime: Date.now(),
    deltasSent: 0,
    deltasReceived: 0,
    udpSendErrors: 0,
    udpRetries: 0,
    compressionErrors: 0,
    encryptionErrors: 0,
    subscriptionErrors: 0,
    lastError: null,
    lastErrorTime: null,
    // Bandwidth tracking
    bandwidth: {
      bytesOut: 0, // Compressed bytes sent
      bytesIn: 0, // Compressed bytes received
      bytesOutRaw: 0, // Raw bytes before compression
      bytesInRaw: 0, // Raw bytes after decompression
      packetsOut: 0,
      packetsIn: 0,
      lastBytesOut: 0, // For rate calculation
      lastBytesIn: 0,
      lastRateCalcTime: Date.now(),
      rateOut: 0, // bytes per second
      rateIn: 0,
      compressionRatio: 0, // percentage saved
      history: new CircularBuffer(BANDWIDTH_HISTORY_MAX) // Efficient circular buffer
    },
    // Path-level analytics
    pathStats: new Map(), // path -> { count, bytes, lastUpdate }
    // Smart batching metrics
    smartBatching: {
      earlySends: 0, // Sends triggered by reaching predicted batch limit
      timerSends: 0, // Sends triggered by timer
      oversizedPackets: 0, // Packets that exceeded MTU despite prediction
      avgBytesPerDelta: SMART_BATCH_INITIAL_ESTIMATE,
      maxDeltasPerBatch: Math.floor(
        (MAX_SAFE_UDP_PAYLOAD * SMART_BATCH_SAFETY_MARGIN) / SMART_BATCH_INITIAL_ESTIMATE
      )
    }
  };

  // eslint-disable-next-line no-unused-vars
  const setStatus = app.setPluginStatus || app.setProviderStatus;

  /**
   * Simple rate limiting middleware
   * @param {string} ip - Client IP address
   * @returns {boolean} True if request should be allowed, false if rate limit exceeded
   */
  function checkRateLimit(ip) {
    const now = Date.now();
    const clientData = rateLimitMap.get(ip);

    if (!clientData || now > clientData.resetTime) {
      // New client or window expired, reset counter
      rateLimitMap.set(ip, {
        count: 1,
        resetTime: now + RATE_LIMIT_WINDOW
      });
      return true;
    }

    if (clientData.count >= RATE_LIMIT_MAX_REQUESTS) {
      // Rate limit exceeded
      return false;
    }

    // Increment counter
    clientData.count++;
    return true;
  }

  /**
   * Publishes RTT (Round Trip Time) to local SignalK
   * @param {number} rttMs - RTT in milliseconds
   */
  function publishRtt(rttMs) {
    const rttDelta = {
      context: "vessels.self",
      updates: [
        {
          timestamp: new Date(),
          values: [
            {
              path: "networking.modem.rtt",
              value: rttMs / 1000 // Convert ms to seconds for SignalK
            }
          ]
        }
      ]
    };
    app.handleMessage(plugin.id, rttDelta);
  }

  /**
   * Resets all metrics to initial state
   * Used during plugin stop for clean restart
   */
  function resetMetrics() {
    metrics.startTime = Date.now();
    metrics.deltasSent = 0;
    metrics.deltasReceived = 0;
    metrics.udpSendErrors = 0;
    metrics.udpRetries = 0;
    metrics.compressionErrors = 0;
    metrics.encryptionErrors = 0;
    metrics.subscriptionErrors = 0;
    metrics.lastError = null;
    metrics.lastErrorTime = null;
    metrics.bandwidth.bytesOut = 0;
    metrics.bandwidth.bytesIn = 0;
    metrics.bandwidth.bytesOutRaw = 0;
    metrics.bandwidth.bytesInRaw = 0;
    metrics.bandwidth.packetsOut = 0;
    metrics.bandwidth.packetsIn = 0;
    metrics.bandwidth.lastBytesOut = 0;
    metrics.bandwidth.lastBytesIn = 0;
    metrics.bandwidth.lastRateCalcTime = Date.now();
    metrics.bandwidth.rateOut = 0;
    metrics.bandwidth.rateIn = 0;
    metrics.bandwidth.compressionRatio = 0;
    metrics.bandwidth.history = new CircularBuffer(BANDWIDTH_HISTORY_MAX);
    metrics.pathStats.clear();
  }

  /**
   * Handles successful ping response (used by 'up' and 'restored' events)
   * @param {Object} res - Ping response object
   * @param {string} eventName - Event name for logging ('up' or 'restored')
   * @param {number} pingIntervalTime - Ping interval in minutes
   */
  function handlePingSuccess(res, eventName, pingIntervalTime) {
    readyToSend = true;
    clearTimeout(pingTimeout);
    pingTimeout = setTimeout(
      () => {
        readyToSend = false;
      },
      pingIntervalTime * MILLISECONDS_PER_MINUTE + PING_TIMEOUT_BUFFER
    );
    // Publish ping RTT (Round Trip Time) to local SignalK
    if (res && res.time !== undefined) {
      publishRtt(res.time);
      app.debug(`Connection monitor: ${eventName} (RTT: ${res.time}ms)`);
    } else {
      app.debug(`Connection monitor: ${eventName}`);
    }
  }

  /**
   * Starts the rate limit cleanup interval
   * Called during plugin.start() to align with plugin lifecycle
   */
  function startRateLimitCleanup() {
    if (rateLimitCleanupInterval) {
      clearInterval(rateLimitCleanupInterval);
    }
    rateLimitCleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [ip, data] of rateLimitMap.entries()) {
        if (now > data.resetTime) {
          rateLimitMap.delete(ip);
        }
      }
    }, RATE_LIMIT_WINDOW);
  }

  // Valid configuration filenames
  const VALID_CONFIG_FILES = ["delta_timer.json", "subscription.json", "sentence_filter.json"];

  /**
   * Resolves a config filename to its full file path
   * @param {string} filename - Config filename (e.g., "delta_timer.json")
   * @returns {string|null} Full file path or null if invalid filename
   */
  function getConfigFilePath(filename) {
    if (!VALID_CONFIG_FILES.includes(filename)) {
      return null;
    }
    const fileMap = {
      "delta_timer.json": deltaTimerFile,
      "subscription.json": subscriptionFile,
      "sentence_filter.json": sentenceFilterFile
    };
    return fileMap[filename];
  }

  /**
   * Loads a configuration file from persistent storage
   * @param {string} filePath - Full path to the config file to load
   * @returns {Promise<Object|null>} Parsed JSON object or null if file doesn't exist or error occurs
   */
  async function loadConfigFile(filePath) {
    try {
      await access(filePath);
      const content = await readFile(filePath, "utf-8");
      return JSON.parse(content);
    } catch (err) {
      app.debug(`Config file not found or error loading ${filePath}: ${err.message}`);
      return null;
    }
  }

  /**
   * Saves configuration data to persistent storage
   * @param {string} filePath - Full path to the config file to save
   * @param {Object} data - Configuration data to save
   * @returns {Promise<boolean>} True if save was successful, false otherwise
   */
  async function saveConfigFile(filePath, data) {
    try {
      await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
      app.debug(`Configuration saved to ${filePath}`);
      return true;
    } catch (err) {
      app.error(`Error saving ${filePath}: ${err.message}`);
      return false;
    }
  }

  /**
   * Initializes persistent storage files with default values if they don't exist
   * @returns {Promise<void>}
   */
  async function initializePersistentStorage() {
    deltaTimerFile = join(app.getDataDirPath(), "delta_timer.json");
    subscriptionFile = join(app.getDataDirPath(), "subscription.json");
    sentenceFilterFile = join(app.getDataDirPath(), "sentence_filter.json");

    // Initialize delta timer file
    const deltaTimerData = await loadConfigFile(deltaTimerFile);
    if (!deltaTimerData) {
      await saveConfigFile(deltaTimerFile, { deltaTimer: DEFAULT_DELTA_TIMER });
      app.debug("Initialized delta_timer.json with default values");
    }

    // Initialize subscription file
    const subscriptionData = await loadConfigFile(subscriptionFile);
    if (!subscriptionData) {
      await saveConfigFile(subscriptionFile, {
        context: "*",
        subscribe: [{ path: "*" }]
      });
      app.debug("Initialized subscription.json with default values");
    }

    // Initialize sentence filter file
    const sentenceFilterData = await loadConfigFile(sentenceFilterFile);
    if (!sentenceFilterData) {
      await saveConfigFile(sentenceFilterFile, {
        excludedSentences: ["GSV"]
      });
      app.debug("Initialized sentence_filter.json with default values");
    } else {
      // Load existing sentence filter
      excludedSentences = sentenceFilterData.excludedSentences || ["GSV"];
    }
  }

  /**
   * Schedules the delta timer recursively
   * @returns {void}
   */
  const scheduleDeltaTimer = () => {
    clearTimeout(deltaTimer);
    deltaTimer = setTimeout(() => {
      timer = true;
      scheduleDeltaTimer();
    }, deltaTimerTime);
  };

  /**
   * Handles delta timer configuration changes with debouncing
   * Debouncing prevents multiple rapid file changes from triggering multiple updates
   * @returns {void}
   */
  function handleDeltaTimerChange() {
    clearTimeout(deltaTimerDebounceTimer);
    deltaTimerDebounceTimer = setTimeout(async () => {
      try {
        const content = await readFile(deltaTimerFile, "utf-8");
        const contentHash = crypto.createHash(CONTENT_HASH_ALGORITHM).update(content).digest("hex");

        // Skip if content hasn't actually changed (prevents duplicate processing)
        if (contentHash === lastDeltaTimerHash) {
          app.debug("Delta timer file change detected but content unchanged, skipping");
          return;
        }
        lastDeltaTimerHash = contentHash;

        const deltaTimerConfig = JSON.parse(content);
        if (deltaTimerConfig && deltaTimerConfig.deltaTimer) {
          const newTimerValue = deltaTimerConfig.deltaTimer;

          // Validate range (100-10000ms)
          if (newTimerValue >= 100 && newTimerValue <= 10000) {
            if (deltaTimerTime !== newTimerValue) {
              deltaTimerTime = newTimerValue;
              clearTimeout(deltaTimer);
              scheduleDeltaTimer();
              app.debug(`Delta timer updated to ${deltaTimerTime}ms`);
            }
          } else {
            app.error(
              `Invalid delta timer value: ${newTimerValue}. Must be between 100 and 10000ms`
            );
          }
        }
      } catch (err) {
        app.error(`Error handling delta timer change: ${err.message}`);
      }
    }, FILE_WATCH_DEBOUNCE_DELAY);
  }

  /**
   * Handles subscription configuration changes with debouncing
   * Resubscribes to SignalK data streams when subscription config changes
   * @returns {void}
   */
  function handleSubscriptionChange() {
    clearTimeout(subscriptionDebounceTimer);
    subscriptionDebounceTimer = setTimeout(async () => {
      try {
        const content = await readFile(subscriptionFile, "utf-8").catch(() => null);

        // If file doesn't exist, use defaults
        const localSubscriptionNew = content
          ? JSON.parse(content)
          : {
            context: "*",
            subscribe: [{ path: "*" }]
          };

        // Use content hashing instead of JSON.stringify comparison
        const configString = JSON.stringify(localSubscriptionNew);
        const contentHash = crypto
          .createHash(CONTENT_HASH_ALGORITHM)
          .update(configString)
          .digest("hex");

        // Skip if content hasn't actually changed
        if (contentHash === lastSubscriptionHash) {
          app.debug("Subscription file change detected but content unchanged, skipping");
          return;
        }
        lastSubscriptionHash = contentHash;

        localSubscription = localSubscriptionNew;
        app.debug("Subscription configuration updated");
        app.debug(localSubscription);

        // Unsubscribe from previous subscriptions
        unsubscribes.forEach((f) => f());
        unsubscribes = [];

        // Subscribe to new configuration with error recovery
        try {
          app.subscriptionmanager.subscribe(
            localSubscription,
            unsubscribes,
            (subscriptionError) => {
              app.error("Subscription error: " + subscriptionError);
              readyToSend = false; // Stop sending data if subscription fails
              setStatus("Subscription error - data transmission paused");
              metrics.subscriptionErrors++;
              metrics.lastError = `Subscription error: ${subscriptionError}`;
              metrics.lastErrorTime = Date.now();
            },
            (delta) => {
              if (readyToSend) {
                // Filter out excluded sentences (configurable via sentence_filter.json)
                const sentence = delta?.updates?.[0]?.source?.sentence;
                if (sentence && excludedSentences.includes(sentence)) {
                  return; // Skip excluded sentences
                }

                // Prevent memory leak by limiting buffer size
                if (deltas.length >= MAX_DELTAS_BUFFER_SIZE) {
                  app.error(`Delta buffer overflow (${deltas.length} items), clearing buffer`);
                  deltas = [];
                }

                deltas.push(delta);
                setImmediate(() => app.reportOutputMessages());

                // Smart batching: send early if batch reaches predicted size limit
                if (deltas.length >= maxDeltasPerBatch) {
                  app.debug(
                    `Smart batch: sending ${deltas.length} deltas (reached predicted limit of ${maxDeltasPerBatch})`
                  );
                  metrics.smartBatching.earlySends++;
                  packCrypt(
                    deltas,
                    pluginOptions.secretKey,
                    pluginOptions.udpAddress,
                    pluginOptions.udpPort
                  );
                  deltas = [];
                  timer = false;
                } else if (timer) {
                  // Timer-based send (normal path)
                  metrics.smartBatching.timerSends++;
                  packCrypt(
                    deltas,
                    pluginOptions.secretKey,
                    pluginOptions.udpAddress,
                    pluginOptions.udpPort
                  );
                  app.debug(JSON.stringify(deltas, null, 2));
                  deltas = [];
                  timer = false;
                }
              }
            }
          );
        } catch (subscribeError) {
          app.error(`Failed to subscribe: ${subscribeError.message}`);
          readyToSend = false;
          setStatus("Failed to subscribe - data transmission paused");
          metrics.subscriptionErrors++;
          metrics.lastError = `Failed to subscribe: ${subscribeError.message}`;
          metrics.lastErrorTime = Date.now();
        }
      } catch (err) {
        app.error(`Error handling subscription change: ${err.message}`);
      }
    }, FILE_WATCH_DEBOUNCE_DELAY);
  }

  /**
   * Handles sentence filter configuration changes with debouncing
   * @returns {void}
   */
  function handleSentenceFilterChange() {
    clearTimeout(sentenceFilterDebounceTimer);
    sentenceFilterDebounceTimer = setTimeout(async () => {
      try {
        const content = await readFile(sentenceFilterFile, "utf-8");
        const contentHash = crypto.createHash(CONTENT_HASH_ALGORITHM).update(content).digest("hex");

        // Skip if content hasn't actually changed
        if (contentHash === lastSentenceFilterHash) {
          app.debug("Sentence filter file change detected but content unchanged, skipping");
          return;
        }
        lastSentenceFilterHash = contentHash;

        const filterConfig = JSON.parse(content);
        if (filterConfig && Array.isArray(filterConfig.excludedSentences)) {
          // Validate and normalize sentence names (uppercase, trimmed)
          excludedSentences = filterConfig.excludedSentences
            .map((s) => String(s).trim().toUpperCase())
            .filter((s) => s.length > 0);
          app.debug(`Sentence filter updated: excluding [${excludedSentences.join(", ")}]`);
        } else {
          app.error("Invalid sentence filter configuration: excludedSentences must be an array");
        }
      } catch (err) {
        app.error(`Error handling sentence filter change: ${err.message}`);
      }
    }, FILE_WATCH_DEBOUNCE_DELAY);
  }

  // Watcher recovery delay in milliseconds
  const WATCHER_RECOVERY_DELAY = 5000;

  /**
   * Creates a file watcher with automatic recovery on error
   * @param {string} filePath - Path to the file to watch
   * @param {Function} onChange - Callback function when file changes
   * @param {string} name - Human-readable name for logging
   * @returns {Object} Object with watcher property and close method
   */
  function createWatcherWithRecovery(filePath, onChange, name) {
    const watcherObj = { watcher: null };

    function createWatcher() {
      try {
        watcherObj.watcher = watch(filePath, (eventType) => {
          if (eventType === "change") {
            app.debug(`${name} configuration file changed`);
            onChange();
          }
        });

        watcherObj.watcher.on("error", (error) => {
          app.error(`${name} watcher error: ${error.message}`);
          if (watcherObj.watcher) {
            watcherObj.watcher.close();
            watcherObj.watcher = null;
          }
          // Attempt to recreate watcher after delay
          setTimeout(() => {
            app.debug(`Attempting to recreate ${name} watcher...`);
            createWatcher();
            if (watcherObj.watcher) {
              app.debug(`${name} watcher recreated successfully`);
            }
          }, WATCHER_RECOVERY_DELAY);
        });

        return true;
      } catch (err) {
        app.error(`Failed to create ${name} watcher: ${err.message}`);
        return false;
      }
    }

    createWatcher();

    return {
      get watcher() {
        return watcherObj.watcher;
      },
      close() {
        if (watcherObj.watcher) {
          watcherObj.watcher.close();
          watcherObj.watcher = null;
        }
      }
    };
  }

  // Store watcher objects for cleanup
  let deltaTimerWatcherObj = null;
  let subscriptionWatcherObj = null;
  let sentenceFilterWatcherObj = null;

  /**
   * Sets up file system watchers for configuration files
   * Uses fs.watch for efficient event-driven configuration reloading
   * @returns {void}
   */
  function setupConfigWatchers() {
    try {
      // Watch delta_timer.json for changes
      deltaTimerWatcherObj = createWatcherWithRecovery(
        deltaTimerFile,
        handleDeltaTimerChange,
        "Delta timer"
      );

      // Watch subscription.json for changes
      subscriptionWatcherObj = createWatcherWithRecovery(
        subscriptionFile,
        handleSubscriptionChange,
        "Subscription"
      );

      // Watch sentence_filter.json for changes
      sentenceFilterWatcherObj = createWatcherWithRecovery(
        sentenceFilterFile,
        handleSentenceFilterChange,
        "Sentence filter"
      );

      // Load initial subscription configuration
      handleSubscriptionChange();

      app.debug("Configuration file watchers initialized");
    } catch (err) {
      app.error(`Error setting up config watchers: ${err.message}`);
      app.error("Falling back to polling mode would require manual intervention");
    }
  }

  /**
   * Calculates bandwidth rates and updates history (optimized with circular buffer)
   */
  function updateBandwidthRates() {
    const now = Date.now();
    const elapsed = (now - metrics.bandwidth.lastRateCalcTime) / 1000; // seconds

    if (elapsed > 0) {
      const bytesDeltaOut = metrics.bandwidth.bytesOut - metrics.bandwidth.lastBytesOut;
      const bytesDeltaIn = metrics.bandwidth.bytesIn - metrics.bandwidth.lastBytesIn;

      metrics.bandwidth.rateOut = Math.round(bytesDeltaOut / elapsed);
      metrics.bandwidth.rateIn = Math.round(bytesDeltaIn / elapsed);

      // Update compression ratio (client: bytesOut/bytesOutRaw, server: bytesIn/bytesInRaw)
      if (isServerMode && metrics.bandwidth.bytesInRaw > 0) {
        metrics.bandwidth.compressionRatio = Math.round(
          (1 - metrics.bandwidth.bytesIn / metrics.bandwidth.bytesInRaw) * 100
        );
      } else if (!isServerMode && metrics.bandwidth.bytesOutRaw > 0) {
        metrics.bandwidth.compressionRatio = Math.round(
          (1 - metrics.bandwidth.bytesOut / metrics.bandwidth.bytesOutRaw) * 100
        );
      }

      // Add to circular buffer history (no need to trim, it's automatic)
      metrics.bandwidth.history.push({
        timestamp: now,
        rateOut: metrics.bandwidth.rateOut,
        rateIn: metrics.bandwidth.rateIn,
        compressionRatio: metrics.bandwidth.compressionRatio
      });

      metrics.bandwidth.lastBytesOut = metrics.bandwidth.bytesOut;
      metrics.bandwidth.lastBytesIn = metrics.bandwidth.bytesIn;
      metrics.bandwidth.lastRateCalcTime = now;
    }
  }

  /**
   * Tracks path-level statistics (optimized - accepts precomputed size)
   * @param {Object} delta - The delta object to analyze
   * @param {number} deltaSize - Precomputed delta size (optional, for performance)
   */
  function trackPathStats(delta, deltaSize = null) {
    if (!delta || !delta.updates) {
      return;
    }

    // Use provided size or calculate if not provided (but avoid in hot path)
    const size = deltaSize !== null ? deltaSize : JSON.stringify(delta).length;

    for (const update of delta.updates) {
      if (update.values) {
        for (const value of update.values) {
          if (value.path) {
            const path = value.path;
            const stats = metrics.pathStats.get(path) || { count: 0, bytes: 0, lastUpdate: 0 };
            stats.count++;
            stats.bytes += Math.round(size / update.values.length); // Approximate bytes per path
            stats.lastUpdate = Date.now();
            metrics.pathStats.set(path, stats);
          }
        }
      }
    }
  }

  /**
   * Formats bytes to human readable string
   * @param {number} bytes - Number of bytes
   * @returns {string} Formatted string
   */
  function formatBytes(bytes) {
    if (bytes === 0) {
      return "0 B";
    }
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  /**
   * Get top N paths by bytes (optimized partial sort)
   * @param {Map} pathStats - Path statistics map
   * @param {number} n - Number of top paths to return
   * @param {number} uptimeSeconds - Plugin uptime in seconds
   * @returns {Array} Top N paths sorted by bytes
   */
  function getTopNPaths(pathStats, n, uptimeSeconds) {
    const entries = Array.from(pathStats.entries());
    const result = [];

    for (const [path, stats] of entries) {
      const item = {
        path,
        count: stats.count,
        bytes: stats.bytes,
        bytesFormatted: formatBytes(stats.bytes),
        lastUpdate: stats.lastUpdate,
        updatesPerMinute: uptimeSeconds > 0 ? Math.round((stats.count / uptimeSeconds) * 60) : 0
      };

      if (result.length < n) {
        result.push(item);
        // Sort when we reach n items
        if (result.length === n) {
          result.sort((a, b) => b.bytes - a.bytes);
        }
      } else if (item.bytes > result[n - 1].bytes) {
        // Replace smallest item and maintain sort
        result[n - 1] = item;
        // Insertion sort for small n is faster than full sort
        for (let i = n - 1; i > 0 && result[i].bytes > result[i - 1].bytes; i--) {
          [result[i], result[i - 1]] = [result[i - 1], result[i]];
        }
      }
    }

    // Final sort if less than n items
    if (result.length < n && result.length > 0) {
      result.sort((a, b) => b.bytes - a.bytes);
    }

    return result;
  }

  // Register web routes - needs to be defined before start() is called
  plugin.registerWithRouter = (router) => {
    /**
     * Rate limiting middleware for API endpoints
     */
    const rateLimitMiddleware = (req, res, next) => {
      const clientIp = req.ip || (req.connection && req.connection.remoteAddress) || "unknown";
      if (!checkRateLimit(clientIp)) {
        return res.status(429).json({ error: "Too many requests, please try again later" });
      }
      next();
    };

    // Metrics endpoint (available in both client and server mode)
    router.get("/metrics", rateLimitMiddleware, (req, res) => {

      // Update rates before responding
      updateBandwidthRates();

      const uptime = Date.now() - metrics.startTime;
      const uptimeSeconds = Math.floor(uptime / 1000);
      const uptimeMinutes = Math.floor(uptimeSeconds / 60);
      const uptimeHours = Math.floor(uptimeMinutes / 60);

      // Get top 50 paths using optimized partial sort
      const pathStatsArray = getTopNPaths(metrics.pathStats, 50, uptimeSeconds);

      // Calculate total bytes for percentage
      const totalPathBytes = pathStatsArray.reduce((sum, p) => sum + p.bytes, 0);
      pathStatsArray.forEach((p) => {
        p.percentage = totalPathBytes > 0 ? Math.round((p.bytes / totalPathBytes) * 100) : 0;
      });

      const metricsData = {
        uptime: {
          milliseconds: uptime,
          seconds: uptimeSeconds,
          formatted: `${uptimeHours}h ${uptimeMinutes % 60}m ${uptimeSeconds % 60}s`
        },
        mode: isServerMode ? "server" : "client",
        stats: {
          deltasSent: metrics.deltasSent,
          deltasReceived: metrics.deltasReceived,
          udpSendErrors: metrics.udpSendErrors,
          udpRetries: metrics.udpRetries,
          compressionErrors: metrics.compressionErrors,
          encryptionErrors: metrics.encryptionErrors,
          subscriptionErrors: metrics.subscriptionErrors
        },
        status: {
          readyToSend: readyToSend,
          deltasBuffered: deltas.length
        },
        bandwidth: (() => {
          // Calculate avgPacketSize once for reuse
          const packets = isServerMode ? metrics.bandwidth.packetsIn : metrics.bandwidth.packetsOut;
          const bytes = isServerMode ? metrics.bandwidth.bytesIn : metrics.bandwidth.bytesOut;
          const avgPacketSize = packets > 0 ? Math.round(bytes / packets) : 0;

          return {
            bytesOut: metrics.bandwidth.bytesOut,
            bytesIn: metrics.bandwidth.bytesIn,
            bytesOutRaw: metrics.bandwidth.bytesOutRaw,
            bytesInRaw: metrics.bandwidth.bytesInRaw,
            bytesOutFormatted: formatBytes(metrics.bandwidth.bytesOut),
            bytesInFormatted: formatBytes(metrics.bandwidth.bytesIn),
            bytesOutRawFormatted: formatBytes(metrics.bandwidth.bytesOutRaw),
            packetsOut: metrics.bandwidth.packetsOut,
            packetsIn: metrics.bandwidth.packetsIn,
            rateOut: metrics.bandwidth.rateOut,
            rateIn: metrics.bandwidth.rateIn,
            rateOutFormatted: formatBytes(metrics.bandwidth.rateOut) + "/s",
            rateInFormatted: formatBytes(metrics.bandwidth.rateIn) + "/s",
            compressionRatio: metrics.bandwidth.compressionRatio,
            avgPacketSize,
            avgPacketSizeFormatted: avgPacketSize > 0 ? formatBytes(avgPacketSize) : "0 B",
            history: metrics.bandwidth.history.toArray().slice(-30) // Last 30 data points for chart
          };
        })(),
        pathStats: pathStatsArray,
        pathCategories: PATH_CATEGORIES,
        smartBatching: isServerMode
          ? null
          : {
            earlySends: metrics.smartBatching.earlySends,
            timerSends: metrics.smartBatching.timerSends,
            oversizedPackets: metrics.smartBatching.oversizedPackets,
            avgBytesPerDelta: metrics.smartBatching.avgBytesPerDelta,
            maxDeltasPerBatch: metrics.smartBatching.maxDeltasPerBatch
          },
        lastError: metrics.lastError
          ? {
            message: metrics.lastError,
            timestamp: metrics.lastErrorTime,
            timeAgo: metrics.lastErrorTime ? Date.now() - metrics.lastErrorTime : null
          }
          : null
      };

      res.json(metricsData);
    });

    // Signal K paths dictionary endpoint
    router.get("/paths", rateLimitMiddleware, (req, res) => {
      const paths = getAllPaths();
      const categorized = {};

      for (const [key, category] of Object.entries(PATH_CATEGORIES)) {
        categorized[key] = {
          ...category,
          paths: paths.filter((p) => p.startsWith(category.prefix))
        };
      }

      res.json({
        total: paths.length,
        categories: categorized
      });
    });

    // Plugin configuration endpoint - get current config
    router.get("/plugin-config", rateLimitMiddleware, (req, res) => {
      try {
        // Get current plugin configuration from SignalK
        const pluginConfig = app.readPluginOptions();
        res.json({
          success: true,
          configuration: pluginConfig.configuration || {}
        });
      } catch (error) {
        app.error(`Error reading plugin config: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Plugin configuration endpoint - save config
    router.post("/plugin-config", rateLimitMiddleware, async (req, res) => {
      // Validate Content-Type
      const contentType = req.headers["content-type"];
      if (!contentType || !contentType.includes("application/json")) {
        return res.status(415).json({ success: false, error: "Content-Type must be application/json" });
      }

      try {
        const newConfig = req.body;

        // Validate required fields
        if (!newConfig.serverType) {
          return res.status(400).json({ success: false, error: "serverType is required" });
        }
        if (!newConfig.udpPort || newConfig.udpPort < 1024 || newConfig.udpPort > 65535) {
          return res.status(400).json({ success: false, error: "Valid udpPort (1024-65535) is required" });
        }
        if (!newConfig.secretKey || newConfig.secretKey.length !== 32) {
          return res.status(400).json({ success: false, error: "secretKey must be exactly 32 characters" });
        }

        // Validate client-specific fields
        if (newConfig.serverType === "client") {
          if (!newConfig.udpAddress) {
            return res.status(400).json({ success: false, error: "udpAddress is required in client mode" });
          }
          if (!newConfig.testAddress) {
            return res.status(400).json({ success: false, error: "testAddress is required in client mode" });
          }
          if (!newConfig.testPort) {
            return res.status(400).json({ success: false, error: "testPort is required in client mode" });
          }
        }

        // Save configuration using SignalK API
        app.savePluginOptions({ configuration: newConfig }, (err) => {
          if (err) {
            app.error(`Error saving plugin config: ${err.message}`);
            res.status(500).json({ success: false, error: err.message });
          } else {
            res.json({
              success: true,
              message: "Configuration saved. Restart plugin to apply changes.",
              requiresRestart: true
            });
          }
        });
      } catch (error) {
        app.error(`Error saving plugin config: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get schema for configuration UI
    router.get("/plugin-schema", rateLimitMiddleware, (req, res) => {
      res.json({
        schema: plugin.schema,
        currentMode: isServerMode ? "server" : "client"
      });
    });

    /**
     * Middleware to check client mode and storage initialization
     */
    const clientModeMiddleware = (req, res, next) => {
      if (isServerMode) {
        return res.status(404).json({ error: "Not available in server mode" });
      }
      if (!deltaTimerFile || !subscriptionFile) {
        return res.status(503).json({ error: "Plugin not fully initialized" });
      }
      next();
    };

    // Config routes (only available in client mode)
    router.get("/config/:filename", rateLimitMiddleware, clientModeMiddleware, async (req, res) => {
      const filePath = getConfigFilePath(req.params.filename);
      if (!filePath) {
        return res.status(400).json({ error: "Invalid filename" });
      }

      res.contentType("application/json");
      const config = await loadConfigFile(filePath);
      res.send(JSON.stringify(config || {}));
    });

    router.post("/config/:filename", rateLimitMiddleware, clientModeMiddleware, async (req, res) => {
      // Validate Content-Type
      const contentType = req.headers["content-type"];
      if (!contentType || !contentType.includes("application/json")) {
        return res.status(415).json({ error: "Content-Type must be application/json" });
      }

      const filePath = getConfigFilePath(req.params.filename);
      if (!filePath) {
        return res.status(400).json({ error: "Invalid filename" });
      }

      const success = await saveConfigFile(filePath, req.body);
      if (success) {
        res.status(200).send("OK");
      } else {
        res.status(500).send("Failed to save configuration");
      }
    });
  };

  plugin.start = async function (options) {
    // Store options for access in event handlers
    pluginOptions = options;

    // Start rate limit cleanup interval (aligned with plugin lifecycle)
    startRateLimitCleanup();

    // Validate required options
    try {
      validateSecretKey(options.secretKey);
    } catch (error) {
      app.error(`Secret key validation failed: ${error.message}`);
      setStatus(`Secret key validation failed: ${error.message}`);
      return;
    }

    if (!options.udpPort || options.udpPort < 1024 || options.udpPort > 65535) {
      app.error("UDP port must be between 1024 and 65535");
      setStatus("UDP port validation failed");
      return;
    }

    if (options.serverType === true || options.serverType === "server") {
      // Server section
      isServerMode = true;
      app.debug("SignalK data connector server started");
      socketUdp = dgram.createSocket({ type: "udp4", reuseAddr: true });

      // Add error handler before binding
      socketUdp.on("error", (err) => {
        app.error(`UDP socket error: ${err.message}`);
        readyToSend = false; // Server not ready due to error
        if (err.code === "EADDRINUSE") {
          setStatus(`Failed to start - port ${options.udpPort} already in use`);
        } else if (err.code === "EACCES") {
          setStatus(`Failed to start - permission denied for port ${options.udpPort}`);
        } else {
          setStatus(`UDP socket error: ${err.code || err.message}`);
        }
        // Close the socket on error
        if (socketUdp) {
          socketUdp.close();
          socketUdp = null;
        }
      });

      socketUdp.on("listening", () => {
        const address = socketUdp.address();
        app.debug(`UDP server listening on ${address.address}:${address.port}`);
        setStatus(`Server listening on port ${address.port}`);
        readyToSend = true; // Server is ready to receive data
      });

      socketUdp.on("message", (delta) => {
        unpackDecrypt(delta, options.secretKey);
      });

      socketUdp.bind(options.udpPort, (err) => {
        if (err) {
          app.error(`Failed to bind to port ${options.udpPort}: ${err.message}`);
          setStatus(`Failed to start - ${err.message}`);
        }
      });
    } else {
      // Client section
      isServerMode = false;
      // Initialize persistent storage (only needed in client mode)
      await initializePersistentStorage();

      // Load initial delta timer configuration
      const deltaTimerTimeFile = await loadConfigFile(deltaTimerFile);
      deltaTimerTime = deltaTimerTimeFile ? deltaTimerTimeFile.deltaTimer : DEFAULT_DELTA_TIMER;

      // helloMessageSender with smart suppression - only send if no recent data transmission
      // This prevents redundant heartbeats when data is actively flowing
      const helloInterval = options.helloMessageSender * 1000;
      helloMessageSender = setInterval(async () => {
        const timeSinceLastPacket = Date.now() - lastPacketTime;

        // Only send hello if no packet sent in the last interval
        if (timeSinceLastPacket >= helloInterval) {
          const fixedDelta = {
            context: "vessels.urn:mrn:imo:mmsi:" + app.getSelfPath("mmsi"),
            updates: [
              {
                timestamp: new Date(),
                values: []
              }
            ]
          };
          app.debug("Sending hello message (no recent data transmission)");
          app.debug(JSON.stringify(fixedDelta, null, 2));
          deltasFixed.push(fixedDelta);
          await packCrypt(deltasFixed, options.secretKey, options.udpAddress, options.udpPort);
          deltasFixed = [];
        } else {
          app.debug(`Skipping hello message (last packet ${timeSinceLastPacket}ms ago)`);
        }
      }, helloInterval);

      socketUdp = dgram.createSocket({ type: "udp4", reuseAddr: true });

      // Add error handler for client socket
      socketUdp.on("error", (err) => {
        app.error(`Client UDP socket error: ${err.message}`);
        setStatus(`UDP socket error: ${err.code || err.message}`);
      });

      // Start the delta timer
      scheduleDeltaTimer();

      // Set up file system watchers for configuration files
      setupConfigWatchers();

      // Ping monitor for Client to check connection to Server / Test destination
      pingMonitor = new Monitor({
        address: options.testAddress,
        port: options.testPort,
        interval: options.pingIntervalTime, // minutes
        protocol: "tcp"
      });

      pingMonitor.on("up", function (res, _state) {
        handlePingSuccess(res, "up", options.pingIntervalTime);
      });

      pingMonitor.on("down", function (_res, _state) {
        readyToSend = false;
        app.debug("Connection monitor: down");
      });

      pingMonitor.on("restored", function (res, _state) {
        handlePingSuccess(res, "restored", options.pingIntervalTime);
      });

      pingMonitor.on("stop", function (_res, _state) {
        readyToSend = false;
        app.debug("Connection monitor: stopped");
      });

      pingMonitor.on("timeout", function (_error, _res) {
        readyToSend = false;
        app.debug("Connection monitor: timeout");
      });

      pingMonitor.on("error", function (error, _res) {
        readyToSend = false;
        if (error) {
          const errorMessage =
            error.code === "ENOTFOUND" || error.code === "EAI_AGAIN"
              ? `Could not resolve address ${options.testAddress}. Check hostname.`
              : `Connection monitor error: ${error.message || error}`;
          app.debug(errorMessage);
        }
      });

      pingTimeout = setTimeout(
        () => {
          readyToSend = false;
        },
        options.pingIntervalTime * MILLISECONDS_PER_MINUTE + PING_TIMEOUT_BUFFER
      );
    }
  };

  /**
   * Converts delta object to buffer (JSON or MessagePack)
   * @param {Object|Array} delta - Delta object or array to convert
   * @param {boolean} useMsgpack - Whether to use MessagePack serialization
   * @returns {Buffer} Encoded buffer
   */
  function deltaBuffer(delta, useMsgpack = false) {
    if (useMsgpack) {
      return Buffer.from(msgpack.encode(delta));
    }
    return Buffer.from(JSON.stringify(delta), "utf8");
  }

  /**
   * Compresses, encrypts, and sends delta data via UDP (optimized binary protocol)
   * Pipeline: Serialize -> Compress -> Encrypt (with GCM auth) -> Send
   * Removes inefficient second compression and JSON serialization of encrypted data
   * @param {Object|Array} delta - Delta data to send
   * @param {string} secretKey - 32-character encryption key
   * @param {string} udpAddress - Destination IP address
   * @param {number} udpPort - Destination UDP port
   * @returns {Promise<void>}
   */
  async function packCrypt(delta, secretKey, udpAddress, udpPort) {
    try {
      // Guard against calls after plugin stop
      if (!pluginOptions) {
        app.debug("packCrypt called but plugin is stopped, ignoring");
        return;
      }

      // Apply path dictionary encoding if enabled
      let processedDelta = delta;
      if (pluginOptions.usePathDictionary) {
        if (Array.isArray(delta)) {
          processedDelta = delta.map((d) => encodeDelta(d));
        } else {
          processedDelta = encodeDelta(delta);
        }
      }

      // Serialize to buffer (JSON or MessagePack)
      const serialized = deltaBuffer(processedDelta, pluginOptions.useMsgpack);

      // Track raw bytes for compression ratio calculation
      metrics.bandwidth.bytesOutRaw += serialized.length;

      // Track path stats AFTER serialization (reuse size for efficiency)
      if (Array.isArray(delta)) {
        delta.forEach((d) => trackPathStats(d, serialized.length / delta.length));
      } else {
        trackPathStats(delta, serialized.length);
      }

      // Single compression stage (before encryption)
      const compressed = await brotliCompressAsync(serialized, {
        params: {
          [zlib.constants.BROTLI_PARAM_MODE]: pluginOptions.useMsgpack
            ? zlib.constants.BROTLI_MODE_GENERIC
            : zlib.constants.BROTLI_MODE_TEXT,
          [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY_HIGH,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: serialized.length
        }
      });

      // Encrypt with AES-256-GCM (binary format with built-in authentication)
      // Format: [IV (12 bytes)][Encrypted Data][Auth Tag (16 bytes)]
      const packet = encryptBinary(compressed, secretKey);

      // Check for MTU issues
      if (packet.length > MAX_SAFE_UDP_PAYLOAD) {
        app.debug(
          `Warning: Packet size ${packet.length} bytes exceeds safe MTU (${MAX_SAFE_UDP_PAYLOAD}), may fragment. ` +
            "Consider reducing delta timer interval or filtering paths."
        );
        metrics.smartBatching.oversizedPackets++;
      }

      // Track bandwidth
      metrics.bandwidth.bytesOut += packet.length;
      metrics.bandwidth.packetsOut++;

      // Send packet
      await udpSendAsync(packet, udpAddress, udpPort);
      metrics.deltasSent++;

      // Update smart batching model after successful send
      const deltaCount = Array.isArray(delta) ? delta.length : 1;
      const bytesPerDelta = packet.length / deltaCount;

      // Update rolling average using exponential smoothing
      avgBytesPerDelta =
        (1 - SMART_BATCH_SMOOTHING) * avgBytesPerDelta + SMART_BATCH_SMOOTHING * bytesPerDelta;

      // Recalculate max deltas for next batch based on updated average
      const targetSize = MAX_SAFE_UDP_PAYLOAD * SMART_BATCH_SAFETY_MARGIN;
      maxDeltasPerBatch = Math.floor(targetSize / avgBytesPerDelta);
      maxDeltasPerBatch = Math.max(
        SMART_BATCH_MIN_DELTAS,
        Math.min(SMART_BATCH_MAX_DELTAS, maxDeltasPerBatch)
      );

      // Update metrics for monitoring
      metrics.smartBatching.avgBytesPerDelta = Math.round(avgBytesPerDelta);
      metrics.smartBatching.maxDeltasPerBatch = maxDeltasPerBatch;

      app.debug(
        `Smart batch: ${deltaCount} deltas, ${packet.length} bytes (${bytesPerDelta.toFixed(0)} bytes/delta), ` +
          `avg=${avgBytesPerDelta.toFixed(0)}, nextMaxDeltas=${maxDeltasPerBatch}`
      );

      // Update last packet time for hello message suppression
      lastPacketTime = Date.now();
    } catch (error) {
      if (error.message && error.message.includes("compress")) {
        app.error(`Compression error: ${error.message}`);
        metrics.compressionErrors++;
        metrics.lastError = `Compression error: ${error.message}`;
      } else if (error.message && error.message.includes("encrypt")) {
        app.error(`Encryption error: ${error.message}`);
        metrics.encryptionErrors++;
        metrics.lastError = `Encryption error: ${error.message}`;
      } else {
        app.error(`packCrypt error: ${error.message}`);
        metrics.lastError = `packCrypt error: ${error.message}`;
      }
      metrics.lastErrorTime = Date.now();
    }
  }

  /**
   * Decompresses, decrypts, and processes received UDP data (optimized binary protocol)
   * Pipeline: Receive -> Decrypt (with GCM auth) -> Decompress -> Parse -> Process
   * @param {Buffer} packet - Binary packet with encrypted data
   * @param {string} secretKey - 32-character decryption key
   * @returns {Promise<void>}
   */
  async function unpackDecrypt(packet, secretKey) {
    try {
      // Guard against calls after plugin stop
      if (!pluginOptions) {
        app.debug("unpackDecrypt called but plugin is stopped, ignoring");
        return;
      }

      // Track incoming bandwidth
      metrics.bandwidth.bytesIn += packet.length;
      metrics.bandwidth.packetsIn++;

      // Decrypt with AES-256-GCM (authentication is verified automatically)
      // If authentication fails, decryptBinary will throw
      // Format: [IV (12 bytes)][Encrypted Data][Auth Tag (16 bytes)]
      const decrypted = decryptBinary(packet, secretKey);

      // Decompress (single decompression stage)
      const decompressed = await brotliDecompressAsync(decrypted);

      // Track raw bytes
      metrics.bandwidth.bytesInRaw += decompressed.length;

      // Parse content (JSON or MessagePack)
      let jsonContent;
      if (pluginOptions.useMsgpack) {
        try {
          jsonContent = msgpack.decode(decompressed);
        } catch (msgpackErr) {
          // Fallback to JSON if MessagePack fails
          jsonContent = JSON.parse(decompressed.toString());
        }
      } else {
        jsonContent = JSON.parse(decompressed.toString());
      }

      // Process deltas - cache keys array to avoid repeated Object.keys() calls
      const deltaKeys = Object.keys(jsonContent);
      const deltaCount = deltaKeys.length;

      for (let i = 0; i < deltaCount; i++) {
        const jsonKey = deltaKeys[i];
        let deltaMessage = jsonContent[jsonKey];

        // Skip null or undefined delta messages
        if (deltaMessage === null || deltaMessage === undefined) {
          app.debug(`Skipping null delta message at index ${i}`);
          continue;
        }

        // Decode path dictionary if enabled
        if (pluginOptions.usePathDictionary) {
          deltaMessage = decodeDelta(deltaMessage);
        } else {
          // Ensure source is never null/undefined even when path dictionary is disabled
          // This prevents "Cannot set properties of null (setting 'label')" errors in SignalK
          if (deltaMessage.updates) {
            deltaMessage.updates = deltaMessage.updates.map((update) => ({
              ...update,
              source: update.source ?? {}
            }));
          }
        }

        // Skip if decoding returned null
        if (deltaMessage === null || deltaMessage === undefined) {
          app.debug(`Skipping null delta message after decoding at index ${i}`);
          continue;
        }

        // Track path stats for server-side analytics (reuse size)
        trackPathStats(deltaMessage, decompressed.length / deltaCount);

        app.handleMessage("", deltaMessage);
        app.debug(JSON.stringify(deltaMessage, null, 2));
        metrics.deltasReceived++;
      }
    } catch (error) {
      if (
        error.message &&
        (error.message.includes("Unsupported state") || error.message.includes("auth"))
      ) {
        app.error("Authentication failed: packet tampered or wrong key");
        metrics.encryptionErrors++;
        metrics.lastError = "Authentication failed: packet tampered or wrong key";
      } else if (error.message && error.message.includes("decrypt")) {
        app.error(`Decryption error: ${error.message}`);
        metrics.encryptionErrors++;
        metrics.lastError = `Decryption error: ${error.message}`;
      } else if (error.message && error.message.includes("decompress")) {
        app.error(`Decompression error: ${error.message}`);
        metrics.compressionErrors++;
        metrics.lastError = `Decompression error: ${error.message}`;
      } else {
        app.error(`unpackDecrypt error: ${error.message}`);
        metrics.lastError = `unpackDecrypt error: ${error.message}`;
      }
      metrics.lastErrorTime = Date.now();
    }
  }

  /**
   * Sends a message via UDP with retry logic (async version)
   * @param {Buffer} message - Message to send
   * @param {string} host - Destination host address
   * @param {number} port - Destination port number
   * @param {number} retryCount - Number of retries (default 0)
   * @returns {Promise<void>}
   */
  function udpSendAsync(message, host, port, retryCount = 0) {
    if (!socketUdp) {
      const error = new Error("UDP socket not initialized, cannot send message");
      app.error(error.message);
      setStatus("UDP socket not initialized - cannot send data");
      throw error;
    }

    return new Promise((resolve, reject) => {
      socketUdp.send(message, port, host, async (error) => {
        if (error) {
          metrics.udpSendErrors++;
          // Check if we should retry
          if (retryCount < UDP_RETRY_MAX && (error.code === "EAGAIN" || error.code === "ENOBUFS")) {
            app.debug(`UDP send error (${error.code}), retry ${retryCount + 1}/${UDP_RETRY_MAX}`);
            metrics.udpRetries++;
            // Wait with exponential backoff, then retry
            await new Promise((res) => setTimeout(res, UDP_RETRY_DELAY * (retryCount + 1)));
            try {
              await udpSendAsync(message, host, port, retryCount + 1);
              resolve();
            } catch (retryError) {
              reject(retryError);
            }
          } else {
            // Log error and give up
            app.error(`UDP send error to ${host}:${port} - ${error.message} (code: ${error.code})`);
            metrics.lastError = `UDP send error: ${error.message} (${error.code})`;
            metrics.lastErrorTime = Date.now();
            if (retryCount >= UDP_RETRY_MAX) {
              app.error("Max retries reached, packet dropped");
            }
            reject(error);
          }
        } else {
          resolve();
        }
      });
    });
  }

  plugin.stop = function stop() {
    // Unsubscribe from SignalK subscriptions
    unsubscribes.forEach((f) => f());
    unsubscribes = [];
    localSubscription = null;
    pluginOptions = null;

    // Reset state variables for clean restart
    isServerMode = false;
    readyToSend = false;
    deltas = [];
    lastDeltaTimerHash = null;
    lastSubscriptionHash = null;
    lastSentenceFilterHash = null;
    excludedSentences = ["GSV"];
    lastPacketTime = 0;

    // Reset metrics for fresh start
    resetMetrics();

    // Clear rate limit map
    rateLimitMap.clear();

    // Clear intervals and timeouts
    clearInterval(helloMessageSender);
    clearInterval(rateLimitCleanupInterval);
    clearTimeout(pingTimeout);
    clearTimeout(deltaTimer);
    clearTimeout(deltaTimerDebounceTimer);
    clearTimeout(subscriptionDebounceTimer);
    clearTimeout(sentenceFilterDebounceTimer);

    // Stop file system watchers
    if (deltaTimerWatcherObj) {
      deltaTimerWatcherObj.close();
      deltaTimerWatcherObj = null;
      app.debug("Delta timer file watcher closed");
    }
    if (subscriptionWatcherObj) {
      subscriptionWatcherObj.close();
      subscriptionWatcherObj = null;
      app.debug("Subscription file watcher closed");
    }
    if (sentenceFilterWatcherObj) {
      sentenceFilterWatcherObj.close();
      sentenceFilterWatcherObj = null;
      app.debug("Sentence filter file watcher closed");
    }

    // Stop ping monitor
    if (pingMonitor) {
      pingMonitor.stop();
      pingMonitor = null;
    }

    // Close UDP socket
    if (socketUdp) {
      app.debug("SignalK data connector stopped");
      socketUdp.close();
      socketUdp = null;
    }
  };

  // Schema using RJSF dependencies with oneOf for conditional field visibility
  // Client-only fields appear ONLY when serverType is "client"
  // Based on: https://rjsf-team.github.io/react-jsonschema-form/docs/json-schema/dependencies/
  plugin.schema = {
    type: "object",
    title: "SignalK Data Connector",
    description: "Configure encrypted UDP data transmission between SignalK units",
    required: ["serverType", "udpPort", "secretKey"],
    properties: {
      serverType: {
        type: "string",
        title: "Operation Mode",
        description: "Select Server to receive data, or Client to send data",
        default: "client",
        enum: ["server", "client"],
        enumNames: ["Server Mode - Receive Data", "Client Mode - Send Data"]
      },
      udpPort: {
        type: "number",
        title: "UDP Port",
        description: "UDP port for data transmission (must match on both ends)",
        default: 4446,
        minimum: 1024,
        maximum: 65535
      },
      secretKey: {
        type: "string",
        title: "Encryption Key",
        description: "32-character secret key (must match on both ends)",
        minLength: 32,
        maxLength: 32
      },
      useMsgpack: {
        type: "boolean",
        title: "Use MessagePack",
        description: "Binary serialization for smaller payloads (must match on both ends)",
        default: false
      },
      usePathDictionary: {
        type: "boolean",
        title: "Use Path Dictionary",
        description: "Encode paths as numeric IDs for bandwidth savings (must match on both ends)",
        default: false
      }
    },
    // Client-only fields are defined ONLY inside oneOf, not in main properties
    dependencies: {
      serverType: {
        oneOf: [
          {
            properties: {
              serverType: { enum: ["server"] }
            }
          },
          {
            properties: {
              serverType: { enum: ["client"] },
              udpAddress: {
                type: "string",
                title: "Server Address",
                description: "IP address or hostname of the SignalK server",
                default: "127.0.0.1"
              },
              helloMessageSender: {
                type: "integer",
                title: "Heartbeat Interval (seconds)",
                description: "How often to send heartbeat messages",
                default: 60,
                minimum: 10,
                maximum: 3600
              },
              testAddress: {
                type: "string",
                title: "Connectivity Test Address",
                description: "Address to ping for network testing (e.g., 8.8.8.8)",
                default: "127.0.0.1"
              },
              testPort: {
                type: "number",
                title: "Connectivity Test Port",
                description: "Port for connectivity test (80, 443, 53)",
                default: 80,
                minimum: 1,
                maximum: 65535
              },
              pingIntervalTime: {
                type: "number",
                title: "Check Interval (minutes)",
                description: "How often to test network connectivity",
                default: 1,
                minimum: 0.1,
                maximum: 60
              }
            },
            required: ["udpAddress", "testAddress", "testPort"]
          }
        ]
      }
    }
  };

  return plugin;
};
