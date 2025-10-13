"use strict";
/* eslint-disable no-undef */
const { access, readFile, writeFile } = require("fs").promises;
const { join } = require("path");
const zlib = require("node:zlib");
const dgram = require("dgram");
const { encrypt, decrypt } = require("./crypto");
const Monitor = require("ping-monitor");

module.exports = function createPlugin(app) {
  // Constants
  const DEFAULT_DELTA_TIMER = 1000; // milliseconds
  const PING_TIMEOUT_BUFFER = 10000; // milliseconds - extra buffer for ping timeout
  const CONFIG_CHECK_INTERVAL = 1000; // milliseconds - how often to check for config changes
  const MILLISECONDS_PER_MINUTE = 60000;
  const MAX_DELTAS_BUFFER_SIZE = 1000; // prevent memory leaks

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
  let subscribeRead;
  let pingTimeout;
  let pingMonitor;
  let deltaTimer;
  let deltaTimerTime = DEFAULT_DELTA_TIMER;
  let deltaTimerTimeNew;
  let deltaTimerSet;
  let deltas = [];
  let deltasFixed = [];
  let timer = false;

  // Persistent storage file paths - initialized in plugin.start
  let deltaTimerFile;
  let subscriptionFile;

  // Track server mode status
  let isServerMode = false;

  // eslint-disable-next-line no-unused-vars
  const setStatus = app.setPluginStatus || app.setProviderStatus;

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

  // Register web routes - needs to be defined before start() is called
  plugin.registerWithRouter = (router) => {
    // Only register routes if in client mode
    router.get("/config/:filename", async (req, res) => {
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
      socketUdp.bind(options.udpPort);
      socketUdp.on("message", (delta) => {
        unpackDecrypt(delta, options.secretKey);
      });
    } else {
      // Client section
      isServerMode = false;
      // Initialize persistent storage (only needed in client mode)
      await initializePersistentStorage();

      // Load initial delta timer configuration
      const deltaTimerTimeFile = await loadConfigFile(deltaTimerFile);
      deltaTimerTime = deltaTimerTimeFile ? deltaTimerTimeFile.deltaTimer : DEFAULT_DELTA_TIMER;
      deltaTimerTimeNew = deltaTimerTime;

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
        app.debug("Sending hello message");
        deltasFixed.push(fixedDelta);
        packCrypt(deltasFixed, options.secretKey, options.udpAddress, options.udpPort);
        deltasFixed = [];
      }, options.helloMessageSender * 1000);

      socketUdp = dgram.createSocket({ type: "udp4", reuseAddr: true });

      // eslint-disable-next-line no-inner-declarations
      function deltaTimerfunc() {
        clearTimeout(deltaTimer);
        deltaTimer = setTimeout(() => {
          timer = true;
          deltaTimerfunc();
        }, deltaTimerTime);
      }

      deltaTimerfunc();

      deltaTimerSet = setInterval(() => {
        if (deltaTimerTime !== deltaTimerTimeNew) {
          deltaTimerTime = deltaTimerTimeNew;
          clearTimeout(deltaTimer);
          deltaTimerfunc();
        }
      }, CONFIG_CHECK_INTERVAL);

      subscribeRead = setInterval(async () => {
        // subscription.json file contains subscription details, read from the file
        const localSubscriptionNew = await loadConfigFile(subscriptionFile) || {
          context: "*",
          subscribe: [
            {
              path: "*"
            }
          ]
        };

        // delta_timer.json file contains batch reading interval details, read from the file
        const deltaTimerTimeNewFile = await loadConfigFile(deltaTimerFile) || {
          deltaTimer: DEFAULT_DELTA_TIMER
        };

        deltaTimerTimeNew = deltaTimerTimeNewFile.deltaTimer;
        if (JSON.stringify(localSubscriptionNew) !== JSON.stringify(localSubscription)) {
          localSubscription = localSubscriptionNew;
          app.debug(localSubscription);

          unsubscribes.forEach((f) => f());
          unsubscribes = [];

          app.subscriptionmanager.subscribe(
            localSubscription,
            unsubscribes,
            (subscriptionError) => {
              app.error("Error:" + subscriptionError);
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
                if (timer) {
                  packCrypt(deltas, options.secretKey, options.udpAddress, options.udpPort);
                  if (app.debug && deltas.length > 0) {
                    app.debug(`Sending ${deltas.length} deltas`);
                  }
                  deltas = [];
                  timer = false;
                }
              }
            }
          );
        }
      }, options.subscribeReadIntervalTime);

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
   * Converts delta object to UTF-8 buffer
   * @param {Object} delta - Delta object to convert
   * @returns {Buffer} UTF-8 encoded buffer
   */
  function deltaBuffer(delta) {
    return Buffer.from(JSON.stringify(delta), "utf8");
  }

  /**
   * Compresses, encrypts, and sends delta data via UDP
   * Based on testing, Compression -> Encryption -> Compression was the most efficient way to reduce size
   * @param {Object} delta - Delta data to send
   * @param {string} secretKey - 32-character encryption key
   * @param {string} udpAddress - Destination IP address
   * @param {number} udpPort - Destination UDP port
   */
  function packCrypt(delta, secretKey, udpAddress, udpPort) {
    try {
      const deltaBufferData = deltaBuffer(delta);
      const brotliOptions = {
        params: {
          [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_GENERIC,
          [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: deltaBufferData.length
        }
      };

      zlib.brotliCompress(deltaBufferData, brotliOptions, (err, compressedDelta) => {
        if (err) {
          app.error(`Brotli compression error (stage 1): ${err.message}`);
          return;
        }
        try {
          const encryptedDelta = encrypt(compressedDelta, secretKey);
          const encryptedBuffer = Buffer.from(JSON.stringify(encryptedDelta), "utf8");
          const brotliOptions2 = {
            params: {
              [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_GENERIC,
              [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
              [zlib.constants.BROTLI_PARAM_SIZE_HINT]: encryptedBuffer.length
            }
          };

          zlib.brotliCompress(encryptedBuffer, brotliOptions2, (err, finalDelta) => {
            if (err) {
              app.error(`Brotli compression error (stage 2): ${err.message}`);
              return;
            }
            if (finalDelta) {
              udpSend(finalDelta, udpAddress, udpPort);
            }
          });
        } catch (encryptError) {
          app.error(`Encryption error: ${encryptError.message}`);
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
   */
  function unpackDecrypt(delta, secretKey) {
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
            const jsonContent = JSON.parse(finalDelta.toString());
            const deltaCount = Object.keys(jsonContent).length;

            for (let i = 0; i < deltaCount; i++) {
              const jsonKey = Object.keys(jsonContent)[i];
              const deltaMessage = jsonContent[jsonKey];
              app.handleMessage("", deltaMessage);
              app.debug(JSON.stringify(deltaMessage, null, 2));
            }
          } catch (parseError) {
            app.error(`JSON parse error: ${parseError.message}`);
          }
        });
      } catch (decryptError) {
        app.error(`Decryption error: ${decryptError.message}`);
      }
    });
  }

  /**
   * Sends a message via UDP
   * @param {Buffer} message - Message to send
   * @param {string} host - Destination host address
   * @param {number} port - Destination port number
   */
  function udpSend(message, host, port) {
    if (!socketUdp) {
      app.error("UDP socket not initialized, cannot send message");
      return;
    }
    socketUdp.send(message, port, host, (error) => {
      if (error) {
        app.error(`UDP send error to ${host}:${port} - ${error.message}`);
      }
    });
  }

  plugin.stop = function stop() {
    unsubscribes.forEach((f) => f());
    unsubscribes = [];
    localSubscription = null;
    clearInterval(helloMessageSender);
    clearInterval(subscribeRead);
    clearTimeout(pingTimeout);
    clearTimeout(deltaTimer);
    clearInterval(deltaTimerSet);
    if (pingMonitor) {
      pingMonitor.stop();
      pingMonitor = null;
    }
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
      subscribeReadIntervalTime: {
        type: "integer",
        default: 1000,
        title: "Configuration Refresh Rate",
        description:
          "How often to check for changes in subscription configuration files (milliseconds). Lower values provide faster config updates but use more resources.",
        minimum: 100,
        maximum: 60000,
        examples: [500, 1000, 2000, 5000]
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
        subscribeReadIntervalTime: {
          description:
            "CLIENT ONLY: How often to check for changes in subscription configuration files (milliseconds). Lower values provide faster config updates but use more resources."
        },
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
        subscribeReadIntervalTime: false,
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
