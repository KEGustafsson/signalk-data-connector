# SignalK Data Connector

A SignalK plugin for secure, encrypted UDP data transmission with dual-layer Brotli compression.

[![Tests](https://img.shields.io/badge/tests-74%20passed-brightgreen)](https://github.com/KEGustafsson/signalk-data-connector)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen)](https://nodejs.org/)

![Data Connector Concept](https://raw.githubusercontent.com/KEGustafsson/signalk-data-connector/refs/heads/main/doc/dataconnectorconcept.jpg)

## Features

- **AES-256-CTR Encryption**: Unique IV per message
- **Dual-Layer Brotli Compression**: 70% bandwidth reduction vs WebSocket
- **Client/Server Modes**: Sender or receiver operation
- **Real-time Configuration**: Web-based UI, no restart required
- **Connectivity Monitoring**: TCP ping with automatic reconnection
- **Memory Safe**: Automatic buffer management and resource cleanup

## Architecture

### Client (Sender)
```
Collect → Compress (Brotli) → Encrypt (AES-256) → Compress (Brotli) → UDP Send
```

### Server (Receiver)
```
UDP Receive → Decompress → Decrypt → Decompress → Forward to SignalK
```

## Installation

```bash
cd ~/.signalk/node_modules/
git clone https://github.com/KEGustafsson/signalk-data-connector.git
cd signalk-data-connector
npm install
npm run build
```

Restart SignalK server and configure via: Admin UI → Plugin Config → Signal K Data Connector

## Configuration

### Server Mode (Receiver)

1. Set mode to **server**
2. Configure UDP port (1024-65535)
3. Set 32-character encryption key

### Client Mode (Sender)

1. Set mode to **client**
2. Configure:
   - Server IP address and UDP port
   - Same 32-character encryption key as server
   - Test address and port for connectivity monitoring
   - Hello message interval (seconds)
   - Ping interval (minutes)

3. Use web UI to configure:
   - Delta timer (100-10000ms)
   - Subscription paths

### Web UI Configuration

Access via: `http://[signalk-server]:3000/plugins/signalk-data-connector`

**Delta Timer** (`delta_timer.json`):
```json
{
  "deltaTimer": 1000
}
```
- Lower values: More frequent updates, higher bandwidth
- Higher values: Better compression, lower bandwidth

**Subscribe data:**
```json
{
  "context": "*",
  "subscribe": [{ "path": "*" }]
}
```

### API Endpoints

- `GET /plugins/signalk-data-connector/config/:filename` - Load configuration
- `POST /plugins/signalk-data-connector/config/:filename` - Save configuration

Valid filenames: `delta_timer.json`, `subscription.json`

## Performance

### Data Rate Comparison

The following chart demonstrates the significant bandwidth savings achieved by this plugin compared to standard WebSocket connections:

![Data Rate Comparison](https://raw.githubusercontent.com/KEGustafsson/signalk-data-connector/refs/heads/main/doc/datarate.jpg)

**Key Performance Benefits:**
- **1000ms Collection Time**: ~44.1 kb/s (optimal compression)
- **100ms Collection Time**: ~107.7 kb/s (faster updates)
- **WebSocket Realtime**: ~149.5 kb/s (highest bandwidth usage)

The encrypted & compressed UDP approach provides **70% bandwidth reduction** compared to WebSocket connections while maintaining data integrity through AES-256 encryption.

## Security

- **AES-256-CTR** with unique IV per message
- **Input validation** on all configuration parameters
- **XSS protection** in web UI
- **No credential storage**
- **Stateless UDP** protocol

### Secret Key Requirements

- Exactly 32 characters
- Alphanumeric and special characters allowed
- Must match on both client and server

**Generate secure key:**
```bash
openssl rand -base64 32 | cut -c1-32
```

### Best Practices

1. Use strong, randomly generated keys
2. Never commit keys to version control
3. Rotate keys periodically
4. Monitor logs for connection issues
5. Use firewall rules to restrict UDP access

## Troubleshooting

### Plugin Not Loading
- Verify `npm install` completed successfully
- Check SignalK server logs for errors
- Ensure plugin directory is correct

### Web UI Not Accessible
- Run `npm run build` to generate UI files
- Check `public/` directory exists with files
- Verify SignalK is serving plugin static files

### No Data Transmission
- Confirm matching encryption keys on client and server
- Check UDP port configuration
- Verify firewall allows UDP traffic on configured port
- Confirm subscription paths are valid SignalK paths
- Enable debug logging to see detailed operations

### Poor Performance
- Increase delta timer for better compression
- Verify sufficient data is being collected
- Check network latency and packet loss

### Debug Logging

Enable in SignalK plugin settings to see:
- Connection monitor status
- Configuration file changes
- Delta transmission statistics
- Error messages with context

## Development

### Build Commands

```bash
npm run dev          # Development build with watch mode
npm run build        # Production build with versioning
npm test             # Run test suite (74 tests)
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Generate coverage report
npm run lint         # Check code style
npm run lint:fix     # Auto-fix linting issues
npm run format       # Format code with Prettier
```

### Project Structure

```
signalk-data-connector/
├── index.js              # Main plugin
├── crypto.js             # Encryption module
├── webpack.config.js     # Build configuration
├── src/webapp/           # Web UI source
│   ├── index.js
│   ├── index.html
│   └── styles.css
├── __tests__/            # Test suite
└── public/               # Built UI files
```

## Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/name`
3. Make changes and add tests
4. Run `npm test` and `npm run lint` (must pass)
5. Run `npm run build` (must succeed)
6. Commit with clear messages
7. Submit pull request

**Requirements:**
- All tests must pass
- No ESLint errors
- Code formatted with Prettier
- JSDoc comments for public functions

## License

MIT License - Copyright (c) 2024 Karl-Erik Gustafsson

## Support

- **GitHub Issues**: https://github.com/KEGustafsson/signalk-data-connector/issues
- **SignalK Forums**: https://signalk.org/community
