import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // Real local embedding inference (Xenova/all-MiniLM-L6-v2 via
    // @huggingface/transformers) replaced the free deterministic mock as
    // the default embedder (see localEmbedding.ts / retrievalEvaluator.ts).
    // Each test file runs in its own worker with its own in-memory model
    // cache, so the first embedding call in a file pays a real model-load
    // cost — the previous 5s default was tuned for a pure-function mock
    // and is no longer sufficient.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Running test files in parallel means every file's worker loads its
    // own copy of the ONNX runtime + model concurrently, starving each
    // other for CPU and blowing even a generous per-test timeout. Real
    // model inference is CPU-bound in a way the old pure-function mock
    // never was, so files run sequentially instead.
    fileParallelism: false,
  },
});
