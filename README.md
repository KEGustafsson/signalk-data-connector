# SignalK Data Connector with Configuration Webapp

[![Tests](https://img.shields.io/badge/tests-62%20passed-brightgreen)](https://github.com/KEGustafsson/signalk-data-connector)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen)](https://nodejs.org/)
[![SignalK Plugin](https://img.shields.io/badge/SignalK-plugin-blue)](https://signalk.org/)

A SignalK plugin for secure, encrypted UDP data transmission with compression, featuring a modern web-based configuration interface.

![Data Connector Concept](https://raw.githubusercontent.com/KEGustafsson/signalk-data-connector/refs/heads/main/doc/dataconnectorconcept.jpg)

## Quick Start

```bash
# Install in SignalK plugins directory
cd ~/.signalk/node_modules/
git clone https://github.com/KEGustafsson/signalk-data-connector.git
cd signalk-data-connector

# Install dependencies and build
npm install
npm run build

# Run tests (optional)
npm test

# Restart SignalK server
```

Configure the plugin in SignalK Admin UI → Plugin Config → Signal K Data Connector

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Plugin Settings & Usage](#plugin-settings--usage)
- [Code Quality & Reliability](#code-quality--reliability)
- [Development](#development)
  - [Building](#building-the-webapp)
  - [Testing](#testing)
  - [Code Quality](#code-quality)
- [Installation](#installation)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [Support](#support)

## Features

- **Encrypted UDP Data Transmission**: AES-256-CTR encryption with unique IV per message
- **Dual-Layer Compression**: Brotli compression before and after encryption for maximum efficiency
- **Client/Server Mode**: Can operate as either data sender (client) or receiver (server)
- **Configurable Delta Timer**: Control data collection frequency (100-10000ms)
- **Flexible Subscriptions**: Subscribe to specific SignalK data paths
- **Modern Web UI**: Responsive configuration interface with custom icon and XSS protection
- **Real-time Configuration**: Edit settings without server restart
- **Webpack Build System**: Modern build pipeline with asset versioning and source maps
- **Connectivity Monitoring**: Optional TCP ping monitoring for client connections with proper lifecycle management
- **Memory Leak Prevention**: Automatic buffer management with configurable limits and proper resource cleanup
- **Comprehensive Error Handling**: Detailed error messages with context and graceful degradation
- **Input Validation**: Validates configuration before use with sanitization
- **Comprehensive Test Suite**: 62+ tests with full coverage of critical paths
- **Production Ready**: All critical bugs fixed, security vulnerabilities patched

## Architecture

The plugin implements a multi-layer compression and encryption system:

### Client (Data Sender)

1. Collect SignalK deltas over configured time period
2. Compress JSON data with Brotli
3. Encrypt with AES-256
4. Compress encrypted data with Brotli again
5. Send via UDP

### Server (Data Receiver)

1. Receive UDP packet
2. Decompress outer Brotli layer
3. Decrypt with AES-256
4. Decompress inner Brotli layer
5. Forward deltas to SignalK server

## Plugin Settings & Usage

### Server Setup (Data Receiver)

1. Set mode to "server"
2. Configure UDP port
3. Set 32-character encryption key
4. Received data will be automatically forwarded to SignalK

### Client Setup (Data Sender)

1. Set mode to "client"
2. Configure server IP address and UDP port
3. Set the same 32-character encryption key as server
4. Configure subscription paths for data to send (WebApp)
5. Adjust delta timer for optimal performance (WebApp)
6. Optional connection monitoring, ping

## Webapps - Data Connector Configuration (Client)

### Delta Timer Configuration

Controls how frequently deltas are collected and sent:

```json
{
  "deltaTimer": 1000
}
```

- `deltaTimer`: Time in milliseconds (100-10000)
- Lower values = more frequent updates, higher bandwidth
- Higher values = better compression ratio, lower bandwidth

### Subscription Configuration

Defines which SignalK data to subscribe to:

```json
{
  "context": "*",
  "subscribe": [
    {
      "path": "navigation.position"
    },
    {
      "path": "navigation.speedOverGround"
    }
  ]
}
```

```json
{
  "context": "*",
  "subscribe": [
    {
      "path": "*"
    }
  ]
}
```

- `context`: SignalK context (e.g., "vessels.self", "\*")
- `subscribe`: Array of subscription paths

### Performance Tuning

**For High-Packed Data:**

- Set delta timer to 1000ms
- Good compression ratio

**For Low-Latency Applications:**

- Set delta timer to 100ms
- Faster updates but less compression

### Data Rate Comparison

The following chart demonstrates the significant bandwidth savings achieved by this plugin compared to standard WebSocket connections:

![Data Rate Comparison](https://raw.githubusercontent.com/KEGustafsson/signalk-data-connector/refs/heads/main/doc/datarate.jpg)

**Key Performance Benefits:**

- **1000ms Collection Time**: ~44.1 kb/s (optimal compression)
- **100ms Collection Time**: ~107.7 kb/s (faster updates)
- **WebSocket Realtime**: ~149.5 kb/s (highest bandwidth usage)

The encrypted & compressed UDP approach provides **70% bandwidth reduction** compared to WebSocket connections while maintaining data integrity through AES-256 encryption.

## Code Quality & Reliability

This plugin has undergone comprehensive code review and improvements:

### ✅ Fixed Issues (v1.0.0-beta.7)

**Critical Fixes:**
- Fixed timer cleanup bugs preventing memory leaks
- Fixed `deltaTimer.refresh()` undefined method error
- Added null checks to prevent crashes on UDP send
- Fixed ping monitor lifecycle management

**Security Fixes:**
- Patched XSS vulnerability in webapp path input
- Improved input sanitization throughout

**Performance Improvements:**
- Optimized buffer conversions in encryption pipeline
- Reduced verbose logging overhead
- Improved GSV sentence filtering logic

**Code Quality:**
- Extracted magic numbers to named constants
- Enhanced error handling in webapp initialization
- Improved resource cleanup on plugin stop
- Pinned ESLint version for consistent builds

### Test Coverage

```
Test Suites: 4 passed, 4 total
Tests:       62 passed, 62 total
Coverage:    All critical paths covered
```

**Test Categories:**
- Encryption/Decryption (17 tests)
- Compression Pipeline (11 tests)
- Plugin Lifecycle (24 tests)
- Configuration Management (10 tests)

## Development

### Building the Webapp

```bash
# Development build with watching (creates unversioned files)
npm run dev

# Production build (creates versioned files with contenthash)
npm run build
```

The build process uses Webpack 5 with:

- Babel for ES6+ transpilation
- CSS extraction and processing
- Asset versioning for cache busting
- Source maps for debugging
- Automatic cleaning of output directory

### Testing

The plugin includes a comprehensive test suite with 62+ tests covering:

- **Encryption/Decryption**: Full crypto module validation
- **Compression Pipeline**: Brotli compression and encryption flow
- **Plugin Lifecycle**: Start, stop, configuration, and cleanup
- **Configuration Management**: File operations and validation
- **Error Handling**: Edge cases and failure scenarios

```bash
# Run all tests (62 tests)
npm test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```

**Test Results:**
```
Test Suites: 4 passed, 4 total
Tests:       62 passed, 62 total
```

See `__tests__/README.md` for detailed test documentation.

### Code Quality

```bash
# Check code style
npm run lint

# Auto-fix linting issues
npm run lint:fix

# Format code with Prettier
npm run format
```

The project includes:

- **Jest** for unit testing with coverage reporting (62+ tests)
- **ESLint** for code quality and security checks (pinned to v8.57.x)
- **Prettier** for consistent code formatting
- Comprehensive test suite covering all critical functionality
- Automated error detection and code consistency enforcement

## Installation

1. Clone or download this repository to your SignalK plugins directory:

```bash
cd ~/.signalk/node_modules/
git clone https://github.com/KEGustafsson/signalk-data-connector.git
```

2. Install dependencies:

```bash
cd signalk-data-connector
npm install
```

3. Build the webapp:

```bash
npm run build
```

4. Restart your SignalK server

### API Endpoints

The plugin exposes REST endpoints for configuration:

- `GET /plugins/signalk-data-connector/config/:filename` - Load configuration
- `POST /plugins/signalk-data-connector/config/:filename` - Save configuration

## Security

- **AES-256-CTR Encryption**: Industry-standard encryption for all data transmission
- **Unique IV Per Message**: Each encryption operation generates a new initialization vector for maximum security
- **32-Character Secret Key**: Strictly validated key length requirement
- **Input Validation**: All inputs are validated before processing
- **Dual-Layer Compression**: Data is compressed before and after encryption
- **No Credential Storage**: Plugin doesn't store or transmit credentials
- **UDP Transmission**: Stateless protocol for performance (no connection tracking)

### Security Best Practices

1. **Use Strong Secret Keys**: Generate random 32-character keys
2. **Keep Keys Secret**: Never commit keys to version control
3. **Rotate Keys Regularly**: Change encryption keys periodically
4. **Monitor Logs**: Enable debug logging to detect issues
5. **Update Regularly**: Keep the plugin updated for security fixes

### Recent Security Improvements

- **v1.0.0-beta.7** (Latest): Code quality and security improvements
  - Fixed XSS vulnerability in webapp path input handling
  - Improved resource cleanup to prevent memory leaks
  - Enhanced error handling throughout the codebase
  - Fixed timer management bugs
  - Added comprehensive test coverage (62+ tests)

- **v1.0.0-beta.6**: Fixed critical static IV vulnerability (CVE pending)
  - Previously used same IV for all encryptions (security risk)
  - Now generates unique IV per encryption operation
  - **Breaking Change**: Old and new versions are not compatible

## Troubleshooting

### Common Issues

1. **Plugin not loading**
   - Check that all dependencies are installed
   - Verify the plugin is in the correct directory
   - Check SignalK server logs for errors

2. **Webapp not accessible**
   - Ensure the webapp was built (`npm run build`)
   - Check that the `public/` directory contains built files
   - Verify SignalK server is serving plugin static files

3. **No data transmission**
   - Verify both client and server use the same encryption key
   - Check UDP port configuration and firewall settings
   - Confirm subscription paths are valid

4. **Poor compression performance**
   - Increase delta timer for better compression ratios
   - Verify Brotli compression is working
   - Check that sufficient data is being collected

### Logging

Enable plugin debug logging in SignalK settings to see detailed operation information.

**Debug Output Examples:**
- Connection monitor status changes
- Configuration file loading
- Delta transmission counts (concise, not full data dumps)
- Error messages with context

## Quality Assurance

Before each release, the plugin undergoes:

1. **Automated Testing**: 62+ unit tests covering all critical functionality
2. **Code Linting**: ESLint validation with security rules
3. **Code Formatting**: Prettier for consistent style
4. **Build Verification**: Webpack build with no warnings
5. **Manual Testing**: Real-world UDP transmission validation

**Continuous Improvement:**
- All issues tracked in GitHub Issues
- Regular security audits
- Performance monitoring
- Community feedback integration

## Contributing

We welcome contributions! Please follow these guidelines:

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/my-feature`
3. **Make your changes**
4. **Run tests**: `npm test` (all tests must pass)
5. **Check code quality**: `npm run lint` (no errors allowed)
6. **Format code**: `npm run format`
7. **Build the webapp**: `npm run build` (ensure no errors)
8. **Commit with clear messages**: Follow conventional commit format
9. **Submit a pull request**

### Development Guidelines

- Write tests for new features
- Update documentation for API changes
- Follow existing code style (enforced by ESLint/Prettier)
- Add JSDoc comments for public functions
- Keep commits atomic and well-described
- Update CHANGELOG.md for significant changes

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for a detailed list of changes, improvements, and migration guides.

## License

MIT License - see [LICENSE](LICENSE) file for details.

Copyright (c) 2024 Karl-Erik Gustafsson

## Support

For issues and questions:

- **GitHub Issues**: [Create an issue](https://github.com/KEGustafsson/signalk-data-connector/issues)
- **SignalK Forums**: Check SignalK community forums
- **Documentation**: Review SignalK plugin documentation

## Acknowledgments

- SignalK project for the excellent open-source marine data platform
- Contributors and testers who help improve this plugin
- Node.js crypto and zlib modules for robust encryption and compression
