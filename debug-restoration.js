#!/usr/bin/env node
"use strict";

/**
 * Debug script to identify restoration issues
 */

// Preprocessing: Shorten keys for better compression
function preprocessDelta(delta) {
  if (Array.isArray(delta)) {
    return delta.map(d => {
      const processed = { ...d };

      // Shorten context
      if (processed.context && processed.context.includes("vessels.urn:mrn:imo:mmsi:")) {
        const mmsi = processed.context.split(":").pop();
        processed.c = mmsi;
        delete processed.context;
      }

      // Shorten updates structure
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

// Restore preprocessed delta
function restoreDelta(processed) {
  if (Array.isArray(processed)) {
    return processed.map(d => {
      const original = { ...d };

      // Restore context
      if (original.c) {
        original.context = `vessels.urn:mrn:imo:mmsi:${original.c}`;
        delete original.c;
      }

      // Restore updates structure
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

// Test data
const testData = [
  {
    context: "vessels.urn:mrn:imo:mmsi:123456789",
    updates: [
      {
        timestamp: "2024-01-01T00:00:00.000Z",
        values: [
          { path: "navigation.position", value: { latitude: 60.123, longitude: 24.987 } },
          { path: "environment.wind.speedApparent", value: 10.5 }
        ]
      }
    ]
  }
];

console.log("Original data:");
console.log(JSON.stringify(testData, null, 2));

const preprocessed = preprocessDelta(testData);
console.log("\nPreprocessed data:");
console.log(JSON.stringify(preprocessed, null, 2));

const restored = restoreDelta(preprocessed);
console.log("\nRestored data:");
console.log(JSON.stringify(restored, null, 2));

const match = JSON.stringify(testData) === JSON.stringify(restored);
console.log("\nData integrity:", match ? "✓ PASS" : "✗ FAIL");

if (!match) {
  console.log("\nOriginal JSON:");
  console.log(JSON.stringify(testData));
  console.log("\nRestored JSON:");
  console.log(JSON.stringify(restored));

  // Find differences
  const origStr = JSON.stringify(testData);
  const restStr = JSON.stringify(restored);

  for (let i = 0; i < Math.max(origStr.length, restStr.length); i++) {
    if (origStr[i] !== restStr[i]) {
      console.log(`\nFirst difference at position ${i}:`);
      console.log(`Original: ...${origStr.substring(Math.max(0, i-20), i+20)}...`);
      console.log(`Restored: ...${restStr.substring(Math.max(0, i-20), i+20)}...`);
      break;
    }
  }
}
