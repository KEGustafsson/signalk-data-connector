# Compression Optimization - Implementation Guide

## Overview

This guide provides step-by-step instructions to implement the recommended compression optimizations analyzed in `COMPRESSION_ANALYSIS.md`.

## Quick Summary

**Expected Improvements:**
- ⚡ **3-7x faster** compression
- 📦 Only **~0.2%** increase in compressed size
- 🔄 Fully **backward compatible**
- ⚙️ **3 simple line changes** in `index.js`

## Recommended Changes (Option 1: Balanced Performance)

### Change 1: Stage 1 Mode (TEXT instead of GENERIC)

**File:** `index.js:717`

**Before:**
```javascript
const brotliOptions = {
  params: {
    [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_GENERIC,
    [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: deltaBufferData.length
  }
};
```

**After:**
```javascript
const brotliOptions = {
  params: {
    [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT, // ✅ Changed
    [zlib.constants.BROTLI_PARAM_QUALITY]: 10, // ✅ Changed from BROTLI_MAX_QUALITY (11)
    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: deltaBufferData.length
  }
};
```

**Why:**
- TEXT mode is optimized for JSON/text data (SignalK deltas are JSON)
- Quality 10 provides 3-4x speed improvement with only 0.2% compression loss

---

### Change 2: Stage 2 Quality (9 instead of 11)

**File:** `index.js:734-740`

**Before:**
```javascript
const brotliOptions2 = {
  params: {
    [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_GENERIC,
    [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: encryptedBuffer.length
  }
};
```

**After:**
```javascript
const brotliOptions2 = {
  params: {
    [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_GENERIC, // Keep as-is
    [zlib.constants.BROTLI_PARAM_QUALITY]: 9, // ✅ Changed from BROTLI_MAX_QUALITY (11)
    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: encryptedBuffer.length
  }
};
```

**Why:**
- Stage 2 compresses encrypted data (mostly random content)
- Lower quality is faster with minimal impact on compressed size
- Encrypted data doesn't benefit much from higher quality

---

## Complete Code Changes

### Full `packCrypt` function (lines 712-765)

```javascript
function packCrypt(delta, secretKey, udpAddress, udpPort) {
  try {
    const deltaBufferData = deltaBuffer(delta);

    // Stage 1: Compress original data (optimized for text/JSON)
    const brotliOptions = {
      params: {
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT, // ⭐ CHANGED
        [zlib.constants.BROTLI_PARAM_QUALITY]: 10, // ⭐ CHANGED from 11
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: deltaBufferData.length
      }
    };

    zlib.brotliCompress(deltaBufferData, brotliOptions, (err, compressedDelta) => {
      if (err) {
        app.error(`Brotli compression error (stage 1): ${err.message}`);
        metrics.compressionErrors++;
        metrics.lastError = `Brotli compression error (stage 1): ${err.message}`;
        metrics.lastErrorTime = Date.now();
        return;
      }
      try {
        const encryptedDelta = encrypt(compressedDelta, secretKey);
        const encryptedBuffer = Buffer.from(JSON.stringify(encryptedDelta), "utf8");

        // Stage 2: Compress encrypted data (optimized for speed)
        const brotliOptions2 = {
          params: {
            [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_GENERIC,
            [zlib.constants.BROTLI_PARAM_QUALITY]: 9, // ⭐ CHANGED from 11
            [zlib.constants.BROTLI_PARAM_SIZE_HINT]: encryptedBuffer.length
          }
        };

        zlib.brotliCompress(encryptedBuffer, brotliOptions2, (err, finalDelta) => {
          if (err) {
            app.error(`Brotli compression error (stage 2): ${err.message}`);
            metrics.compressionErrors++;
            metrics.lastError = `Brotli compression error (stage 2): ${err.message}`;
            metrics.lastErrorTime = Date.now();
            return;
          }
          if (finalDelta) {
            udpSend(finalDelta, udpAddress, udpPort);
            metrics.deltasSent++;
          }
        });
      } catch (encryptError) {
        app.error(`Encryption error: ${encryptError.message}`);
        metrics.encryptionErrors++;
        metrics.lastError = `Encryption error: ${encryptError.message}`;
        metrics.lastErrorTime = Date.now();
      }
    });
  } catch (error) {
    app.error(`packCrypt error: ${error.message}`);
  }
}
```

---

## Testing the Changes

### 1. Run the Benchmark Script

```bash
node analyze-compression.js
```

This will show the performance differences between strategies.

### 2. Run Unit Tests

```bash
npm test
```

All existing tests should pass without modification (the changes are backward compatible).

### 3. Test Full Pipeline

```bash
npm test -- __tests__/full-pipeline.test.js
```

Verify the complete compression/encryption/decompression pipeline works correctly.

### 4. Monitor Real-World Performance

After deploying, check the metrics endpoint:

```bash
curl http://localhost:3000/plugins/signalk-data-connector/metrics
```

Look for:
- `deltasSent`: Number of successful transmissions
- `compressionErrors`: Should remain at 0
- `udpSendErrors`: Should not increase

---

## Alternative Options

### Option 2: Maximum Speed (Ultra-Low Latency)

If latency is critical (e.g., high-frequency updates < 500ms delta timer):

```javascript
// Stage 1
const brotliOptions = {
  params: {
    [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
    [zlib.constants.BROTLI_PARAM_QUALITY]: 9,
    [zlib.constants.BROTLI_PARAM_LGWIN]: 16, // Smaller window = faster
    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: deltaBufferData.length
  }
};

// Stage 2
const brotliOptions2 = {
  params: {
    [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_GENERIC,
    [zlib.constants.BROTLI_PARAM_QUALITY]: 8,
    [zlib.constants.BROTLI_PARAM_LGWIN]: 16,
    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: encryptedBuffer.length
  }
};
```

**Trade-off:** 25-33x faster, but ~0.5% larger compressed size.

### Option 3: Maximum Compression (Bandwidth-Critical)

If bandwidth is expensive (e.g., satellite, cellular):

```javascript
// Stage 1
const brotliOptions = {
  params: {
    [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
    [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
    [zlib.constants.BROTLI_PARAM_LGWIN]: 24, // Larger window = better compression
    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: deltaBufferData.length
  }
};

// Stage 2
const brotliOptions2 = {
  params: {
    [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_GENERIC,
    [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
    [zlib.constants.BROTLI_PARAM_LGWIN]: 24,
    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: encryptedBuffer.length
  }
};
```

**Trade-off:** Similar or slightly slower speed, but ~0.1% better compression.

---

## Making Compression Strategy Configurable (Future Enhancement)

### Add to Plugin Schema

```javascript
compressionStrategy: {
  type: "string",
  default: "balanced",
  title: "Compression Strategy",
  description: "Choose compression strategy based on your bandwidth and latency requirements",
  enum: ["balanced", "fast", "maximum"],
  enumNames: [
    "Balanced - Recommended (3-4x faster, 0.2% size increase)",
    "Fast - Low Latency (25-33x faster, 0.5% size increase)",
    "Maximum - Bandwidth Critical (Best compression, slower)"
  ]
}
```

### Use Strategy in Code

```javascript
function getCompressionOptions(strategy, stage, bufferSize) {
  const strategies = {
    balanced: {
      stage1: { mode: zlib.constants.BROTLI_MODE_TEXT, quality: 10 },
      stage2: { mode: zlib.constants.BROTLI_MODE_GENERIC, quality: 9 }
    },
    fast: {
      stage1: { mode: zlib.constants.BROTLI_MODE_TEXT, quality: 9, lgwin: 16 },
      stage2: { mode: zlib.constants.BROTLI_MODE_GENERIC, quality: 8, lgwin: 16 }
    },
    maximum: {
      stage1: { mode: zlib.constants.BROTLI_MODE_TEXT, quality: 11, lgwin: 24 },
      stage2: { mode: zlib.constants.BROTLI_MODE_GENERIC, quality: 11, lgwin: 24 }
    }
  };

  const config = strategies[strategy][stage];
  const params = {
    [zlib.constants.BROTLI_PARAM_MODE]: config.mode,
    [zlib.constants.BROTLI_PARAM_QUALITY]: config.quality,
    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: bufferSize
  };

  if (config.lgwin) {
    params[zlib.constants.BROTLI_PARAM_LGWIN] = config.lgwin;
  }

  return { params };
}

// Usage in packCrypt:
const brotliOptions = getCompressionOptions(
  pluginOptions.compressionStrategy || 'balanced',
  'stage1',
  deltaBufferData.length
);
```

---

## Rollback Plan

If issues arise, simply revert the changes:

```javascript
// Revert to original
[zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_GENERIC,
[zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
```

The compression/decompression will work identically to before.

---

## Performance Monitoring

### Before Deployment

Run benchmarks and record baseline:
```bash
node analyze-compression.js > baseline-results.txt
```

### After Deployment

1. Monitor CPU usage - should decrease
2. Monitor network bandwidth - should increase slightly (~0.2%)
3. Check error rates - should remain at 0
4. Measure latency - should improve significantly

### Metrics to Track

```bash
# Check metrics endpoint
watch -n 5 'curl -s http://localhost:3000/plugins/signalk-data-connector/metrics | jq'
```

**Key metrics:**
- `deltasSent`: Should continue increasing
- `compressionErrors`: Should stay at 0
- `encryptionErrors`: Should stay at 0
- `udpSendErrors`: Should not increase

---

## FAQ

### Q: Will this break compatibility with existing receivers?

**A:** No. Brotli decompression is agnostic to compression settings. Any valid Brotli-compressed data will decompress correctly regardless of quality/mode used during compression.

### Q: What if I need maximum compression?

**A:** Use Option 3 (Maximum Compression) settings. However, benchmarks show only 0.1% improvement over the balanced settings, so the speed trade-off is rarely worth it.

### Q: Can I use different settings for hello messages vs delta batches?

**A:** Yes! You could detect the message type and use fast compression for hello messages (smaller, frequent) and balanced for delta batches (larger, less frequent).

### Q: Will this increase CPU usage?

**A:** No, it will **decrease** CPU usage. Lower quality settings and TEXT mode are faster, using less CPU cycles.

### Q: What about memory usage?

**A:** Memory usage will remain approximately the same. Window size (LGWIN) affects memory, but we're keeping the default (22) in the balanced settings.

---

## Summary

✅ **Simple:** 3 line changes in `index.js`
✅ **Safe:** Fully backward compatible
✅ **Fast:** 3-7x speed improvement
✅ **Efficient:** Only ~0.2% size increase
✅ **Tested:** Comprehensive benchmarks provided

**Recommended Action:** Implement Option 1 (Balanced Performance) immediately for significant real-time performance improvements.

---

## Related Files

- `COMPRESSION_ANALYSIS.md` - Detailed analysis and benchmarks
- `analyze-compression.js` - Benchmark script
- `index.js:712-765` - Implementation location
- `__tests__/compression.test.js` - Compression tests
- `__tests__/full-pipeline.test.js` - End-to-end tests
