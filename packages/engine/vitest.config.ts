// Sync tests run several in-process Postgres copies (PGlite) at once, which is slow on a shared CI runner.
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 30_000 } });
