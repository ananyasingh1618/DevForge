import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createApp } from "./app.js";
import { env } from "./env.js";
import { startWorker } from "./services/jobWorker.js";

const app = createApp();

const httpServer = app.listen(env.PORT, () => {
  console.log(`DevForge API listening on port ${env.PORT} (${env.NODE_ENV})`);
});

// Starts the Phase 15 job worker in the same process as the API server —
// this was built and tested in isolation (jobWorker.test.ts) but was never
// actually invoked anywhere outside tests, meaning jobs created over HTTP
// would sit in "queued" forever on a real deployment. A separate worker
// process is a reasonable future evolution, but running it in-process here
// is the minimal fix that makes the job system actually work end to end
// without adding new infrastructure (no new service, no new Dockerfile).
const worker = startWorker(`api-${process.pid}-${randomUUID()}`);

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}, shutting down gracefully...`);
  await worker.stop();
  httpServer.close(() => {
    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
