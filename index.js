const fs = require('fs');
const path = require('path');
const zlib = require("zlib");
const dgram = require('dgram');
const { encrypt, decrypt } = require('./crypto');
const Monitor = require('ping-monitor');

module.exports = function createPlugin(app) {
  const plugin = {};
  plugin.id = 'signalk-data-connector';
  plugin.name = 'SignalK server & client for encrypted UDP data transfer';
  plugin.description = 'tbd';
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

  const setStatus = app.setPluginStatus || app.setProviderStatus;

  plugin.start = function (options) {
    if (options.serverType) {
      // Server section
      app.debug('SignalK data connector server started');
      socketUdp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      socketUdp.bind(options.udpPort);
      socketUdp.on('message', (msg) => {
        zlib.brotliDecompress(msg, (err, msg) => {
          if (err) {
            console.error('An error occurred:', err);
            process.exitCode = 1;
          }
          msg = msg.toString('utf8');
          msg = JSON.parse(msg);
          msgHash = decrypt(msg, options.secretKey);
          zlib.brotliDecompress(Buffer.from(JSON.parse(msgHash)), (err, msg) => {
            if (err) {
              console.error('An error occurred:', err);
              process.exitCode = 1;
            }      
            msg = JSON.parse(msg.toString());
            const jsonContent = JSON.parse(JSON.stringify(msg));
            const numbers = Object.keys(jsonContent).length;
            for (i = 0; i < numbers; i++) {
              const jsonKey = Object.keys(jsonContent)[i];
              const msg = jsonContent[jsonKey];
              app.handleMessage('test', msg);
            }
          })  
        });
      });
    } else {
      // Client section
      mmsi = app.getSelfPath('mmsi');
      name = app.getSelfPath('name');
      callsign = app.getSelfPath('communication.callsignVhf');
      app.debug('SignalK data connector client started');
      let deltaTimerTimeFile = JSON.parse(fs.readFileSync(path.join(__dirname, 'delta_timer.json')));
      deltaTimerTime = deltaTimerTimeFile.deltaTimer;
      deltaTimerTimeNew = deltaTimerTime;
  
      // helloMessageSender is needed due to nature of UDP. Sending vessel information pre-defined intervals
      helloMessageSender = setInterval(() => {
        const fixedDelta = 
        {
          "context": "vessels.urn:mrn:imo:mmsi:"+mmsi,
          "updates": [
            {
              "timestamp": new Date(Date.now()),
              "values": [
                {
                  "path": "",
                  "value": { "name": name }
                },
                {
                  "path": "",
                  "value": { "mmsi": mmsi }
                },
                {
                  "path": "",
                  "value": { "communication": { "callsignVhf": callsign } }
                },
                {
                  "path": "communication",
                  "value": {"callsignVhf": callsign}
                },
              ]
            }
          ]
        }
        app.debug(JSON.stringify(fixedDelta, null, 2))
        deltasFixed.push(fixedDelta);
        packCrypt(deltasFixed, options.secretKey, options.udpAddress, options.udpPort);
        deltasFixed = [];
      }, options.helloMessageSender * 1000);
  
      socketUdp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  
      function deltaTimerfunc() { deltaTimer = setTimeout(() => {
        timer = true;
        deltaTimer.refresh();
      }, deltaTimerTime)};
  
      deltaTimerfunc();
  
      deltaTimerSet = setInterval(() => {
        if (deltaTimerTime !== deltaTimerTimeNew) {
          deltaTimerTime = deltaTimerTimeNew;
          clearInterval(deltaTimer);
          deltaTimerfunc();
        }
      },1000)
  
      subscribeRead = setInterval(() => {
        // subscription.json file contains subscription details, read from the file
        let localSubscriptionNew = JSON.parse(fs.readFileSync(path.join(__dirname, 'subscription.json')));
        // delta_timer.json file contains batch reading interval details, read from the file
        let deltaTimerTimeNewFile = JSON.parse(fs.readFileSync(path.join(__dirname, 'delta_timer.json')));
        deltaTimerTimeNew = deltaTimerTimeNewFile.deltaTimer;
        if (JSON.stringify(localSubscriptionNew) !== JSON.stringify(localSubscription)) {
  
          localSubscription = localSubscriptionNew;
          app.debug(localSubscription);
  
          unsubscribes.forEach(f => f());
          unsubscribes = [];
  
          app.subscriptionmanager.subscribe(
            localSubscription,
            unsubscribes,
            subscriptionError => {
              app.error('Error:' + subscriptionError);
            },
            delta => {
              if (readyToSend) {
                deltas.push(delta);
                if (timer) {
                  packCrypt(deltas, options.secretKey, options.udpAddress, options.udpPort);
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
          interval: options.pingIntervalTime // minutes
      });
  
      myMonitor.on('up', function (res, state) {
        readyToSend = true;
        pingTimeout.refresh();
      });    
  
      pingTimeout = setTimeout(() => {
        readyToSend = false;
        pingTimeout.refresh();
      }, (options.pingIntervalTime * 60000 + 10000));
    }
  };

  // Based on testing, Compression -> Encryption -> Compression was the most efficient way to reduce size 
  function packCrypt(delta, secretKey, udpAddress, udpPort) {
    delta = Buffer.from(JSON.stringify(delta), 'utf8')
    zlib.brotliCompress(delta, (err, buffer) => {
      if (err) {
        console.error('An error occurred:', err);
        process.exitCode = 1;
      }
      const hash = encrypt(Buffer.from(JSON.stringify(buffer), 'utf8'), secretKey); {
        let buffer = Buffer.from(JSON.stringify(hash), 'utf8')
        zlib.brotliCompress(buffer, (err, buffer) => {
          if (err) {
            console.error('An error occurred:', err);
            process.exitCode = 1;
          }
          if (buffer) {
            udpSend(buffer, udpAddress, udpPort);
          }
        });
      };
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
    unsubscribes.forEach(f => f());
    unsubscribes = [];
    localSubscription = null;
    clearInterval(helloMessageSender);
    clearInterval(subscribeRead);
    clearInterval(pingTimeout);
    clearInterval(deltaTimer);
    clearInterval(deltaTimerSet);
    if (socketUdp) {
      app.debug('SignalK data connector stopped');
      socketUdp.close();
      socketUdp = null;
    }
  };

  plugin.schema = {
    type: 'object',
    required: ['udpPort', 'secretKey'],
    properties: {
      serverType: {
        type: 'boolean',
        default: true,
        title: 'Server/Client: If selected, Server mode otherwise Client',
      },
      udpPort: {
        type: 'number',
        title: 'Server/Client: UDP port',
        default: 4446,
      },
      secretKey: {
        type: 'string',
        title: 'Server/Client: SecretKey for encryptio and decryption (32 characters)',
      },
      subscribeReadIntervalTime: {
        type: 'integer',
        default: 1000,
        title: 'Client: Subscription config file read rate, [ms]',
      },
      helloMessageSender: {
        type: 'integer',
        default: 60,
        title: 'Client: Define how often Vessel static data is sent, [s]',
      },
      udpAddress: {
        type: 'string',
        title: 'Client: Destination UDP address',
        default: '127.0.0.1',
      },
      testAddress: {
        type: 'string',
        title: 'Client: Connectivity, address for connectivity test, e.g web server',
        default: '127.0.0.1',
      },
      testPort: {
        type: 'number',
        title: 'Client: Connectivity, port for connectivity test, e.g. web server port',
        default: 80,
      },
      pingIntervalTime: {
        type: 'number',
        title: 'Client: Connectivity, testing interval time in minutes',
        default: 1,
      },
    },
  };

  return plugin;
};
