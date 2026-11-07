// Sync tests run several in-process Postgres copies (PGlite) at once, which is slow on a shared CI runner. Each test
// file holds its own copies in memory, so files run a few at a time: all at once, a worker ran out and died.
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 30_000, poolOptions: { forks: { maxForks: 4, minForks: 1 } } } });
