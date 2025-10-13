# Test Suite Documentation

This directory contains comprehensive tests for the SignalK Data Connector plugin.

## Test Files

### `crypto.test.js`
Tests for the encryption/decryption module (`crypto.js`).

**Coverage:**
- ✅ Encryption with valid inputs
- ✅ Unique IV generation per encryption
- ✅ Buffer and string input handling
- ✅ Secret key validation (length, format)
- ✅ Empty input validation
- ✅ Decryption round-trip
- ✅ Complex JSON data handling
- ✅ Wrong key detection
- ✅ Invalid data structure handling
- ✅ Special characters and Unicode support
- ✅ Large data handling
- ✅ Security: IV uniqueness verification

### `index.test.js`
Tests for the main plugin functionality (`index.js`).

**Coverage:**
- ✅ Plugin metadata (id, name, description)
- ✅ Schema validation and structure
- ✅ Required field validation
- ✅ Port range validation (1024-65535)
- ✅ Secret key length validation (32 characters)
- ✅ Server mode initialization
- ✅ Client mode initialization
- ✅ Plugin start validation
- ✅ Plugin stop and cleanup
- ✅ Multiple stop calls safety
- ✅ Router registration
- ✅ Configuration route handlers
- ✅ Filename validation in routes
- ✅ Error handling for invalid options

### `config.test.js`
Tests for configuration file operations.

**Coverage:**
- ✅ Configuration file initialization
- ✅ delta_timer.json creation
- ✅ subscription.json creation
- ✅ Default value population
- ✅ Existing file preservation
- ✅ Configuration loading
- ✅ Corrupted JSON handling
- ✅ Server mode config file behavior
- ✅ Missing field handling
- ✅ Invalid configuration structures

### `compression.test.js`
Tests for the compression and encryption pipeline.

**Coverage:**
- ✅ Brotli compression/decompression
- ✅ Empty data handling
- ✅ Large data compression
- ✅ Compression quality verification
- ✅ Full pipeline (Compress → Encrypt → Compress)
- ✅ Full reverse pipeline (Decompress → Decrypt → Decompress)
- ✅ Data integrity through full pipeline
- ✅ Compression ratio verification
- ✅ Error handling in compression
- ✅ Error handling in decompression
- ✅ Wrong decryption key detection
- ✅ Performance characteristics
- ✅ Repeated data compression efficiency

## Running Tests

### Run all tests
```bash
npm test
```

### Run tests in watch mode
```bash
npm run test:watch
```

### Generate coverage report
```bash
npm run test:coverage
```

### Run specific test file
```bash
npx jest __tests__/crypto.test.js
npx jest __tests__/index.test.js
npx jest __tests__/config.test.js
npx jest __tests__/compression.test.js
```

### Run tests with verbose output
```bash
npx jest --verbose
```

## Test Coverage Goals

| Module | Current Coverage | Goal |
|--------|-----------------|------|
| crypto.js | ~100% | 100% |
| index.js | ~70% | 85%+ |
| Configuration | ~80% | 90%+ |
| Pipeline | ~85% | 90%+ |

## Testing Best Practices

### 1. Isolation
Each test should be independent and not rely on the state from other tests.

### 2. Cleanup
Always clean up resources (files, timers, sockets) in `afterEach` hooks.

### 3. Mocking
Use Jest mocks for external dependencies (SignalK app, file system, network).

### 4. Async Testing
Use `async/await` or `done` callback for asynchronous tests.

### 5. Error Cases
Always test error handling paths, not just happy paths.

## Known Limitations

### UDP Socket Testing
UDP socket operations are not directly tested due to complexity of mocking network operations. These should be tested manually or with integration tests.

### Real Network Testing
Ping monitor and actual network connectivity are mocked. Real network tests should be performed in integration environment.

### Timer Testing
Long-running timers (e.g., hello messages) are not tested for exact timing due to test performance concerns.

## Future Test Improvements

### Priority 1 - Integration Tests
- [ ] End-to-end client-server communication
- [ ] Real UDP packet transmission
- [ ] Multi-instance scenarios
- [ ] Network failure scenarios

### Priority 2 - Performance Tests
- [ ] Compression benchmark suite
- [ ] Memory leak detection
- [ ] Large payload handling (10MB+)
- [ ] Sustained load testing

### Priority 3 - Security Tests
- [ ] IV collision detection (statistical)
- [ ] Timing attack resistance
- [ ] Malformed packet handling
- [ ] Key rotation scenarios

## Continuous Integration

### Recommended CI Pipeline
1. **Install dependencies**: `npm ci`
2. **Lint code**: `npm run lint`
3. **Run tests**: `npm test`
4. **Check coverage**: `npm run test:coverage`
5. **Build webapp**: `npm run build`

### Coverage Thresholds
Configure Jest to enforce minimum coverage:

```json
{
  "jest": {
    "coverageThreshold": {
      "global": {
        "branches": 75,
        "functions": 80,
        "lines": 80,
        "statements": 80
      }
    }
  }
}
```

## Debugging Tests

### Run single test
```bash
npx jest -t "should encrypt data successfully"
```

### Debug with Node inspector
```bash
node --inspect-brk node_modules/.bin/jest --runInBand
```

### Enable debug output
Set `DEBUG=*` environment variable for verbose logging during tests.

## Contributing

When adding new features:
1. Write tests first (TDD approach)
2. Ensure all tests pass
3. Maintain or improve coverage
4. Update this documentation

## Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Node.js Testing Best Practices](https://github.com/goldbergyoni/nodebestpractices#testing)
- [SignalK Plugin Documentation](https://github.com/SignalK/signalk-server/blob/master/SERVERPLUGINS.md)
