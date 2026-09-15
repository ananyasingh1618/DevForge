// Standalone adversarial fixture (Retrieval Target Closure, Milestone A6).
// Deliberately has a function with the exact same name as scheduler.ts's
// scheduleTask, but a completely different, legacy in-memory implementation
// with no validation at all -- tests same-symbol-name-different-file
// disambiguation by query wording alone.

const legacyQueue = [];

/**
 * The old, pre-validation task scheduler kept only for a still-running
 * legacy batch job. Pushes the task straight onto an in-memory queue with
 * no checks of any kind -- unlike the real, current scheduleTask in
 * scheduler.ts.
 */
function scheduleTask(task) {
  legacyQueue.push(task);
  return task;
}

module.exports = { scheduleTask };
