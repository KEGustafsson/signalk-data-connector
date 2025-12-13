# SignalK Data Connector

A SignalK plugin for secure, encrypted UDP data transmission with advanced bandwidth optimization.

[![Tests](https://img.shields.io/badge/tests-130%20passed-brightgreen)](https://github.com/KEGustafsson/signalk-data-connector)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen)](https://nodejs.org/)

![Data Connector Concept](https://raw.githubusercontent.com/KEGustafsson/signalk-data-connector/refs/heads/main/doc/dataconnectorconcept.jpg)

## Features

- **AES-256-CTR Encryption**: Unique IV per message
- **HMAC-SHA256 Authentication**: Optional message integrity verification
- **Multi-Layer Compression**: Dual Brotli + MessagePack serialization
- **Path Dictionary Encoding**: 170+ SignalK paths mapped to numeric IDs
- **Real-time Monitoring**: Bandwidth dashboard, path analytics, performance metrics
- **Configurable Filters**: Exclude NMEA sentences (GSV, GSA, etc.) to reduce bandwidth
- **Client/Server Modes**: Sender or receiver operation with hot-reload configuration
- **Rate Limiting**: API endpoint protection (20 req/min/IP)
- **Connectivity Monitoring**: TCP ping with automatic reconnection

## Architecture

### Client (Sender)

```
Collect → Filter → Path Encode → MessagePack → Brotli → AES-256 → Brotli → [HMAC] → UDP
```

### Server (Receiver)

```
UDP → [HMAC Verify] → Brotli → AES-256 → Brotli → MessagePack → Path Decode → SignalK
```

*[HMAC] steps are optional and enabled via configuration*

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
4. Enable HMAC authentication (optional, must match client)

### Client Mode (Sender)

1. Set mode to **client**
2. Configure:
   - Server IP address and UDP port
   - Same 32-character encryption key as server
   - Enable HMAC authentication (must match server)
   - Test address and port for connectivity monitoring
   - Hello message interval (seconds)
   - Ping interval (minutes)

3. Use web UI to configure:
   - Delta timer (100-10000ms)
   - Subscription paths

### Web UI

Access via: `http://[signalk-server]:3000/plugins/signalk-data-connector`

**Client Mode Features:**
- Delta Timer configuration (100-10000ms)
- Subscription path management
- Sentence filter (comma-separated: `GSV, GSA, VTG`)
- Real-time bandwidth monitor with compression ratio
- Path analytics with data volume breakdown
- Performance metrics (errors, uptime, deltas sent)

**Server Mode Features:**
- Bandwidth monitor (download rate, packets received)
- Path analytics (incoming data breakdown)
- Performance metrics (deltas received, errors)

### Configuration Files

| File | Purpose |
|------|---------|
| `delta_timer.json` | Collection interval (ms) |
| `subscription.json` | SignalK paths to subscribe |
| `sentence_filter.json` | NMEA sentences to exclude |

### API Endpoints

- `GET/POST /plugins/signalk-data-connector/config/:filename`
- `GET /plugins/signalk-data-connector/metrics` - Real-time statistics
- `GET /plugins/signalk-data-connector/paths` - Path dictionary info

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
- **HMAC-SHA256** optional message authentication (detects tampering)
- **Rate limiting** on API endpoints (20 requests/minute/IP)
- **Input validation** on all configuration parameters
- **XSS protection** in web UI
- **Timing-safe comparison** for HMAC verification
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
2. Enable HMAC for untrusted networks (adds 32 bytes per packet)
3. Never commit keys to version control
4. Rotate keys periodically
5. Monitor logs for connection issues
6. Use firewall rules to restrict UDP access

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
- Verify HMAC setting matches on both client and server
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
npm test             # Run test suite (130 tests)
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
├── pathDictionary.js     # SignalK path encoding (170+ paths)
├── src/webapp/           # Web UI source
├── __tests__/            # Test suite (130 tests)
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
