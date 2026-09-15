// Standalone adversarial fixture (Retrieval Target Closure, Milestone A6).
// Deliberately separate from the main evaluation/src/dataset/fixtures/ tree
// and never referenced by RETRIEVAL_CASES/regression gates — see
// retrievalAdversarial.test.ts for how this is exercised.

export type ScheduledTask = { id: string; runAt: Date; retries: number };

/**
 * Checks that a proposed run time is in the future and the retry count is
 * non-negative before a task is accepted. A neighboring helper called by
 * scheduleTask below.
 */
export function validateSchedule(task: ScheduledTask): void {
  if (task.runAt.getTime() <= Date.now()) {
    throw new Error(`Task ${task.id} must be scheduled in the future`);
  }
  if (task.retries < 0) {
    throw new Error(`Task ${task.id} has a negative retry count`);
  }
}

/**
 * Validates and registers a new scheduled task. The parent orchestrator
 * that calls validateSchedule above.
 */
export function scheduleTask(task: ScheduledTask): ScheduledTask {
  validateSchedule(task);
  return task;
}
