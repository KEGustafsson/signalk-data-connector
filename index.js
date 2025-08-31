const fs = require('fs');
const path = require('path');
const dgram = require('dgram');
const crypto = require('crypto');
const zlib = require('zlib');

module.exports = function (app) {
  const plugin = {};
  let unsubscribes = [];
  let client = null;
  let server = null;
  let deltaBuffer = [];
  let deltaTimer = null;

  plugin.id = 'signalk-data-connector';
  plugin.name = 'SignalK Data Connector';
  plugin.description = 'Encrypted UDP data transmission with compression';

  plugin.schema = {
    type: 'object',
    properties: {
      enabled: {
        type: 'boolean',
        title: 'Enable plugin',
        default: true
      },
      mode: {
        type: 'string',
        title: 'Mode',
        enum: ['server', 'client'],
        default: 'client'
      },
      udpPort: {
        type: 'number',
        title: 'UDP Port',
        default: 4001
      },
      secureKey: {
        type: 'string',
        title: 'Secure Key (32 characters)',
        minLength: 32,
        maxLength: 32
      },
      destinationAddress: {
        type: 'string',
        title: 'Destination UDP Address (client mode only)',
        default: 'localhost'
      },
      connectivityTest: {
        type: 'object',
        title: 'Connectivity Test Settings',
        properties: {
          address: {
            type: 'string',
            title: 'Test Address',
            default: 'google.com'
          },
          port: {
            type: 'number',
            title: 'Test Port',
            default: 80
          },
          intervalMinutes: {
            type: 'number',
            title: 'Test Interval (minutes)',
            default: 5
          }
        }
      }
    }
  };

  // Load configuration files
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

  // Save configuration files
  function saveConfigFile(filename, data) {
    const filePath = path.join(__dirname, 'config', filename);
    const configDir = path.dirname(filePath);
    
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      return true;
    } catch (err) {
      app.error(`Error saving ${filename}: ${err.message}`);
      return false;
    }
  }

  // Encryption/Decryption functions
  function encrypt(text, key) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher('aes-256-cbc', key);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  function decrypt(text, key) {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = textParts.join(':');
    const decipher = crypto.createDecipher('aes-256-cbc', key);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  // Compression functions
  function compress(data) {
    return new Promise((resolve, reject) => {
      zlib.brotliCompress(Buffer.from(data), (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  }

  function decompress(data) {
    return new Promise((resolve, reject) => {
      zlib.brotliDecompress(data, (err, result) => {
        if (err) reject(err);
        else resolve(result.toString());
      });
    });
  }

  plugin.start = function (options, restartPlugin) {
    app.debug('Starting SignalK Data Connector plugin');

    // Load delta timer configuration
    const deltaTimerConfig = loadConfigFile('delta_timer.json');
    const deltaTimerMs = deltaTimerConfig ? deltaTimerConfig.deltaTimer : 1000;

    // Load subscription configuration
    const subscriptionConfig = loadConfigFile('subscription.json');
    
    if (options.mode === 'client') {
      startClient(options, deltaTimerMs, subscriptionConfig);
    } else {
      startServer(options);
    }

    // API endpoints for webapp
    app.get('/plugins/signalk-data-connector/config/:filename', (req, res) => {
      const filename = req.params.filename;
      if (!['delta_timer.json', 'subscription.json'].includes(filename)) {
        return res.status(400).json({ error: 'Invalid filename' });
      }
      
      const config = loadConfigFile(filename);
      res.json(config || {});
    });

    app.post('/plugins/signalk-data-connector/config/:filename', (req, res) => {
      const filename = req.params.filename;
      if (!['delta_timer.json', 'subscription.json'].includes(filename)) {
        return res.status(400).json({ error: 'Invalid filename' });
      }

      const success = saveConfigFile(filename, req.body);
      if (success) {
        res.json({ success: true });
        // Restart plugin to apply changes
        setTimeout(() => restartPlugin(), 1000);
      } else {
        res.status(500).json({ error: 'Failed to save configuration' });
      }
    });
  };

  function startClient(options, deltaTimerMs, subscriptionConfig) {
    client = dgram.createSocket('udp4');
    
    // Subscribe to SignalK data based on subscription configuration
    if (subscriptionConfig && subscriptionConfig.subscribe) {
      subscriptionConfig.subscribe.forEach(sub => {
        const unsubscribe = app.streambundle.getSelfBus(sub.path).onValue(delta => {
          deltaBuffer.push(delta);
        });
        unsubscribes.push(unsubscribe);
      });
    }

    // Set up delta transmission timer
    deltaTimer = setInterval(async () => {
      if (deltaBuffer.length > 0) {
        const deltas = [...deltaBuffer];
        deltaBuffer = [];

        try {
          // Compress, encrypt, compress again
          const jsonData = JSON.stringify(deltas);
          const compressed1 = await compress(jsonData);
          const encrypted = encrypt(compressed1.toString('base64'), options.secureKey);
          const compressed2 = await compress(encrypted);

          client.send(compressed2, options.udpPort, options.destinationAddress, (err) => {
            if (err) {
              app.error('UDP send error:', err);
            } else {
              app.debug(`Sent ${deltas.length} deltas`);
            }
          });
        } catch (err) {
          app.error('Error processing deltas:', err);
        }
      }
    }, deltaTimerMs);
  }

  function startServer(options) {
    server = dgram.createSocket('udp4');

    server.on('message', async (msg, rinfo) => {
      try {
        // Decompress, decrypt, decompress
        const decompressed1 = await decompress(msg);
        const decrypted = decrypt(decompressed1, options.secureKey);
        const compressed = Buffer.from(decrypted, 'base64');
        const decompressed2 = await decompress(compressed);
        const deltas = JSON.parse(decompressed2);

        // Send deltas to SignalK server
        deltas.forEach(delta => {
          app.handleMessage(plugin.id, delta);
        });

        app.debug(`Received ${deltas.length} deltas from ${rinfo.address}`);
      } catch (err) {
        app.error('Error processing received data:', err);
      }
    });

    server.bind(options.udpPort);
    app.debug(`Server listening on UDP port ${options.udpPort}`);
  }

  plugin.stop = function () {
    app.debug('Stopping SignalK Data Connector plugin');

    if (deltaTimer) {
      clearInterval(deltaTimer);
      deltaTimer = null;
    }

    unsubscribes.forEach(fn => fn());
    unsubscribes = [];

    if (client) {
      client.close();
      client = null;
    }

    if (server) {
      server.close();
      server = null;
    }
  };

  return plugin;
};