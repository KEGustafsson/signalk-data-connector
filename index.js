'use strict';
/* eslint-disable no-undef */
const fs = require("fs");
const path = require("path");
const zlib = require('node:zlib');
const dgram = require("dgram");
const { encrypt, decrypt } = require("./crypto");
const Monitor = require("ping-monitor");

module.exports = function createPlugin(app) {
  const plugin = {};
  plugin.id = "signalk-data-connector";
  plugin.name = "Signal K Data Connector";
  plugin.description =
    "Server & client solution for encrypted compressed UDP data transfer between Signal K units";
  var unsubscribes = [];
  let localSubscription;
  let socketUdp;
  let readyToSend = false;
  let helloMessageSender;
  let subscribeRead;
  let pingTimeout;
  let deltaTimer;
  let deltaTimerTime = 1000;
  let deltaTimerTimeNew;
  let deltaTimerSet;
  let deltas = [];
  let deltasFixed = [];
  let timer = false;
  
  // eslint-disable-next-line no-unused-vars
  const setStatus = app.setPluginStatus || app.setProviderStatus;

  function loadConfigFile(filename) {
    const filePath = path.join(__dirname, 'config', filename);
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    } catch (err) {
      app.error(`Error loading ${filename}: ${err.message}`);
    }
    return null;
  }

  function saveConfigFile(filename, data) {
    const configDir = path.join(__dirname, 'config');
    const filePath = path.join(configDir, filename);
        
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      return true;
    } catch (err) {
      app.error(`Error saving ${filename}: ${err.message}`);
      return false;
    }
  }

  plugin.start = function (options) {
    if (options.serverType === true || options.serverType === "server") {
      // Server section
      app.debug("SignalK data connector server started");
      socketUdp = dgram.createSocket({ type: "udp4", reuseAddr: true });
      socketUdp.bind(options.udpPort);
      socketUdp.on("message", (delta) => {
        unpackDecrypt(delta, options.secretKey);
      });
    } else {
      // Client section
      plugin.registerWithRouter = (router) => {
        router.get('/config/:filename', (req, res) => {
          const filename = req.params.filename;
          if (!['delta_timer.json', 'subscription.json'].includes(filename)) {
            return res.status(400).json({ error: 'Invalid filename' });
          }
          
          res.contentType('application/json');
          const config = loadConfigFile(filename);
          res.send(JSON.stringify(config || {}));
        });

        router.post('/config/:filename', (req, res) => {
          const filename = req.params.filename;
          if (!['delta_timer.json', 'subscription.json'].includes(filename)) {
            return res.status(400).json({ error: 'Invalid filename' });
          }

          const success = saveConfigFile(filename, req.body);
          if (success) {
            res.status(200).send("OK");
          } else {
            res.status(500).send("Failed to save configuration");
          }
        });
      };

      let deltaTimerTimeFile;
      try {
        deltaTimerTimeFile = JSON.parse(
          fs.readFileSync(path.join(__dirname, "config", "delta_timer.json"))
        );
      } catch (error) {
        deltaTimerTimeFile = {
          "deltaTimer": 1000
        };
      }
      deltaTimerTime = deltaTimerTimeFile.deltaTimer;
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
                  value: new Date(Date.now()),
                },
              ],
            },
          ],
        };
        app.debug(JSON.stringify(fixedDelta, null, 2));
        deltasFixed.push(fixedDelta);
        packCrypt(
          deltasFixed,
          options.secretKey,
          options.udpAddress,
          options.udpPort
        );
        deltasFixed = [];
      }, options.helloMessageSender * 1000);

      socketUdp = dgram.createSocket({ type: "udp4", reuseAddr: true });

      // eslint-disable-next-line no-inner-declarations
      function deltaTimerfunc() {
        deltaTimer = setTimeout(() => {
          timer = true;
          deltaTimer.refresh();
        }, deltaTimerTime);
      }

      deltaTimerfunc();

      deltaTimerSet = setInterval(() => {
        if (deltaTimerTime !== deltaTimerTimeNew) {
          deltaTimerTime = deltaTimerTimeNew;
          clearInterval(deltaTimer);
          deltaTimerfunc();
        }
      }, 1000);

      subscribeRead = setInterval(() => {
        // subscription.json file contains subscription details, read from the file
        let localSubscriptionNew;
        try {
          localSubscriptionNew = JSON.parse(
            fs.readFileSync(path.join(__dirname, "config", "subscription.json"))
          );          
        } catch (error) {
          localSubscriptionNew = {
            "context": "*",
            "subscribe": [
              {
                "path": "*"
              }
            ]
          };
        }
        // delta_timer.json file contains batch reading interval details, read from the file
        let deltaTimerTimeNewFile;
        try {
          deltaTimerTimeNewFile = JSON.parse(
            fs.readFileSync(path.join(__dirname, "delta_timer.json"))
          );
        } catch (error) {
          deltaTimerTimeNewFile = {
            "deltaTimer": 1000
          };
        }
        
        deltaTimerTimeNew = deltaTimerTimeNewFile.deltaTimer;
        if (
          JSON.stringify(localSubscriptionNew) !==
          JSON.stringify(localSubscription)
        ) {
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
                try {
                  if (delta.updates[0].source.sentence == "GSV") {
                    delta = {}
                  }
                } catch (error) {}
                deltas.push(delta);
                setImmediate(() =>
                  app.reportOutputMessages()
                )
                if (timer) {
                  packCrypt(
                    deltas,
                    options.secretKey,
                    options.udpAddress,
                    options.udpPort
                  );
                  app.debug(JSON.stringify(deltas, null, 2));
                  deltas = [];
                  timer = false;
                }
              }
            }
          );
        }
      }, options.subscribeReadIntervalTime);

      // Ping monitor for Client to check connection to Server / Test destination
      const myMonitor = new Monitor({
        address: options.testAddress,
        port: options.testPort,
        interval: options.pingIntervalTime, // minutes
        protocol: 'tcp'
      });

      myMonitor.on('up', function (res, state) {
        readyToSend = true;
        pingTimeout.refresh();
        //console.log("up: " + state.address + ':' + state.port);
      });

      myMonitor.on('down', function (res, state) {
        readyToSend = false;
        //console.log("down: " + state.address + ':' + state.port);
      });

      myMonitor.on('restored', function (res, state) {
        readyToSend = true;
        pingTimeout.refresh();
        //console.log("restored: " + state.address + ':' + state.port);
      });

      myMonitor.on('stop', function (res, state) {
        readyToSend = false;
        //console.log("stopped: " + state.address + ':' + state.port);
      });

      myMonitor.on('timeout', function (error, res) {
        readyToSend = false;
        //console.log("timeout: " + error);
      });

      myMonitor.on('error', function (error, res) {
        readyToSend = false;
        //console.log("error: " + error);
        /*
        if (error) {
          const errorMessage = (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') ?
            `Error: Could not resolve the address ${options.testAddress}. Please check the hostname and try again.` :
            `An unexpected error occurred: ${error.message || error}`;
          //console.error(errorMessage);
        }
        */
      });

      pingTimeout = setTimeout(() => {
        readyToSend = false;
        pingTimeout.refresh();
      }, options.pingIntervalTime * 60000 + 10000);
    }
  };


  function deltaBuffer(delta) {
    return Buffer.from(JSON.stringify(delta), "utf8")
  }

  // Based on testing, Compression -> Encryption -> Compression was the most efficient way to reduce size
  function packCrypt(delta, secretKey, udpAddress, udpPort) {
    zlib.brotliCompress(
      deltaBuffer(delta),
      {params: {
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_GENERIC,
        [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: deltaBuffer(delta).length,
      }},
      (err, delta) => {
        if (err) {
          console.error("An error occurred:", err);
          process.exitCode = 1;
        }
        delta = encrypt(deltaBuffer(delta), secretKey);
        zlib.brotliCompress(
          deltaBuffer(delta),
          {params: {
            [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_GENERIC,
            [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
            [zlib.constants.BROTLI_PARAM_SIZE_HINT]: deltaBuffer(delta).length,
          }},
          (err, delta) => {
            if (err) {
              console.error("An error occurred:", err);
              process.exitCode = 1;
            }
            if (delta) {
              udpSend(delta, udpAddress, udpPort);
            }
          }
        );
      }
    );
  }

  function unpackDecrypt(delta, secretKey) {
    zlib.brotliDecompress(delta, (err, delta) => {
      if (err) {
        console.error("An error occurred:", err);
        process.exitCode = 1;
      }
      delta = decrypt(JSON.parse(delta.toString("utf8")), secretKey);
      zlib.brotliDecompress(Buffer.from(JSON.parse(delta)), (err, delta) => {
        if (err) {
          console.error("An error occurred:", err);
          process.exitCode = 1;
        }
        const jsonContent = JSON.parse(
          JSON.stringify(JSON.parse(delta.toString()))
        );
        const numbers = Object.keys(jsonContent).length;
        for (let i = 0; i < numbers; i++) {
          const jsonKey = Object.keys(jsonContent)[i];
          const delta = jsonContent[jsonKey];
          app.handleMessage("", delta);
          app.debug(JSON.stringify(delta, null, 2));
        }
      });
    });
  }

  function udpSend(message, host, port) {
    socketUdp.send(message, port, host, (error) => {
      if (error) {
        console.error();
      }
    });
  }

  plugin.stop = function stop() {
    unsubscribes.forEach((f) => f());
    unsubscribes = [];
    localSubscription = null;
    clearInterval(helloMessageSender);
    clearInterval(subscribeRead);
    clearInterval(pingTimeout);
    clearInterval(deltaTimer);
    clearInterval(deltaTimerSet);
    if (socketUdp) {
      app.debug("SignalK data connector stopped");
      socketUdp.close();
      socketUdp = null;
    }
  };

  plugin.schema = {
    type: "object",
    title: "SignalK Data Connector Configuration",
    description: "Configure encrypted UDP data transmission between SignalK units with compression and connectivity monitoring",
    required: ["udpPort", "secretKey"],
    properties: {
      serverType: {
        type: "string",
        default: "client",
        title: "Operation Mode",
        description: "Select the operation mode for this plugin instance. Server mode receives and processes data from clients. Client mode sends data to a server.",
        enum: ["server", "client"],
        enumNames: ["Server Mode - Receive Data", "Client Mode - Send Data"]
      },
      udpPort: {
        type: "number",
        title: "UDP Port Number",
        description: "The UDP port used for data transmission. Both server and client must use the same port number.",
        default: 4446,
        minimum: 1024,
        maximum: 65535,
        examples: [4446, 8080, 9090]
      },
      secretKey: {
        type: "string",
        title: "Encryption Secret Key",
        description: "A 32-character secret key used for AES encryption/decryption. Both server and client must use the identical key for secure communication.",
        minLength: 32,
        maxLength: 32,
        pattern: "^[A-Za-z0-9!@#$%^&*()_+\\-=\\[\\]{};':\"\\\\|,.<>\\/?]{32}$",
        examples: ["MySecretKey123456789012345678901", "A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6"]
      },
      subscribeReadIntervalTime: {
        type: "integer",
        default: 1000,
        title: "Configuration Refresh Rate",
        description: "How often to check for changes in subscription configuration files (milliseconds). Lower values provide faster config updates but use more resources.",
        minimum: 100,
        maximum: 60000,
        examples: [500, 1000, 2000, 5000]
      },
      helloMessageSender: {
        type: "integer",
        default: 60,
        title: "Vessel Data Broadcast Interval",
        description: "How often to send vessel identification and static data to maintain UDP connection (seconds). Recommended: 30-300 seconds.",
        minimum: 10,
        maximum: 3600,
        examples: [30, 60, 120, 300]
      },
      udpAddress: {
        type: "string",
        title: "Destination Server Address",
        description: "IP address or hostname of the SignalK server to send data to. Use the server's network address.",
        default: "127.0.0.1",
        pattern: "^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$|^[a-zA-Z0-9]([a-zA-Z0-9\\-]{0,61}[a-zA-Z0-9])?(\\.([a-zA-Z0-9]([a-zA-Z0-9\\-]{0,61}[a-zA-Z0-9])?))*$",
        examples: ["192.168.1.100", "10.0.0.50", "signalk.mydomain.com", "localhost"]
      },
      testAddress: {
        type: "string",
        title: "Connectivity Test Target",
        description: "IP address or hostname to test network connectivity before sending data. Should be a reliable, always-available service (e.g., router, DNS server, or web server).",
        default: "127.0.0.1",
        pattern: "^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$|^[a-zA-Z0-9]([a-zA-Z0-9\\-]{0,61}[a-zA-Z0-9])?(\\.([a-zA-Z0-9]([a-zA-Z0-9\\-]{0,61}[a-zA-Z0-9])?))*$",
        examples: ["8.8.8.8", "192.168.1.1", "google.com", "1.1.1.1"]
      },
      testPort: {
        type: "number",
        title: "Connectivity Test Port",
        description: "TCP port number to test connectivity on the target address. Common ports: 80 (HTTP), 443 (HTTPS), 53 (DNS), 22 (SSH).",
        default: 80,
        minimum: 1,
        maximum: 65535,
        examples: [80, 443, 53, 22, 8080]
      },
      pingIntervalTime: {
        type: "number",
        title: "Connectivity Check Interval",
        description: "How often to test network connectivity (minutes). Data transmission is paused when connectivity fails. Recommended: 1-5 minutes for reliable networks.",
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
          description: "CLIENT ONLY: How often to check for changes in subscription configuration files (milliseconds). Lower values provide faster config updates but use more resources."
        },
        helloMessageSender: { 
          description: "CLIENT ONLY: How often to send vessel identification and static data to maintain UDP connection (seconds). Recommended: 30-300 seconds."
        },
        udpAddress: { 
          description: "CLIENT ONLY: IP address or hostname of the SignalK server to send data to. Use the server's network address."
        },
        testAddress: { 
          description: "CLIENT ONLY: IP address or hostname to test network connectivity before sending data. Should be a reliable, always-available service."
        },
        testPort: { 
          description: "CLIENT ONLY: TCP port number to test connectivity on the target address. Common ports: 80 (HTTP), 443 (HTTPS), 53 (DNS)."
        },
        pingIntervalTime: { 
          description: "CLIENT ONLY: How often to test network connectivity (minutes). Data transmission is paused when connectivity fails."
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