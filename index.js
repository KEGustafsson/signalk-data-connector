"use strict";
/* eslint-disable no-undef */
const { access, readFile, writeFile } = require("fs").promises;
const { watch } = require("fs");
const { join } = require("path");
const zlib = require("node:zlib");
const dgram = require("dgram");
const crypto = require("crypto");
const msgpack = require("@msgpack/msgpack");
const { encrypt, decrypt } = require("./crypto");
const { encodeDelta, decodeDelta, getAllPaths, PATH_CATEGORIES } = require("./pathDictionary");
const Monitor = require("ping-monitor");

module.exports = function createPlugin(app) {
  // Constants
  const DEFAULT_DELTA_TIMER = 1000; // milliseconds
  const PING_TIMEOUT_BUFFER = 10000; // milliseconds - extra buffer for ping timeout
  const MILLISECONDS_PER_MINUTE = 60000;
  const MAX_DELTAS_BUFFER_SIZE = 1000; // prevent memory leaks
  const FILE_WATCH_DEBOUNCE_DELAY = 300; // milliseconds - debounce delay for file watcher events

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

  // Persistent storage file paths - initialized in plugin.start
  let deltaTimerFile;
  let subscriptionFile;

  // File system watchers for configuration files
  let deltaTimerWatcher;
  let subscriptionWatcher;
  let deltaTimerDebounceTimer;
  let subscriptionDebounceTimer;

  // Track server mode status
  let isServerMode = false;

  // Track last file content hashes to prevent duplicate processing
  let lastDeltaTimerHash = null;
  let lastSubscriptionHash = null;

  // Simple rate limiting for API endpoints
  const rateLimitMap = new Map(); // key: IP address, value: { count, resetTime }
  const RATE_LIMIT_WINDOW = 60000; // 1 minute
  const RATE_LIMIT_MAX_REQUESTS = 20; // 20 requests per minute per IP
  let rateLimitCleanupInterval; // Interval for cleaning up old rate limit entries

  // Metrics tracking
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
      history: [] // Last N measurements for charting
    },
    // Path-level analytics
    pathStats: new Map() // path -> { count, bytes, lastUpdate }
  };

  // Bandwidth history settings
  const BANDWIDTH_HISTORY_MAX = 60; // Keep 60 data points (5 minutes at 5s intervals)

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
   * Cleanup old rate limit entries periodically
   */
  // eslint-disable-next-line prefer-const
  rateLimitCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of rateLimitMap.entries()) {
      if (now > data.resetTime) {
        rateLimitMap.delete(ip);
      }
    }
  }, RATE_LIMIT_WINDOW);

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
        const contentHash = crypto.createHash("sha256").update(content).digest("hex");

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
        const contentHash = crypto.createHash("sha256").update(configString).digest("hex");

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
                // Filter out GSV sentences if needed (satellite data can be verbose)
                const isGsvSentence = delta?.updates?.[0]?.source?.sentence === "GSV";
                if (isGsvSentence) {
                  return; // Skip GSV sentences
                }

                // Prevent memory leak by limiting buffer size
                if (deltas.length >= MAX_DELTAS_BUFFER_SIZE) {
                  app.error(`Delta buffer overflow (${deltas.length} items), clearing buffer`);
                  deltas = [];
                }

                deltas.push(delta);
                setImmediate(() => app.reportOutputMessages());
                if (timer) {
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
   * Sets up file system watchers for configuration files
   * Uses fs.watch for efficient event-driven configuration reloading
   * @returns {void}
   */
  function setupConfigWatchers() {
    try {
      // Watch delta_timer.json for changes
      deltaTimerWatcher = watch(deltaTimerFile, (eventType) => {
        if (eventType === "change") {
          app.debug("Delta timer configuration file changed");
          handleDeltaTimerChange();
        }
      });

      deltaTimerWatcher.on("error", (error) => {
        app.error(`Delta timer watcher error: ${error.message}`);
        // Close the failed watcher
        if (deltaTimerWatcher) {
          deltaTimerWatcher.close();
          deltaTimerWatcher = null;
        }
        // Attempt to recreate watcher after delay
        setTimeout(() => {
          app.debug("Attempting to recreate delta timer watcher...");
          try {
            deltaTimerWatcher = watch(deltaTimerFile, (eventType) => {
              if (eventType === "change") {
                app.debug("Delta timer configuration file changed");
                handleDeltaTimerChange();
              }
            });
            deltaTimerWatcher.on("error", (err) => {
              app.error(`Delta timer watcher error after recovery: ${err.message}`);
            });
            app.debug("Delta timer watcher recreated successfully");
          } catch (err) {
            app.error(`Failed to recreate delta timer watcher: ${err.message}`);
          }
        }, 5000);
      });

      // Watch subscription.json for changes
      subscriptionWatcher = watch(subscriptionFile, (eventType) => {
        if (eventType === "change") {
          app.debug("Subscription configuration file changed");
          handleSubscriptionChange();
        }
      });

      subscriptionWatcher.on("error", (error) => {
        app.error(`Subscription watcher error: ${error.message}`);
        // Close the failed watcher
        if (subscriptionWatcher) {
          subscriptionWatcher.close();
          subscriptionWatcher = null;
        }
        // Attempt to recreate watcher after delay
        setTimeout(() => {
          app.debug("Attempting to recreate subscription watcher...");
          try {
            subscriptionWatcher = watch(subscriptionFile, (eventType) => {
              if (eventType === "change") {
                app.debug("Subscription configuration file changed");
                handleSubscriptionChange();
              }
            });
            subscriptionWatcher.on("error", (err) => {
              app.error(`Subscription watcher error after recovery: ${err.message}`);
            });
            app.debug("Subscription watcher recreated successfully");
          } catch (err) {
            app.error(`Failed to recreate subscription watcher: ${err.message}`);
          }
        }, 5000);
      });

      // Load initial subscription configuration
      handleSubscriptionChange();

      app.debug("Configuration file watchers initialized");
    } catch (err) {
      app.error(`Error setting up config watchers: ${err.message}`);
      app.error("Falling back to polling mode would require manual intervention");
    }
  }

  /**
   * Calculates bandwidth rates and updates history
   */
  function updateBandwidthRates() {
    const now = Date.now();
    const elapsed = (now - metrics.bandwidth.lastRateCalcTime) / 1000; // seconds

    if (elapsed > 0) {
      const bytesDeltaOut = metrics.bandwidth.bytesOut - metrics.bandwidth.lastBytesOut;
      const bytesDeltaIn = metrics.bandwidth.bytesIn - metrics.bandwidth.lastBytesIn;

      metrics.bandwidth.rateOut = Math.round(bytesDeltaOut / elapsed);
      metrics.bandwidth.rateIn = Math.round(bytesDeltaIn / elapsed);

      // Update compression ratio
      if (metrics.bandwidth.bytesOutRaw > 0) {
        metrics.bandwidth.compressionRatio = Math.round(
          (1 - metrics.bandwidth.bytesOut / metrics.bandwidth.bytesOutRaw) * 100
        );
      }

      // Add to history
      metrics.bandwidth.history.push({
        timestamp: now,
        rateOut: metrics.bandwidth.rateOut,
        rateIn: metrics.bandwidth.rateIn,
        compressionRatio: metrics.bandwidth.compressionRatio
      });

      // Trim history
      if (metrics.bandwidth.history.length > BANDWIDTH_HISTORY_MAX) {
        metrics.bandwidth.history.shift();
      }

      metrics.bandwidth.lastBytesOut = metrics.bandwidth.bytesOut;
      metrics.bandwidth.lastBytesIn = metrics.bandwidth.bytesIn;
      metrics.bandwidth.lastRateCalcTime = now;
    }
  }

  /**
   * Tracks path-level statistics
   * @param {Object} delta - The delta object to analyze
   */
  function trackPathStats(delta) {
    if (!delta || !delta.updates) {return;}

    const deltaSize = JSON.stringify(delta).length;

    for (const update of delta.updates) {
      if (update.values) {
        for (const value of update.values) {
          if (value.path) {
            const path = value.path;
            const stats = metrics.pathStats.get(path) || { count: 0, bytes: 0, lastUpdate: 0 };
            stats.count++;
            stats.bytes += Math.round(deltaSize / update.values.length); // Approximate bytes per path
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
    if (bytes === 0) {return "0 B";}
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  // Register web routes - needs to be defined before start() is called
  plugin.registerWithRouter = (router) => {
    // Metrics endpoint (available in both client and server mode)
    router.get("/metrics", (req, res) => {
      // Update rates before responding
      updateBandwidthRates();

      const uptime = Date.now() - metrics.startTime;
      const uptimeSeconds = Math.floor(uptime / 1000);
      const uptimeMinutes = Math.floor(uptimeSeconds / 60);
      const uptimeHours = Math.floor(uptimeMinutes / 60);

      // Convert pathStats Map to sorted array
      const pathStatsArray = Array.from(metrics.pathStats.entries())
        .map(([path, stats]) => ({
          path,
          count: stats.count,
          bytes: stats.bytes,
          bytesFormatted: formatBytes(stats.bytes),
          lastUpdate: stats.lastUpdate,
          updatesPerMinute: uptimeSeconds > 0 ? Math.round((stats.count / uptimeSeconds) * 60) : 0
        }))
        .sort((a, b) => b.bytes - a.bytes) // Sort by bytes descending
        .slice(0, 50); // Top 50 paths

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
        bandwidth: {
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
          avgPacketSize:
            metrics.bandwidth.packetsOut > 0
              ? Math.round(metrics.bandwidth.bytesOut / metrics.bandwidth.packetsOut)
              : 0,
          avgPacketSizeFormatted:
            metrics.bandwidth.packetsOut > 0
              ? formatBytes(Math.round(metrics.bandwidth.bytesOut / metrics.bandwidth.packetsOut))
              : "0 B",
          history: metrics.bandwidth.history.slice(-30) // Last 30 data points for chart
        },
        pathStats: pathStatsArray,
        pathCategories: PATH_CATEGORIES,
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
    router.get("/paths", (req, res) => {
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

    // Config routes (only available in client mode)
    router.get("/config/:filename", async (req, res) => {
      // Rate limiting
      const clientIp = req.ip || (req.connection && req.connection.remoteAddress) || "unknown";
      if (!checkRateLimit(clientIp)) {
        return res.status(429).json({ error: "Too many requests, please try again later" });
      }

      // Check if running in server mode
      if (isServerMode) {
        return res.status(404).json({ error: "Not available in server mode" });
      }

      // Check if persistent storage has been initialized
      if (!deltaTimerFile || !subscriptionFile) {
        return res.status(503).json({ error: "Plugin not fully initialized" });
      }

      const filename = req.params.filename;
      if (!["delta_timer.json", "subscription.json"].includes(filename)) {
        return res.status(400).json({ error: "Invalid filename" });
      }

      const filePath = filename === "delta_timer.json" ? deltaTimerFile : subscriptionFile;
      res.contentType("application/json");
      const config = await loadConfigFile(filePath);
      res.send(JSON.stringify(config || {}));
    });

    router.post("/config/:filename", async (req, res) => {
      // Rate limiting
      const clientIp = req.ip || (req.connection && req.connection.remoteAddress) || "unknown";
      if (!checkRateLimit(clientIp)) {
        return res.status(429).json({ error: "Too many requests, please try again later" });
      }

      // Validate Content-Type
      const contentType = req.headers["content-type"];
      if (!contentType || !contentType.includes("application/json")) {
        return res.status(415).json({ error: "Content-Type must be application/json" });
      }

      // Check if running in server mode
      if (isServerMode) {
        return res.status(404).json({ error: "Not available in server mode" });
      }

      // Check if persistent storage has been initialized
      if (!deltaTimerFile || !subscriptionFile) {
        return res.status(503).json({ error: "Plugin not fully initialized" });
      }

      const filename = req.params.filename;
      if (!["delta_timer.json", "subscription.json"].includes(filename)) {
        return res.status(400).json({ error: "Invalid filename" });
      }

      const filePath = filename === "delta_timer.json" ? deltaTimerFile : subscriptionFile;
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

    // Validate required options
    if (!options.secretKey || options.secretKey.length !== 32) {
      app.error("Secret key must be exactly 32 characters");
      setStatus("Secret key validation failed");
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

      // helloMessageSender is needed due to nature of UDP. Sending vessel information pre-defined intervals
      helloMessageSender = setInterval(() => {
        const fixedDelta = {
          context: "vessels.urn:mrn:imo:mmsi:" + app.getSelfPath("mmsi"),
          updates: [
            {
              timestamp: new Date(Date.now()),
              values: [
                {
                  path: "networking.modem.latencyTime",
                  value: new Date(Date.now())
                }
              ]
            }
          ]
        };
        app.debug(JSON.stringify(fixedDelta, null, 2));
        deltasFixed.push(fixedDelta);
        packCrypt(deltasFixed, options.secretKey, options.udpAddress, options.udpPort);
        deltasFixed = [];
      }, options.helloMessageSender * 1000);

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

      pingMonitor.on("up", function (_res, _state) {
        readyToSend = true;
        clearTimeout(pingTimeout);
        pingTimeout = setTimeout(
          () => {
            readyToSend = false;
          },
          options.pingIntervalTime * MILLISECONDS_PER_MINUTE + PING_TIMEOUT_BUFFER
        );
        app.debug("Connection monitor: up");
      });

      pingMonitor.on("down", function (_res, _state) {
        readyToSend = false;
        app.debug("Connection monitor: down");
      });

      pingMonitor.on("restored", function (_res, _state) {
        readyToSend = true;
        clearTimeout(pingTimeout);
        pingTimeout = setTimeout(
          () => {
            readyToSend = false;
          },
          options.pingIntervalTime * MILLISECONDS_PER_MINUTE + PING_TIMEOUT_BUFFER
        );
        app.debug("Connection monitor: restored");
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
   * Compresses, encrypts, and sends delta data via UDP
   * Based on testing, Compression -> Encryption -> Compression was the most efficient way to reduce size
   * @param {Object|Array} delta - Delta data to send
   * @param {string} secretKey - 32-character encryption key
   * @param {string} udpAddress - Destination IP address
   * @param {number} udpPort - Destination UDP port
   * @returns {void}
   */
  function packCrypt(delta, secretKey, udpAddress, udpPort) {
    try {
      // Track path stats for each delta in the array
      if (Array.isArray(delta)) {
        delta.forEach((d) => trackPathStats(d));
      } else {
        trackPathStats(delta);
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
      const deltaBufferData = deltaBuffer(processedDelta, pluginOptions.useMsgpack);

      // Track raw bytes for compression ratio calculation
      metrics.bandwidth.bytesOutRaw += deltaBufferData.length;

      const brotliOptions = {
        params: {
          [zlib.constants.BROTLI_PARAM_MODE]: pluginOptions.useMsgpack
            ? zlib.constants.BROTLI_MODE_GENERIC
            : zlib.constants.BROTLI_MODE_TEXT,
          [zlib.constants.BROTLI_PARAM_QUALITY]: 10,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: deltaBufferData.length
        }
      };

      zlib.brotliCompress(deltaBufferData, brotliOptions, (err, compressedDelta) => {
        if (err) {
          app.error(`Brotli compression error (stage 1): ${err.message}`);
          metrics.compressionErrors++;
          metrics.lastError = `Brotli compression error (stage 1): ${err.message}`;
          metrics.lastErrorTime = Date.now();
          return;
        }
        try {
          const encryptedDelta = encrypt(compressedDelta, secretKey);
          const encryptedBuffer = Buffer.from(JSON.stringify(encryptedDelta), "utf8");
          const brotliOptions2 = {
            params: {
              [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_GENERIC,
              [zlib.constants.BROTLI_PARAM_QUALITY]: 9,
              [zlib.constants.BROTLI_PARAM_SIZE_HINT]: encryptedBuffer.length
            }
          };

          zlib.brotliCompress(encryptedBuffer, brotliOptions2, (err, finalDelta) => {
            if (err) {
              app.error(`Brotli compression error (stage 2): ${err.message}`);
              metrics.compressionErrors++;
              metrics.lastError = `Brotli compression error (stage 2): ${err.message}`;
              metrics.lastErrorTime = Date.now();
              return;
            }
            if (finalDelta) {
              // Track bandwidth
              metrics.bandwidth.bytesOut += finalDelta.length;
              metrics.bandwidth.packetsOut++;

              udpSend(finalDelta, udpAddress, udpPort);
              metrics.deltasSent++;
            }
          });
        } catch (encryptError) {
          app.error(`Encryption error: ${encryptError.message}`);
          metrics.encryptionErrors++;
          metrics.lastError = `Encryption error: ${encryptError.message}`;
          metrics.lastErrorTime = Date.now();
        }
      });
    } catch (error) {
      app.error(`packCrypt error: ${error.message}`);
    }
  }

  /**
   * Decompresses, decrypts, and processes received UDP data
   * @param {Buffer} delta - Encrypted and compressed delta data
   * @param {string} secretKey - 32-character decryption key
   * @returns {void}
   */
  function unpackDecrypt(delta, secretKey) {
    // Track incoming bandwidth
    metrics.bandwidth.bytesIn += delta.length;
    metrics.bandwidth.packetsIn++;

    zlib.brotliDecompress(delta, (err, decompressedDelta) => {
      if (err) {
        app.error(`Brotli decompression error (stage 1): ${err.message}`);
        return;
      }
      try {
        const encryptedData = JSON.parse(decompressedDelta.toString("utf8"));
        const decryptedData = decrypt(encryptedData, secretKey);

        zlib.brotliDecompress(decryptedData, (err, finalDelta) => {
          if (err) {
            app.error(`Brotli decompression error (stage 2): ${err.message}`);
            return;
          }
          try {
            // Parse content (JSON or MessagePack)
            let jsonContent;
            if (pluginOptions.useMsgpack) {
              try {
                jsonContent = msgpack.decode(finalDelta);
              } catch (msgpackErr) {
                // Fallback to JSON if MessagePack fails
                jsonContent = JSON.parse(finalDelta.toString());
              }
            } else {
              jsonContent = JSON.parse(finalDelta.toString());
            }

            // Track raw bytes
            metrics.bandwidth.bytesInRaw += finalDelta.length;

            const deltaCount = Object.keys(jsonContent).length;

            for (let i = 0; i < deltaCount; i++) {
              const jsonKey = Object.keys(jsonContent)[i];
              let deltaMessage = jsonContent[jsonKey];

              // Decode path dictionary if enabled
              if (pluginOptions.usePathDictionary) {
                deltaMessage = decodeDelta(deltaMessage);
              }

              app.handleMessage("", deltaMessage);
              app.debug(JSON.stringify(deltaMessage, null, 2));
              metrics.deltasReceived++;
            }
          } catch (parseError) {
            app.error(`Parse error: ${parseError.message}`);
            metrics.lastError = `Parse error: ${parseError.message}`;
            metrics.lastErrorTime = Date.now();
          }
        });
      } catch (decryptError) {
        app.error(`Decryption error: ${decryptError.message}`);
      }
    });
  }

  /**
   * Sends a message via UDP with retry logic
   * @param {Buffer} message - Message to send
   * @param {string} host - Destination host address
   * @param {number} port - Destination port number
   * @param {number} retryCount - Number of retries (default 0)
   */
  function udpSend(message, host, port, retryCount = 0) {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 100; // milliseconds

    if (!socketUdp) {
      app.error("UDP socket not initialized, cannot send message");
      setStatus("UDP socket not initialized - cannot send data");
      return;
    }

    socketUdp.send(message, port, host, (error) => {
      if (error) {
        metrics.udpSendErrors++;
        // Check if we should retry
        if (retryCount < MAX_RETRIES && (error.code === "EAGAIN" || error.code === "ENOBUFS")) {
          app.debug(`UDP send error (${error.code}), retry ${retryCount + 1}/${MAX_RETRIES}`);
          metrics.udpRetries++;
          setTimeout(
            () => {
              udpSend(message, host, port, retryCount + 1);
            },
            RETRY_DELAY * (retryCount + 1)
          ); // Exponential backoff
        } else {
          // Log error and give up
          app.error(`UDP send error to ${host}:${port} - ${error.message} (code: ${error.code})`);
          metrics.lastError = `UDP send error: ${error.message} (${error.code})`;
          metrics.lastErrorTime = Date.now();
          if (retryCount >= MAX_RETRIES) {
            app.error("Max retries reached, packet dropped");
          }
        }
      }
    });
  }

  plugin.stop = function stop() {
    // Unsubscribe from SignalK subscriptions
    unsubscribes.forEach((f) => f());
    unsubscribes = [];
    localSubscription = null;
    pluginOptions = null;

    // Clear intervals and timeouts
    clearInterval(helloMessageSender);
    clearInterval(rateLimitCleanupInterval);
    clearTimeout(pingTimeout);
    clearTimeout(deltaTimer);
    clearTimeout(deltaTimerDebounceTimer);
    clearTimeout(subscriptionDebounceTimer);

    // Stop file system watchers
    if (deltaTimerWatcher) {
      deltaTimerWatcher.close();
      deltaTimerWatcher = null;
      app.debug("Delta timer file watcher closed");
    }
    if (subscriptionWatcher) {
      subscriptionWatcher.close();
      subscriptionWatcher = null;
      app.debug("Subscription file watcher closed");
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

  plugin.schema = {
    type: "object",
    title: "SignalK Data Connector Configuration",
    description:
      "Configure encrypted UDP data transmission between SignalK units with compression and connectivity monitoring",
    required: ["udpPort", "secretKey"],
    properties: {
      serverType: {
        type: "string",
        default: "client",
        title: "Operation Mode",
        description:
          "Select the operation mode for this plugin instance. Server mode receives and processes data from clients. Client mode sends data to a server.",
        enum: ["server", "client"],
        enumNames: ["Server Mode - Receive Data", "Client Mode - Send Data"]
      },
      udpPort: {
        type: "number",
        title: "UDP Port Number",
        description:
          "The UDP port used for data transmission. Both server and client must use the same port number.",
        default: 4446,
        minimum: 1024,
        maximum: 65535,
        examples: [4446, 8080, 9090]
      },
      secretKey: {
        type: "string",
        title: "Encryption Secret Key",
        description:
          "A 32-character secret key used for AES encryption/decryption. Both server and client must use the identical key for secure communication.",
        minLength: 32,
        maxLength: 32,
        pattern: "^[A-Za-z0-9!@#$%^&*()_+\\-=\\[\\]{};':\"\\\\|,.<>\\/?]{32}$",
        examples: ["MySecretKey123456789012345678901", "A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6"]
      },
      helloMessageSender: {
        type: "integer",
        default: 60,
        title: "Vessel Data Broadcast Interval",
        description:
          "How often to send vessel identification and static data to maintain UDP connection (seconds). Recommended: 30-300 seconds.",
        minimum: 10,
        maximum: 3600,
        examples: [30, 60, 120, 300]
      },
      udpAddress: {
        type: "string",
        title: "Destination Server Address",
        description:
          "IP address or hostname of the SignalK server to send data to. Use the server's network address.",
        default: "127.0.0.1",
        pattern:
          "^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$|^[a-zA-Z0-9]([a-zA-Z0-9\\-]{0,61}[a-zA-Z0-9])?(\\.([a-zA-Z0-9]([a-zA-Z0-9\\-]{0,61}[a-zA-Z0-9])?))*$",
        examples: ["192.168.1.100", "10.0.0.50", "signalk.mydomain.com", "localhost"]
      },
      testAddress: {
        type: "string",
        title: "Connectivity Test Target",
        description:
          "IP address or hostname to test network connectivity before sending data. Should be a reliable, always-available service (e.g., router, DNS server, or web server).",
        default: "127.0.0.1",
        pattern:
          "^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$|^[a-zA-Z0-9]([a-zA-Z0-9\\-]{0,61}[a-zA-Z0-9])?(\\.([a-zA-Z0-9]([a-zA-Z0-9\\-]{0,61}[a-zA-Z0-9])?))*$",
        examples: ["8.8.8.8", "192.168.1.1", "google.com", "1.1.1.1"]
      },
      testPort: {
        type: "number",
        title: "Connectivity Test Port",
        description:
          "TCP port number to test connectivity on the target address. Common ports: 80 (HTTP), 443 (HTTPS), 53 (DNS), 22 (SSH).",
        default: 80,
        minimum: 1,
        maximum: 65535,
        examples: [80, 443, 53, 22, 8080]
      },
      pingIntervalTime: {
        type: "number",
        title: "Connectivity Check Interval",
        description:
          "How often to test network connectivity (minutes). Data transmission is paused when connectivity fails. Recommended: 1-5 minutes for reliable networks.",
        default: 1,
        minimum: 0.1,
        maximum: 60,
        examples: [0.5, 1, 2, 5, 10]
      },
      useMsgpack: {
        type: "boolean",
        title: "Use MessagePack Serialization",
        description:
          "Enable MessagePack binary serialization instead of JSON. Provides 15-25% smaller payloads. Both client and server must use the same setting.",
        default: false
      },
      usePathDictionary: {
        type: "boolean",
        title: "Use Path Dictionary Encoding",
        description:
          "Replace common SignalK paths with short numeric IDs. Provides 10-20% bandwidth reduction. Both client and server must use the same setting.",
        default: false
      }
    },
    additionalProperties: false,
    if: {
      properties: {
        serverType: { const: "client" }
      }
    },
    then: {
      required: ["udpPort", "secretKey", "udpAddress", "testAddress", "testPort"],
      properties: {
        helloMessageSender: {
          description:
            "CLIENT ONLY: How often to send vessel identification and static data to maintain UDP connection (seconds). Recommended: 30-300 seconds."
        },
        udpAddress: {
          description:
            "CLIENT ONLY: IP address or hostname of the SignalK server to send data to. Use the server's network address."
        },
        testAddress: {
          description:
            "CLIENT ONLY: IP address or hostname to test network connectivity before sending data. Should be a reliable, always-available service."
        },
        testPort: {
          description:
            "CLIENT ONLY: TCP port number to test connectivity on the target address. Common ports: 80 (HTTP), 443 (HTTPS), 53 (DNS)."
        },
        pingIntervalTime: {
          description:
            "CLIENT ONLY: How often to test network connectivity (minutes). Data transmission is paused when connectivity fails."
        }
      }
    },
    else: {
      required: ["udpPort", "secretKey"],
      properties: {
        helloMessageSender: false,
        udpAddress: false,
        testAddress: false,
        testPort: false,
        pingIntervalTime: false
      }
    }
  };

  return plugin;
};
