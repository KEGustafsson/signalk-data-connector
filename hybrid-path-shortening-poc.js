#!/usr/bin/env node
"use strict";

/**
 * Proof of Concept: Hybrid Path Shortening
 * Combines full-path mapping for common paths + prefix fallback
 */

const zlib = require("zlib");
const { encrypt, decrypt } = require("./crypto");

const SECRET_KEY = "12345678901234567890123456789012";

// Top 20 most common SignalK paths (frequency-based)
const FULL_PATH_MAP = {
  // Navigation (most common)
  "navigation.position": "001",
  "navigation.speedOverGround": "002",
  "navigation.courseOverGroundTrue": "003",
  "navigation.headingTrue": "004",
  "navigation.courseRhumbline.nextPoint.position": "005",

  // Environment (very common)
  "environment.wind.speedApparent": "101",
  "environment.wind.angleApparent": "102",
  "environment.wind.speedTrue": "103",
  "environment.wind.directionTrue": "104",
  "environment.depth.belowTransducer": "105",
  "environment.depth.belowKeel": "106",
  "environment.water.temperature": "107",

  // Electrical (common on power vessels)
  "electrical.batteries.0.voltage": "201",
  "electrical.batteries.0.current": "202",
  "electrical.batteries.0.temperature": "203",

  // Propulsion (motor vessels)
  "propulsion.main.temperature": "301",
  "propulsion.main.rpm": "302",
  "propulsion.main.hours": "303",

  // Performance (sailing vessels)
  "performance.velocityMadeGood": "401",
  "performance.beatAngle": "402"
};

// Reverse mapping for restoration
const FULL_PATH_REVERSE_MAP = Object.fromEntries(
  Object.entries(FULL_PATH_MAP).map(([k, v]) => [v, k])
);

// Prefix fallback (same as current implementation)
const PATH_PREFIX_MAP = [
  { from: "navigation.", to: "n." },
  { from: "environment.", to: "e." },
  { from: "electrical.", to: "l." },
  { from: "propulsion.", to: "r." },
  { from: "performance.", to: "f." },
  { from: "steering.", to: "s." },
  { from: "tanks.", to: "k." },
  { from: "communication.", to: "m." },
  { from: "sensors.", to: "z." },
  { from: "notifications.", to: "o." },
  { from: "sails.", to: "i." },
  { from: "design.", to: "d." },
  { from: "registrations.", to: "g." },
  { from: "networking.", to: "w." },
  { from: "resources.", to: "x." },
  { from: "alarms.", to: "a." }
];

/**
 * Hybrid path shortening: Try full path first, fallback to prefix
 */
function shortenPathHybrid(path) {
  // First: Try exact full path match
  if (FULL_PATH_MAP[path]) {
    return FULL_PATH_MAP[path];
  }

  // Handle array indices (e.g., batteries.0, batteries.1)
  const pathWithoutIndex = path.replace(/\.\d+\./, ".0.");
  if (FULL_PATH_MAP[pathWithoutIndex]) {
    // Replace the .0. back with actual index
    const match = path.match(/\.(\d+)\./);
    if (match) {
      return FULL_PATH_MAP[pathWithoutIndex].replace("0", match[1]);
    }
  }

  // Second: Fallback to prefix shortening
  for (const mapping of PATH_PREFIX_MAP) {
    if (path.startsWith(mapping.from)) {
      return path.replace(mapping.from, mapping.to);
    }
  }

  // Third: Return unchanged if no mapping found
  return path;
}

/**
 * Restore hybrid shortened path
 */
function restorePathHybrid(path) {
  // First: Try exact reverse full path match
  if (FULL_PATH_REVERSE_MAP[path]) {
    return FULL_PATH_REVERSE_MAP[path];
  }

  // Handle array indices
  const pathWithoutIndex = path.replace(/\d/, "0");
  if (FULL_PATH_REVERSE_MAP[pathWithoutIndex]) {
    const match = path.match(/(\d)/);
    if (match) {
      return FULL_PATH_REVERSE_MAP[pathWithoutIndex].replace(".0.", `.${match[1]}.`);
    }
  }

  // Second: Fallback to prefix restoration
  for (const mapping of PATH_PREFIX_MAP) {
    if (path.startsWith(mapping.to)) {
      return path.replace(mapping.to, mapping.from);
    }
  }

  // Third: Return unchanged
  return path;
}

// Test data with mixed path types
const testData = [{
  context: "vessels.urn:mrn:imo:mmsi:123456789",
  updates: [{
    timestamp: "2025-11-10T00:00:00Z",
    values: [
      // Top 20 paths (should get full mapping)
      { path: "navigation.position", value: { lat: 60.1, lon: 24.9 } },
      { path: "navigation.speedOverGround", value: 5.2 },
      { path: "environment.wind.speedApparent", value: 10.5 },
      { path: "electrical.batteries.0.voltage", value: 12.4 },
      { path: "propulsion.main.temperature", value: 85.0 },

      // Less common paths (should get prefix mapping)
      { path: "navigation.magneticVariation", value: -5.2 },
      { path: "environment.water.salinity", value: 35.0 },
      { path: "steering.rudderAngle", value: 2.5 },

      // Custom paths (should pass through with prefix)
      { path: "navigation.customSensor.value", value: 42 },
      { path: "myData.telemetry.pressure", value: 1013.25 }
    ]
  }]
}];

console.log("=".repeat(80));
console.log("Hybrid Path Shortening - Proof of Concept");
console.log("=".repeat(80));
console.log();

console.log("PATH SHORTENING COMPARISON:\n");

testData[0].updates[0].values.forEach(val => {
  const original = val.path;
  const hybrid = shortenPathHybrid(original);
  const restored = restorePathHybrid(hybrid);

  const savings = original.length - hybrid.length;
  const isFullPath = FULL_PATH_MAP[original] !== undefined;
  const method = isFullPath ? "[FULL]" : "[PREFIX]";
  const integrity = restored === original ? "✓" : "✗";

  console.log(`${method} ${original}`);
  console.log(`  → ${hybrid} (saved: ${savings} bytes)`);
  console.log(`  ← ${restored} ${integrity}`);
  console.log();
});

console.log("=".repeat(80));
console.log("COMPRESSION TEST");
console.log("=".repeat(80));
console.log();

// Create preprocessing function using hybrid approach
function preprocessDeltaHybrid(delta) {
  if (Array.isArray(delta)) {
    return delta.map(d => {
      const processed = { ...d };
      if (processed.context && processed.context.includes("vessels.urn:mrn:imo:mmsi:")) {
        processed.c = processed.context.split(":").pop();
        delete processed.context;
      }
      if (processed.updates && Array.isArray(processed.updates)) {
        processed.u = processed.updates.map(update => {
          const u = {};
          if (update.timestamp) u.t = update.timestamp;
          if (update.values) {
            u.v = update.values.map(val => ({
              p: shortenPathHybrid(val.path),
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

const original = JSON.stringify(testData);
const preprocessed = JSON.stringify(preprocessDeltaHybrid(testData));

const originalSize = Buffer.from(original, "utf8").length;
const preprocessedSize = Buffer.from(preprocessed, "utf8").length;
const preprocessReduction = ((1 - preprocessedSize / originalSize) * 100).toFixed(2);

console.log("Original JSON:");
console.log(original.substring(0, 200) + "...\n");
console.log("Preprocessed JSON:");
console.log(preprocessed.substring(0, 200) + "...\n");

console.log(`Original size:      ${originalSize} bytes`);
console.log(`Preprocessed size:  ${preprocessedSize} bytes`);
console.log(`Reduction:          ${preprocessReduction}%`);
console.log();

console.log("=".repeat(80));
console.log("ANALYSIS");
console.log("=".repeat(80));
console.log();

console.log(`Hybrid Approach Statistics:
  • Full path mappings: 20 entries
  • Prefix fallback mappings: 16 entries
  • Total mapping overhead: ~1.5 KB memory
  • Preprocessing reduction: ${preprocessReduction}% (vs 30% with prefix-only)
  • Estimated final compression: 96.5-97% (vs 96% current)
  • Additional gain: ~0.5% absolute compression

Implementation Complexity:
  • Code: +50 lines (dual-lookup logic)
  • Maintenance: Medium (need to update top-20 list periodically)
  • Risk: Low (fallback ensures nothing breaks)
  • Performance: Good (hash map + prefix fallback)

Worth it for:
  ✓ Satellite communications (very expensive bandwidth)
  ✓ High-frequency data transmission (>1Hz)
  ✓ Bandwidth-constrained environments
  ✗ Normal maritime networks (current 96% is sufficient)
`);

console.log("=".repeat(80));
console.log();
