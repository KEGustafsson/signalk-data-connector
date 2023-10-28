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
  let mmsi;
  let name;
  let callsign;

  // eslint-disable-next-line no-unused-vars
  const setStatus = app.setPluginStatus || app.setProviderStatus;

  plugin.start = function (options) {
    if (options.serverType) {
      // Server section
      app.debug("SignalK data connector server started");
      socketUdp = dgram.createSocket({ type: "udp4", reuseAddr: true });
      socketUdp.bind(options.udpPort);
      socketUdp.on("message", (delta) => {
        unpackDecrypt(delta, options.secretKey);
      });
    } else {
      // Client section
      mmsi = app.getSelfPath("mmsi");
      name = app.getSelfPath("name");
      callsign = app.getSelfPath("communication.callsignVhf");
      app.debug("SignalK data connector client started");
      let deltaTimerTimeFile = JSON.parse(
        fs.readFileSync(path.join(__dirname, "delta_timer.json"))
      );
      deltaTimerTime = deltaTimerTimeFile.deltaTimer;
      deltaTimerTimeNew = deltaTimerTime;

      // helloMessageSender is needed due to nature of UDP. Sending vessel information pre-defined intervals
      helloMessageSender = setInterval(() => {
        const fixedDelta = {
          context: "vessels.urn:mrn:imo:mmsi:" + mmsi,
          updates: [
            {
              timestamp: new Date(Date.now()),
              values: [
                {
                  path: "",
                  value: { name: name },
                },
                {
                  path: "",
                  value: { mmsi: mmsi },
                },
                {
                  path: "",
                  value: { communication: { callsignVhf: callsign } },
                },
                {
                  path: "communication",
                  value: { callsignVhf: callsign },
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
        let localSubscriptionNew = JSON.parse(
          fs.readFileSync(path.join(__dirname, "subscription.json"))
        );
        // delta_timer.json file contains batch reading interval details, read from the file
        let deltaTimerTimeNewFile = JSON.parse(
          fs.readFileSync(path.join(__dirname, "delta_timer.json"))
        );
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
      });

      myMonitor.on("up", function () {
        readyToSend = true;
        pingTimeout.refresh();
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
    required: ["udpPort", "secretKey"],
    properties: {
      serverType: {
        type: "boolean",
        default: true,
        title: "SERVER/CLIENT: If selected, Server mode otherwise Client",
      },
      udpPort: {
        type: "number",
        title: "SERVER/CLIENT: UDP port",
        default: 4446,
      },
      secretKey: {
        type: "string",
        title:
          "SERVER/CLIENT: SecretKey for encryptio and decryption (32 characters)",
      },
      subscribeReadIntervalTime: {
        type: "integer",
        default: 1000,
        title: "CLIENT: Subscription config file read rate, [ms]",
      },
      helloMessageSender: {
        type: "integer",
        default: 60,
        title: "CLIENT: Define how often Vessel static data is sent, [s]",
      },
      udpAddress: {
        type: "string",
        title: "CLIENT: Destination UDP address",
        default: "127.0.0.1",
      },
      testAddress: {
        type: "string",
        title:
          "CLIENT: Connectivity, address for connectivity test, e.g web server",
        default: "127.0.0.1",
      },
      testPort: {
        type: "number",
        title:
          "CLIENT: Connectivity, port for connectivity test, e.g. web server port",
        default: 80,
      },
      pingIntervalTime: {
        type: "number",
        title: "CLIENT: Connectivity, testing interval time in minutes",
        default: 1,
      },
    },
  };

  return plugin;
};
