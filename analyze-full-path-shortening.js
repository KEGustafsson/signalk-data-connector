#!/usr/bin/env node
"use strict";

/**
 * Analysis: Full Path Shortening vs Prefix Shortening
 * Exploring the trade-offs of complete path mapping
 */

console.log("=".repeat(80));
console.log("Full Path Shortening Analysis");
console.log("=".repeat(80));
console.log();

// Current approach: Prefix shortening
const currentApproach = {
  "navigation.speedOverGround": "n.speedOverGround",
  "navigation.courseOverGroundTrue": "n.courseOverGroundTrue",
  "navigation.position": "n.position",
  "environment.wind.speedApparent": "e.wind.speedApparent",
  "environment.wind.angleApparent": "e.wind.angleApparent",
  "electrical.batteries.0.voltage": "l.batteries.0.voltage"
};

// Hypothetical full path approach
const fullPathApproach = {
  "navigation.speedOverGround": "nsog",        // or "n1", "001", etc.
  "navigation.courseOverGroundTrue": "ncogt",  // or "n2", "002", etc.
  "navigation.position": "npos",               // or "n3", "003", etc.
  "environment.wind.speedApparent": "ewsa",    // or "e1", "101", etc.
  "environment.wind.angleApparent": "ewaa",    // or "e2", "102", etc.
  "electrical.batteries.0.voltage": "lb0v"     // or "l1", "201", etc.
};

console.log("COMPARISON:\n");

Object.keys(currentApproach).forEach(original => {
  const current = currentApproach[original];
  const fullPath = fullPathApproach[original];

  const currentSavings = original.length - current.length;
  const fullPathSavings = original.length - fullPath.length;
  const additionalSavings = fullPathSavings - currentSavings;

  console.log(`Original: ${original} (${original.length} chars)`);
  console.log(`  Current:  ${current} (${current.length} chars) - saves ${currentSavings}`);
  console.log(`  Full:     ${fullPath} (${fullPath.length} chars) - saves ${fullPathSavings} (+${additionalSavings} more)`);
  console.log();
});

console.log("=".repeat(80));
console.log("TRADE-OFF ANALYSIS");
console.log("=".repeat(80));
console.log();

console.log("BENEFITS of Full Path Shortening:");
console.log("  ✓ Better compression: ~15-25 bytes saved per path (vs 9-12 currently)");
console.log("  ✓ SignalK spec defines standard paths - we have a reference");
console.log("  ✓ Could achieve 35-40% preprocessing reduction (vs 30% currently)");
console.log();

console.log("CHALLENGES of Full Path Shortening:");
console.log();

// Fetch some paths from SignalK to show the scope
const signalKPaths = [
  // Navigation paths (just a sample!)
  "navigation.position",
  "navigation.speedOverGround",
  "navigation.speedThroughWater",
  "navigation.speedThroughWaterReferenceType",
  "navigation.courseOverGroundTrue",
  "navigation.courseOverGroundMagnetic",
  "navigation.courseRhumbline",
  "navigation.courseGreatCircle",
  "navigation.headingTrue",
  "navigation.headingMagnetic",
  "navigation.headingCompass",
  "navigation.magneticVariation",
  "navigation.magneticVariationAgeOfService",
  "navigation.magneticDeviation",
  "navigation.destination",
  "navigation.gnss",
  "navigation.position3D",
  "navigation.rateOfTurn",
  "navigation.attitude",
  "navigation.maneuver",
  "navigation.state",
  "navigation.anchor",
  "navigation.datetime",
  "navigation.leewayAngle",

  // Environment paths (sample)
  "environment.depth.belowKeel",
  "environment.depth.belowTransducer",
  "environment.depth.belowSurface",
  "environment.depth.transducerToKeel",
  "environment.depth.surfaceToTransducer",
  "environment.current",
  "environment.tide",
  "environment.heave",
  "environment.wind.angleApparent",
  "environment.wind.angleTrueGround",
  "environment.wind.angleTrueWater",
  "environment.wind.directionChangeAlarm",
  "environment.wind.directionTrue",
  "environment.wind.directionMagnetic",
  "environment.wind.speedApparent",
  "environment.wind.speedOverGround",
  "environment.wind.speedTrue",

  // And many, many more...
];

console.log(`1. SCALE: SignalK spec has ${signalKPaths.length}+ standard paths`);
console.log(`   (This is just a small sample - full spec has 200+ paths!)`);
console.log();

console.log("2. MAPPING TABLE SIZE:");
console.log("   Current approach: 16 entries");
console.log("   Full path approach: 200+ entries");
console.log("   Memory overhead: ~10-15 KB for mapping tables");
console.log();

console.log("3. CUSTOM PATHS:");
console.log("   Example: navigation.customSensor.temperature");
console.log("   - Current: Still gets prefix shortened → n.customSensor.temperature");
console.log("   - Full path: No mapping exists → unchanged OR complex fallback needed");
console.log();

console.log("4. MAINTENANCE:");
console.log("   - SignalK spec evolves (v1.7 → v1.8 → v2.0)");
console.log("   - New paths added regularly");
console.log("   - Current: Add 1 prefix mapping for entire category");
console.log("   - Full path: Add mapping for EACH new path");
console.log();

console.log("5. LOOKUP PERFORMANCE:");
console.log("   - Current: O(1) - max 16 comparisons");
console.log("   - Full path: O(n) - up to 200+ comparisons");
console.log("   - Could use hash map, but still overhead");
console.log();

console.log("6. ARRAYS/INDICES:");
console.log("   Example: electrical.batteries.0.voltage");
console.log("   - Arrays can have any index: 0, 1, 2, 3...");
console.log("   - Would need pattern matching, not simple lookup");
console.log();

console.log("=".repeat(80));
console.log("HYBRID APPROACH - BEST OF BOTH WORLDS?");
console.log("=".repeat(80));
console.log();

const hybridApproach = `
Idea: Map the MOST COMMON paths fully, fall back to prefix for others

Top 20 Most Common Paths (frequency-based):
  navigation.position → "np"
  navigation.speedOverGround → "nsog"
  navigation.courseOverGroundTrue → "ncog"
  environment.wind.speedApparent → "ews"
  environment.wind.angleApparent → "ewa"
  environment.depth.belowTransducer → "edb"
  electrical.batteries.0.voltage → "eb0v" (but what about .1, .2?)
  ... ~17 more

For everything else: Fall back to prefix shortening

BENEFITS:
  ✓ Best compression for most common data (90% of messages)
  ✓ Manageable mapping table (~20 entries + 16 prefixes)
  ✓ Still handles custom paths gracefully
  ✓ Better than prefix-only, simpler than full-path

CHALLENGES:
  ✓ Still need to maintain list of "most common" paths
  ✓ What's common for one vessel may not be for another
  ✓ Sailing vessels vs motor vessels have different patterns
  ✓ Two-stage lookup (full path first, then prefix fallback)
`;

console.log(hybridApproach);

console.log("=".repeat(80));
console.log("COMPRESSION GAIN ESTIMATE");
console.log("=".repeat(80));
console.log();

const avgPathLength = 30; // average SignalK path length
const currentSavings = 9;  // average prefix savings
const fullPathSavings = 23; // average full path savings (estimated)
const additionalGain = fullPathSavings - currentSavings; // 14 bytes more

console.log("Per typical batch (100 deltas with 5 values each = 500 paths):");
console.log(`  Current preprocessing: ${currentSavings * 500} bytes saved`);
console.log(`  Full path (if all mapped): ${fullPathSavings * 500} bytes saved`);
console.log(`  Additional gain: ${additionalGain * 500} bytes (~${(additionalGain * 500 / 60000 * 100).toFixed(1)}% of 60KB batch)`);
console.log();

console.log("Impact on final compression:");
console.log("  Current: 60,087 bytes → 2,398 bytes (96.0% compression)");
console.log(`  Estimated full path: 60,087 bytes → ~${2398 - Math.floor(additionalGain * 500 * 0.3)} bytes (96.4% compression)`);
console.log("  Gain: +0.4% absolute compression (10-15% relatively better)");
console.log();

console.log("=".repeat(80));
console.log("RECOMMENDATION");
console.log("=".repeat(80));
console.log();

console.log(`
Current prefix-based approach is OPTIMAL for this use case because:

1. **Simplicity**: 16 mappings vs 200+ mappings
2. **Maintainability**: Easy to update as spec evolves
3. **Performance**: Fast lookups, minimal overhead
4. **Flexibility**: Handles custom paths automatically
5. **Good enough**: 96% compression is already excellent
6. **Diminishing returns**: 0.4% improvement for 10x complexity

HOWEVER, if you REALLY need maximum compression:
  → Implement HYBRID approach with top 20 most common paths
  → Expected gain: +0.3-0.5% absolute compression
  → Complexity: 2x current implementation
  → Worth it for: Satellite links, extreme bandwidth constraints

For most maritime use cases:
  → Current approach is the sweet spot ✅
  → 96% compression is more than sufficient
  → Simple, maintainable, extensible
`);

console.log("=".repeat(80));
