// Sync tests run several in-process Postgres copies (PGlite) at once, which is slow on a shared CI runner. Each test
// file holds its own copies in memory, so files run two at a time: with more (and other work on the machine) a worker ran out of memory and died.
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 30_000, poolOptions: { forks: { maxForks: 2, minForks: 1 } } } });
