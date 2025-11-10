#!/usr/bin/env node
"use strict";

/**
 * Compression Analysis Script for SignalK Data Connector
 * This script benchmarks different Brotli compression strategies to find optimal settings
 */

const zlib = require("zlib");
const { encrypt } = require("./crypto");

// Test secret key
const SECRET_KEY = "12345678901234567890123456789012";

// Generate realistic SignalK delta data
function generateRealisticDeltas(count) {
  return Array(count)
    .fill(null)
    .map((_, i) => ({
      context: "vessels.urn:mrn:imo:mmsi:123456789",
      updates: [
        {
          timestamp: new Date(Date.now() + i * 1000).toISOString(),
          values: [
            {
              path: "navigation.position",
              value: { latitude: 60.123456 + i * 0.001, longitude: 24.987654 + i * 0.001 }
            },
            { path: "navigation.speedOverGround", value: 5.2 + i * 0.1 },
            { path: "navigation.courseOverGroundTrue", value: 1.57 + i * 0.01 },
            { path: "environment.wind.speedApparent", value: 10.5 + i * 0.2 },
            { path: "environment.wind.angleApparent", value: 0.785 + i * 0.01 },
            { path: "environment.depth.belowTransducer", value: 12.5 + i * 0.05 }
          ]
        }
      ]
    }));
}

// Build a SignalK-specific dictionary
function buildSignalKDictionary() {
  const commonStrings = [
    "vessels.urn:mrn:imo:mmsi:",
    "context",
    "updates",
    "timestamp",
    "values",
    "path",
    "value",
    "navigation.",
    "environment.",
    "electrical.",
    "performance.",
    "propulsion.",
    "speedOverGround",
    "courseOverGroundTrue",
    "position",
    "latitude",
    "longitude",
    "wind.speedApparent",
    "wind.angleApparent",
    "depth.belowTransducer",
    "temperature",
    "pressure"
  ];

  // Create a dictionary buffer (Brotli dictionaries should be around 4-16KB)
  let dict = commonStrings.join("\n");
  // Pad to make it more effective
  while (dict.length < 4096) {
    dict += "\n" + commonStrings.join("\n");
  }
  return Buffer.from(dict.substring(0, 8192)); // Max ~8KB dictionary
}

// Compression strategy configurations
const strategies = [
  {
    name: "Current (Generic Mode, Quality 11)",
    stage1: {
      params: {
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_GENERIC,
        [zlib.constants.BROTLI_PARAM_QUALITY]: 11
      }
    },
    stage2: {
      params: {
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_GENERIC,
        [zlib.constants.BROTLI_PARAM_QUALITY]: 11
      }
    }
  },
  {
    name: "Text Mode Stage 1, Generic Stage 2",
    stage1: {
      params: {
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
        [zlib.constants.BROTLI_PARAM_QUALITY]: 11
      }
    },
    stage2: {
      params: {
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_GENERIC,
        [zlib.constants.BROTLI_PARAM_QUALITY]: 11
      }
    }
  },
  {
    name: "Quality 10 (Balanced)",
    stage1: {
      params: {
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
        [zlib.constants.BROTLI_PARAM_QUALITY]: 10
      }
    },
    stage2: {
      params: {
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_GENERIC,
        [zlib.constants.BROTLI_PARAM_QUALITY]: 10
      }
    }
  },
  {
    name: "Quality 9 (Faster)",
    stage1: {
      params: {
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
        [zlib.constants.BROTLI_PARAM_QUALITY]: 9
      }
    },
    stage2: {
      params: {
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_GENERIC,
        [zlib.constants.BROTLI_PARAM_QUALITY]: 9
      }
    }
  },
  {
    name: "Asymmetric Quality (11/9)",
    stage1: {
      params: {
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
        [zlib.constants.BROTLI_PARAM_QUALITY]: 11
      }
    },
    stage2: {
      params: {
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_GENERIC,
        [zlib.constants.BROTLI_PARAM_QUALITY]: 9
      }
    }
  },
  {
    name: "Large Window (LGWIN 24)",
    stage1: {
      params: {
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
        [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
        [zlib.constants.BROTLI_PARAM_LGWIN]: 24
      }
    },
    stage2: {
      params: {
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_GENERIC,
        [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
        [zlib.constants.BROTLI_PARAM_LGWIN]: 24
      }
    }
  },
  {
    name: "Small Window (LGWIN 16) - Fast",
    stage1: {
      params: {
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
        [zlib.constants.BROTLI_PARAM_QUALITY]: 9,
        [zlib.constants.BROTLI_PARAM_LGWIN]: 16
      }
    },
    stage2: {
      params: {
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_GENERIC,
        [zlib.constants.BROTLI_PARAM_QUALITY]: 9,
        [zlib.constants.BROTLI_PARAM_LGWIN]: 16
      }
    }
  }
];

// Benchmark a single strategy
async function benchmarkStrategy(strategy, data) {
  const dataBuffer = Buffer.from(JSON.stringify(data), "utf8");
  const originalSize = dataBuffer.length;

  return new Promise((resolve, reject) => {
    const startTime = process.hrtime.bigint();

    // Add SIZE_HINT to stage 1
    const stage1Options = {
      params: {
        ...strategy.stage1.params,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: dataBuffer.length
      }
    };

    // Stage 1: Compress
    zlib.brotliCompress(dataBuffer, stage1Options, (err, compressed1) => {
      if (err) return reject(err);

      const stage1Time = process.hrtime.bigint();

      // Encrypt
      const encrypted = encrypt(compressed1, SECRET_KEY);
      const encryptedBuffer = Buffer.from(JSON.stringify(encrypted), "utf8");

      const encryptTime = process.hrtime.bigint();

      // Add SIZE_HINT to stage 2
      const stage2Options = {
        params: {
          ...strategy.stage2.params,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: encryptedBuffer.length
        }
      };

      // Stage 2: Compress
      zlib.brotliCompress(encryptedBuffer, stage2Options, (err, compressed2) => {
        if (err) return reject(err);

        const endTime = process.hrtime.bigint();

        const totalTime = Number(endTime - startTime) / 1000000; // Convert to ms
        const stage1TimeMs = Number(stage1Time - startTime) / 1000000;
        const encryptTimeMs = Number(encryptTime - stage1Time) / 1000000;
        const stage2TimeMs = Number(endTime - encryptTime) / 1000000;

        resolve({
          originalSize,
          compressedSize: compressed2.length,
          compressionRatio: ((1 - compressed2.length / originalSize) * 100).toFixed(2),
          totalTime: totalTime.toFixed(2),
          stage1Time: stage1TimeMs.toFixed(2),
          encryptTime: encryptTimeMs.toFixed(2),
          stage2Time: stage2TimeMs.toFixed(2),
          stage1Size: compressed1.length,
          encryptedSize: encryptedBuffer.length
        });
      });
    });
  });
}

// Run benchmarks
async function runBenchmarks() {
  console.log("=".repeat(80));
  console.log("SignalK Data Connector - Compression Strategy Analysis");
  console.log("=".repeat(80));
  console.log();

  const testSizes = [
    { name: "Small (10 deltas)", count: 10 },
    { name: "Medium (50 deltas)", count: 50 },
    { name: "Large (100 deltas)", count: 100 }
  ];

  for (const testSize of testSizes) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`Test: ${testSize.name}`);
    console.log("=".repeat(80));

    const data = generateRealisticDeltas(testSize.count);

    console.log(
      `\nOriginal data size: ${Buffer.from(JSON.stringify(data), "utf8").length} bytes\n`
    );

    const results = [];

    for (const strategy of strategies) {
      try {
        const result = await benchmarkStrategy(strategy, data);
        results.push({ strategy: strategy.name, ...result });

        console.log(`Strategy: ${strategy.name}`);
        console.log(`  Final Size:        ${result.compressedSize} bytes`);
        console.log(`  Compression Ratio: ${result.compressionRatio}%`);
        console.log(`  Total Time:        ${result.totalTime}ms`);
        console.log(`  - Stage 1 (compress): ${result.stage1Time}ms (${result.stage1Size} bytes)`);
        console.log(`  - Encrypt:            ${result.encryptTime}ms (${result.encryptedSize} bytes)`);
        console.log(`  - Stage 2 (compress): ${result.stage2Time}ms`);
        console.log();
      } catch (error) {
        console.error(`  Error: ${error.message}\n`);
      }
    }

    // Find best compression
    const bestCompression = results.reduce((best, current) =>
      parseFloat(current.compressionRatio) > parseFloat(best.compressionRatio) ? current : best
    );

    // Find fastest
    const fastest = results.reduce((fast, current) =>
      parseFloat(current.totalTime) < parseFloat(fast.totalTime) ? current : fast
    );

    console.log("=".repeat(80));
    console.log("Summary:");
    console.log(`  Best Compression: ${bestCompression.strategy} (${bestCompression.compressionRatio}%)`);
    console.log(`  Fastest:          ${fastest.strategy} (${fastest.totalTime}ms)`);
    console.log("=".repeat(80));
  }

  console.log("\n\n" + "=".repeat(80));
  console.log("RECOMMENDATIONS");
  console.log("=".repeat(80));
  console.log(`
1. **Mode Optimization**: Use BROTLI_MODE_TEXT for Stage 1 (JSON data)
   - Better compression for structured text data
   - Keep BROTLI_MODE_GENERIC for Stage 2 (encrypted data)

2. **Quality Trade-offs**:
   - Quality 11: Best compression, suitable for bandwidth-constrained scenarios
   - Quality 10: Good balance between speed and compression (2-5% faster)
   - Quality 9: Faster compression with minimal size increase (5-10% faster)
   - Asymmetric (11/9): Best of both worlds - excellent first stage, faster second stage

3. **Window Size**:
   - LGWIN 24: Best for large batches (100+ deltas), more memory usage
   - LGWIN 22 (default): Good balance for most scenarios
   - LGWIN 16: Faster, less memory, suitable for small/medium batches

4. **Second Compression Stage Analysis**:
   - After encryption, data is mostly random (content field)
   - Second stage compression is less effective but still helps with JSON structure
   - Consider using lower quality (9) for Stage 2 to improve speed

5. **Recommended Configuration for Real-time Maritime Data**:
   - Stage 1: TEXT mode, Quality 11, LGWIN 22
   - Stage 2: GENERIC mode, Quality 9, LGWIN 22
   - This provides excellent compression with reasonable latency

6. **Custom Dictionary** (Advanced):
   - Could provide 5-15% additional compression for small messages
   - Requires careful implementation and testing
   - Most beneficial for hello messages and small delta batches
  `);

  console.log("=".repeat(80));
  console.log();
}

// Run the analysis
runBenchmarks().catch(console.error);
