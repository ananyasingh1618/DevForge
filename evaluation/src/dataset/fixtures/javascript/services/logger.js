// Fixture file for DevForge's evaluation dataset (Phase 13). Small, synthetic,
// non-sensitive sample code written for this dataset — not copied from any
// real project. Deliberately clean, plain JavaScript — used as a
// "no actual issue" review case for a JS file.

/**
 * Logs a structured event with a timestamp. No external I/O, no
 * sensitive data handling — nothing here should be flagged by review.
 */
function logEvent(name, data) {
  const entry = { name, data, timestamp: new Date().toISOString() };
  console.log(JSON.stringify(entry));
  return entry;
}

module.exports = { logEvent };
