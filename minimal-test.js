#!/usr/bin/env node
"use strict";

const zlib = require("zlib");
const { encrypt, decrypt } = require("./crypto");

const SECRET_KEY = "12345678901234567890123456789012";

function preprocessDelta(delta) {
  if (Array.isArray(delta)) {
    return delta.map(d => {
      const processed = { ...d };
      if (processed.context && processed.context.includes("vessels.urn:mrn:imo:mmsi:")) {
        const mmsi = processed.context.split(":").pop();
        processed.c = mmsi;
        delete processed.context;
      }
      if (processed.updates && Array.isArray(processed.updates)) {
        processed.u = processed.updates.map(update => {
          const u = {};
          if (update.timestamp) u.t = update.timestamp;
          if (update.values) {
            u.v = update.values.map(val => ({
              p: val.path
                .replace("navigation.", "n.")
                .replace("environment.", "e.")
                .replace("electrical.", "l.")
                .replace("performance.", "f.")
                .replace("propulsion.", "r.")
                .replace("networking.", "w."),
              v: val.value
            }));
          }
          return u;
        });
        delete processed.updates;
      }
      return processed;
    });
  }
  return delta;
}

function restoreDelta(processed) {
  if (Array.isArray(processed)) {
    return processed.map(d => {
      const original = { ...d };
      if (original.c) {
        original.context = `vessels.urn:mrn:imo:mmsi:${original.c}`;
        delete original.c;
      }
      if (original.u) {
        original.updates = original.u.map(u => {
          const update = {};
          if (u.t) update.timestamp = u.t;
          if (u.v) {
            update.values = u.v.map(val => ({
              path: val.p
                .replace("n.", "navigation.")
                .replace("e.", "environment.")
                .replace("l.", "electrical.")
                .replace("f.", "performance.")
                .replace("r.", "propulsion.")
                .replace("w.", "networking."),
              value: val.v
            }));
          }
          return update;
        });
        delete original.u;
      }
      return original;
    });
  }
  return processed;
}

const testData = [{
  context: "vessels.urn:mrn:imo:mmsi:123456789",
  updates: [{
    timestamp: new Date().toISOString(),
    values: [
      { path: "navigation.position", value: { latitude: 60.123, longitude: 24.987 } },
      { path: "networking.modem.latencyTime", value: new Date() }
    ]
  }]
}];

console.log("=== Full Pipeline Test ===\n");
console.log("1. Original data:");
console.log(JSON.stringify(testData, null, 2));

// Step 1: Preprocess
const preprocessed = preprocessDelta(testData);
console.log("\n2. After preprocessing:");
console.log(JSON.stringify(preprocessed, null, 2));

// Step 2: Compress stage 1
const dataBuffer = Buffer.from(JSON.stringify(preprocessed), "utf8");
const opts1 = {
  params: {
    [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
    [zlib.constants.BROTLI_PARAM_QUALITY]: 9
  }
};

zlib.brotliCompress(dataBuffer, opts1, (err, compressed1) => {
  if (err) throw err;
  console.log(`\n3. After stage 1 compression: ${compressed1.length} bytes`);

  // Step 3: Encrypt
  const encrypted = encrypt(compressed1, SECRET_KEY);
  const encryptedBuffer = Buffer.from(JSON.stringify(encrypted), "utf8");
  console.log(`4. After encryption: ${encryptedBuffer.length} bytes`);

  // Step 4: Compress stage 2
  const opts2 = {
    params: {
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_GENERIC,
      [zlib.constants.BROTLI_PARAM_QUALITY]: 8
    }
  };

  zlib.brotliCompress(encryptedBuffer, opts2, (err, compressed2) => {
    if (err) throw err;
    console.log(`5. After stage 2 compression: ${compressed2.length} bytes`);

    // Now decompress in reverse
    zlib.brotliDecompress(compressed2, (err, decompressed1) => {
      if (err) throw err;

      const encryptedData = JSON.parse(decompressed1.toString("utf8"));
      const decryptedData = decrypt(encryptedData, SECRET_KEY);

      zlib.brotliDecompress(decryptedData, (err, decompressed2) => {
        if (err) throw err;

        const parsed = JSON.parse(decompressed2.toString());
        console.log("\n6. After full decompression (parsed):");
        console.log(JSON.stringify(parsed, null, 2));

        const restored = restoreDelta(parsed);
        console.log("\n7. After restoration:");
        console.log(JSON.stringify(restored, null, 2));

        console.log("\n=== Comparison ===");
        const originalJSON = JSON.stringify(testData);
        const restoredJSON = JSON.stringify(restored);

        console.log("Original length:", originalJSON.length);
        console.log("Restored length:", restoredJSON.length);
        console.log("Match:", originalJSON === restoredJSON ? "✓ PASS" : "✗ FAIL");

        if (originalJSON !== restoredJSON) {
          console.log("\nFinding first difference...");
          for (let i = 0; i < Math.max(originalJSON.length, restoredJSON.length); i++) {
            if (originalJSON[i] !== restoredJSON[i]) {
              console.log(`Position ${i}:`);
              console.log(`  Original: ...${originalJSON.substring(Math.max(0, i-30), i+30)}...`);
              console.log(`  Restored: ...${restoredJSON.substring(Math.max(0, i-30), i+30)}...`);
              break;
            }
          }
        }
      });
    });
  });
});
