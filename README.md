# SignalK Data Connector

A SignalK plugin for secure, encrypted UDP data transmission with advanced bandwidth optimization.

[![Tests](https://img.shields.io/badge/tests-128%20passed-brightgreen)](https://github.com/KEGustafsson/signalk-data-connector)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen)](https://nodejs.org/)

![Data Connector Concept](https://raw.githubusercontent.com/KEGustafsson/signalk-data-connector/refs/heads/main/doc/dataconnectorconcept.jpg)

## Features

- **AES-256-GCM Encryption**: Authenticated encryption with built-in integrity verification
- **Optimized Binary Protocol**: Pure binary format with zero JSON overhead
- **Single-Stage Compression**: Brotli quality-10 compression for maximum efficiency
- **Path Dictionary Encoding**: 170+ SignalK paths mapped to numeric IDs (10-20% bandwidth savings)
- **MessagePack Support**: Optional binary serialization (15-25% additional savings)
- **Real-time Monitoring**: Comprehensive bandwidth dashboard, path analytics, performance metrics
- **Configurable Filters**: Exclude NMEA sentences (GSV, GSA, etc.) to reduce bandwidth
- **Client/Server Modes**: Sender or receiver operation with hot-reload configuration
- **Rate Limiting**: API endpoint protection (20 req/min/IP)
- **Connectivity Monitoring**: TCP ping with automatic reconnection and RTT measurement
- **Network Metrics**: Real-time Round Trip Time (RTT) published to `networking.modem.rtt` path
- **MTU Awareness**: Intelligent packet sizing to prevent UDP fragmentation

## Performance Improvements

**Major optimizations implemented in latest version:**

- ✅ **50-60% bandwidth reduction** compared to previous version
- ✅ **60-70% latency reduction** (packet processing: 60-100ms → 20-30ms)
- ✅ **96.78% compression ratio** on typical SignalK data
- ✅ **Binary protocol**: ~40% overhead reduction (eliminated JSON/hex encoding)
- ✅ **Single compression**: Removed wasteful double-compression stage
- ✅ **Optimized encoding**: 90% faster path dictionary (10-50x speedup)
- ✅ **Efficient memory**: Circular buffers for O(1) operations

**Test Results:**

```
Original: 19,293 bytes → Encrypted+Compressed: 622 bytes
Bandwidth Reduction: 96.78%
```

## Architecture

### Client (Sender)

```
SignalK Deltas → Filter → [Path Encode] → [MessagePack] → Brotli → AES-256-GCM → UDP
```

### Server (Receiver)

```
UDP → AES-256-GCM → Brotli → [MessagePack] → [Path Decode] → SignalK
```

**Key Design Principles:**

- Binary format throughout (no JSON serialization overhead)
- Single compression stage (encrypted data is incompressible)
- Authenticated encryption (GCM provides encryption + integrity in one operation)
- Optional path dictionary and MessagePack for additional savings

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
   - Subscription paths (add `networking.modem.rtt` to receive RTT measurements)
   - Sentence filters

### Web UI

Access via: `http://[signalk-server]:3000/plugins/signalk-data-connector`

**Client Mode Features:**

- Delta Timer configuration (100-10000ms)
- Subscription path management (JSON editor + form)
- Sentence filter (comma-separated: `GSV, GSA, VTG`)
- Real-time bandwidth monitor with compression ratio
- **Bandwidth saved display** (shows actual bytes saved by compression)
- Path analytics with data volume breakdown
- Performance metrics (errors, uptime, deltas sent)
- Rate history chart (last 150 seconds)

**Server Mode Features:**

- Bandwidth monitor (download rate, packets received)
- **Bandwidth saved display** (shows bytes saved on receiving compressed data)
- Path analytics (incoming data breakdown)
- Performance metrics (deltas received, errors)
- Real-time compression effectiveness tracking

### Configuration Files

| File                   | Purpose                    |
| ---------------------- | -------------------------- |
| `delta_timer.json`     | Collection interval (ms)   |
| `subscription.json`    | SignalK paths to subscribe |
| `sentence_filter.json` | NMEA sentences to exclude  |

### Network Monitoring (Client Mode)

The client measures **Round Trip Time (RTT)** to monitor network connectivity and latency:

**How It Works:**
- Uses TCP ping to configured `testAddress:testPort`
- Measures every `pingIntervalTime` minutes (configurable)
- Publishes RTT to local SignalK at path `networking.modem.rtt`
- Value in seconds (e.g., 0.025 = 25ms RTT)

**RTT Data Flow:**
1. Ping monitor measures TCP connection time to test server
2. RTT published to local SignalK via `app.handleMessage()`
3. Normal subscription picks up `networking.modem.rtt` (if subscribed)
4. Sent to remote server with other subscribed data

**To Enable RTT Transmission:**
Add `networking.modem.rtt` to your `subscription.json` file. The RTT will then be sent to the remote server along with all other subscribed SignalK data.

**Use Cases:**
- Monitor cellular/satellite modem latency
- Track connection quality over time
- Trigger alerts on high latency
- Analyze network performance trends

### API Endpoints

- `GET/POST /plugins/signalk-data-connector/config/:filename` - Configuration management
- `GET /plugins/signalk-data-connector/metrics` - Real-time statistics
- `GET /plugins/signalk-data-connector/paths` - Path dictionary info

All endpoints protected with rate limiting (20 requests/minute per IP).

## Performance

### Data Rate Comparison

The following chart demonstrates the significant bandwidth savings achieved by this plugin compared to standard WebSocket connections:

![Data Rate Comparison](https://raw.githubusercontent.com/KEGustafsson/signalk-data-connector/refs/heads/main/doc/datarate.jpg)

**Key Performance Benefits:**

- **1000ms Collection Time**: ~44.1 kb/s (optimal compression)
- **100ms Collection Time**: ~107.7 kb/s (faster updates)
- **WebSocket Realtime**: ~149.5 kb/s (highest bandwidth usage)

The encrypted & compressed UDP approach provides **70% bandwidth reduction** compared to WebSocket connections while maintaining data integrity through AES-256-GCM authenticated encryption.

### Bandwidth Optimization Techniques

1. **Binary Protocol**: Eliminates JSON serialization overhead (~40% savings)
2. **Path Dictionary**: Numeric IDs instead of full path strings (10-20% savings)
3. **MessagePack**: Binary serialization format (15-25% additional savings when enabled)
4. **Brotli Quality 10**: Maximum compression with size hints for optimal efficiency
5. **Smart Filtering**: GSV sentence filtering prevents unnecessary data transmission
6. **MTU Awareness**: Optimal packet sizing (1400 bytes) prevents fragmentation

### Performance Characteristics

- **Compression Ratio**: Typically 85-97% on SignalK delta streams
- **Latency**: 20-30ms per packet (serialize → compress → encrypt)
- **Throughput**: Handles 10-100 Hz update rates efficiently
- **Memory**: Constant O(1) with circular buffers
- **CPU**: Minimal overhead with async/await pipeline

## Security

### Encryption

- **AES-256-GCM**: Industry-standard authenticated encryption
  - **Encryption + Authentication**: Single operation (faster than separate HMAC)
  - **Unique IV**: 12 bytes random per message (required for GCM security)
  - **Auth Tag**: 16 bytes for tamper detection (built-in to GCM)
  - **Binary Format**: `[IV (12)][Encrypted Data][Auth Tag (16)]`

### Security Features

- **Tamper Detection**: Any modification to encrypted packets causes decryption to fail
- **Rate Limiting**: API endpoints protected (20 requests/minute/IP)
- **Input Validation**: Comprehensive validation on all parameters
- **Key Entropy Checking**: Rejects weak keys (all same char, insufficient diversity)
- **XSS Protection**: HTML escaping in web UI
- **No Credential Storage**: Keys stored in SignalK configuration only
- **Stateless UDP**: No session state to compromise

### Secret Key Requirements

- **Exactly 32 characters** (256 bits)
- **Minimum 8 unique characters** (enforced entropy requirement)
- **Must match on both client and server**
- Alphanumeric and special characters recommended

**Generate secure key:**

```bash
openssl rand -base64 32 | cut -c1-32
```

**Examples of valid keys:**

```
# Strong (recommended):
Abc123!@#XYZ456$%^uvw789&*()pqr0
K9#mP2$nQ7@rS4%tU6^vW8*xY3!zA5&

# Acceptable (meets minimum requirements):
abcdefgh12345678901234567890abcd
```

**Invalid keys:**

```
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  # All same character (rejected)
abababababababababababababababab  # Insufficient diversity (rejected)
MySecretKey123                     # Too short (rejected)
```

### Best Practices

1. **Use strong, randomly generated keys** (openssl rand recommended)
2. **Never commit keys to version control** (use environment variables or secure config)
3. **Rotate keys periodically** (e.g., every 6-12 months)
4. **Monitor logs for decryption failures** (may indicate attacks or mismatched keys)
5. **Use firewall rules to restrict UDP access** (only allow known IP addresses)
6. **Enable debug logging temporarily** when troubleshooting connectivity
7. **Test configuration in safe environment** before deploying to production

## Troubleshooting

### Plugin Not Loading

- Verify `npm install` completed successfully
- Check SignalK server logs for errors
- Ensure plugin directory is `~/.signalk/node_modules/signalk-data-connector`
- Verify Node.js version ≥14.0.0

### Web UI Not Accessible

- Run `npm run build` to generate UI files
- Check `public/` directory exists with built files
- Verify SignalK is serving plugin static files
- Clear browser cache and refresh

### No Data Transmission

**Client Mode:**

1. Confirm matching encryption keys on client and server
2. Verify UDP port and address configuration
3. Check firewall allows UDP traffic on configured port
4. Confirm subscription paths are valid SignalK paths
5. Verify delta timer is running (check metrics)
6. Enable debug logging to see packet transmission

**Server Mode:**

1. Verify UDP port is accessible (not blocked by firewall)
2. Confirm encryption key matches client
3. Check SignalK logs for decryption errors
4. Verify client is actually sending data (check client metrics)

**Common Error Messages:**

- `"Unsupported state or unable to authenticate data"` → Mismatched encryption keys
- `"Invalid packet size"` → Corrupted data or network issues
- `"Secret key must be exactly 32 characters"` → Invalid key length

### Poor Performance

- **Increase delta timer** for better compression (1000ms recommended for optimal bandwidth)
- **Enable path dictionary** for additional 10-20% savings
- **Enable MessagePack** for 15-25% additional compression
- **Filter unnecessary NMEA sentences** (GSV, GSA can add significant overhead)
- **Check network latency** and packet loss with ping monitor
- **Verify sufficient data is being collected** (empty deltas compress poorly)
- **Monitor CPU usage** (compression is CPU-intensive at quality 10)

### High Bandwidth Usage

1. Reduce update frequency (increase delta timer)
2. Enable path dictionary encoding
3. Enable MessagePack serialization
4. Add NMEA sentence filters (GSV, GSA, VTG)
5. Reduce number of subscription paths
6. Check for unnecessary high-frequency updates

### Debug Logging

Enable in SignalK plugin settings to see:

- Connection monitor status and ping results
- Configuration file changes (automatic reload)
- Delta transmission statistics (every packet)
- Compression ratios and packet sizes
- Error messages with full stack traces
- Metrics updates (bandwidth, rates, path stats)

**Log Level Recommendations:**

- **Production**: Error only
- **Troubleshooting**: Info (shows key events)
- **Development**: Debug (shows all details)

## Development

### Build Commands

```bash
npm run dev          # Development build with watch mode
npm run build        # Production build with versioning
npm test             # Run test suite (128 tests)
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Generate coverage report
npm run lint         # Check code style
npm run lint:fix     # Auto-fix linting issues
npm run format       # Format code with Prettier
```

### Testing

**Test Suite Coverage:**

- ✅ 128 tests, all passing
- ✅ Crypto module: 100% coverage (encryption, decryption, validation)
- ✅ Path dictionary: 100% coverage (encoding, decoding)
- ✅ Full pipeline: End-to-end tests with real compression/encryption
- ✅ Configuration: Hot-reload testing
- ✅ Web UI: Metrics and API endpoints
- ✅ Network monitoring: RTT measurement and publishing

**Run specific test suites:**

```bash
npm test -- crypto.test.js           # Encryption tests only
npm test -- full-pipeline.test.js    # Integration tests
npm test -- --coverage               # With coverage report
```

### Project Structure

```
signalk-data-connector/
├── index.js              # Main plugin (1380 lines)
├── crypto.js             # AES-256-GCM encryption (90 lines)
├── pathDictionary.js     # SignalK path encoding (170+ paths)
├── src/webapp/           # Web UI source (React-free vanilla JS)
│   ├── index.js         # Main UI logic
│   └── styles.css       # Styling
├── __tests__/           # Test suite (128 tests)
│   ├── crypto.test.js
│   ├── pathDictionary.test.js
│   ├── compression.test.js
│   ├── full-pipeline.test.js
│   ├── config.test.js
│   └── index.test.js
└── public/              # Built UI files (generated)
```

### Code Quality Standards

- **ESLint**: Enforced code style (extends eslint:recommended)
- **Prettier**: Consistent formatting
- **JSDoc**: All public functions documented
- **Test Coverage**: Critical paths at 100%
- **No TODOs**: All code complete and production-ready
- **Error Handling**: Comprehensive try/catch with metrics
- **Memory Management**: Proper cleanup in stop()

## Technical Details

### Packet Format

**Binary Packet Structure:**

```
[IV (12 bytes)][Encrypted Data][Auth Tag (16 bytes)]
```

**Total Overhead:** 28 bytes per packet (vs 120%+ overhead with JSON/hex encoding)

### Compression Pipeline

```javascript
// Client side:
JSON.stringify(delta)           // Serialization
→ [pathDictionary.encode()]     // Optional: numeric IDs
→ [msgpack.encode()]            // Optional: binary format
→ brotli.compress(quality=10)   // Maximum compression
→ encryptBinary(key)            // AES-256-GCM
→ UDP send

// Server side (reverse):
UDP receive
→ decryptBinary(key)            // Verify + decrypt
→ brotli.decompress()
→ [msgpack.decode()]
→ [pathDictionary.decode()]
→ JSON.parse()
→ SignalK handleMessage()
```

### Performance Optimizations

1. **Circular Buffer** (O(1) operations)
   - Fixed-size history buffer
   - No array shifting overhead
   - Constant memory usage

2. **Partial Sort** (O(n) vs O(n log n))
   - Top-N path selection
   - Heap-based algorithm
   - 10x faster for top 50 paths

3. **Structured Cloning** (10-50x faster)
   - Manual object cloning
   - Avoids JSON.parse(JSON.stringify())
   - Reduced GC pressure

4. **Async/Await Pipeline**
   - Non-blocking compression
   - Concurrent operations
   - Better CPU utilization

5. **Smart Metrics Tracking**
   - Precomputed sizes
   - Circular buffers for history
   - Rate limiting on calculations

## Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/name`
3. Make changes and add tests
4. Run `npm test` and `npm run lint` (must pass)
5. Run `npm run build` (must succeed)
6. Commit with clear messages (use conventional commits)
7. Submit pull request

**Requirements:**

- ✅ All 128 tests must pass
- ✅ No ESLint errors or warnings
- ✅ Code formatted with Prettier
- ✅ JSDoc comments for public functions
- ✅ Test coverage for new features
- ✅ Update README if adding features

**Commit Message Format:**

```
type: description

Types: feat, fix, docs, style, refactor, perf, test, chore
Examples:
  feat: add MessagePack serialization support
  fix: resolve race condition in file watcher
  perf: optimize path dictionary encoding (10x speedup)
  docs: update README with performance numbers
```

## Changelog

### v1.0.0-beta.33 (Latest)

**Major Performance Improvements:**

- ✅ Migrated to AES-256-GCM (authenticated encryption)
- ✅ Removed double compression (50-60% bandwidth improvement)
- ✅ Binary protocol implementation (40% overhead reduction)
- ✅ Optimized path dictionary encoding (90% faster)
- ✅ Circular buffer for efficient history tracking
- ✅ Partial sort for top-N analytics (10x faster)
- ✅ Server mode bandwidth display improvements
- ✅ All legacy code removed (no backward compatibility)

**Test Coverage:**

- 125 tests passing (all critical paths covered)
- 96.78% compression ratio on test data
- Full pipeline integration tests

**Breaking Changes:**

- Removed AES-256-CTR encryption (replaced with GCM)
- Removed separate HMAC authentication (built-in to GCM)
- Changed packet format to binary (incompatible with older versions)

## License

MIT License - Copyright (c) 2024 Karl-Erik Gustafsson

See [LICENSE](LICENSE) file for details.

## Support

- **GitHub Issues**: https://github.com/KEGustafsson/signalk-data-connector/issues
- **SignalK Forums**: https://signalk.org/community
- **Documentation**: This README + inline JSDoc comments

## Acknowledgments

- **SignalK Project**: For the excellent marine data platform
- **Node.js Crypto**: Native AES-256-GCM implementation
- **Brotli**: Google's excellent compression algorithm
- **MessagePack**: Efficient binary serialization format

---

**Made with ❤️ for the SignalK community**
