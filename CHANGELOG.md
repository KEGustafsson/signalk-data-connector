# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- **CRITICAL:** Fixed static IV vulnerability in encryption - now generates unique IV per encryption operation
- Added input validation for encryption/decryption operations
- Added secret key length validation (must be exactly 32 characters)

### Fixed

- Fixed file path bug for reading delta_timer.json configuration
- Fixed empty error handler in UDP send function
- Fixed unsafe equality comparison (== to ===)
- Improved error handling in compression and encryption operations
- Added proper error messages with context throughout the codebase

### Added

- Added comprehensive JSDoc documentation for all functions
- Added unit tests for crypto module with 100% coverage goals
- Added Jest test framework configuration
- Added Prettier code formatter configuration
- Added ESLint rules for security and code quality
- Added MIT LICENSE file
- Added constants for magic numbers to improve code maintainability
- Added memory leak prevention for deltas buffer (max 1000 items)
- Added connection monitoring debug logs
- Added npm scripts: test, test:watch, test:coverage, lint, lint:fix, format

### Changed

- Replaced `var` with `const`/`let` for proper scoping
- Improved error messages to be more descriptive and actionable
- Enhanced .eslintrc.js with Node.js environment and stricter rules
- Removed package-lock.json from .gitignore
- Updated package.json with development dependencies (Jest, ESLint, Prettier)

### Improved

- Better separation of concerns in packCrypt/unpackDecrypt functions
- More descriptive variable names in crypto operations
- Consistent error handling patterns throughout the codebase

## [1.0.0-beta.5] - 2024-10-08

### Features

- Encrypted UDP data transmission with AES-256
- Brotli compression (dual-layer: before and after encryption)
- Client/Server mode operation
- Configurable delta timer
- Flexible subscription system
- Modern web UI for configuration
- Real-time configuration without server restart
- Webpack build system with asset versioning
- Connectivity monitoring with ping checks

---

## Migration Guide for Security Fix

**IMPORTANT:** The security fix for static IV means that clients and servers running different versions of the plugin will NOT be compatible. All instances must be updated simultaneously.

### Steps to Update:

1. Stop all client and server instances
2. Update the plugin on all instances: `npm install` or reinstall from repository
3. Verify the secret key is exactly 32 characters in all configurations
4. Restart all instances
5. Monitor logs for any encryption/decryption errors

### Breaking Changes:

- Encrypted data format has changed due to unique IV per message
- Old encrypted messages cannot be decrypted by new version (and vice versa)
