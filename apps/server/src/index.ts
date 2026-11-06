// Starts the server: PostgreSQL from DATABASE_URL, or PGlite in DATA_DIR when there is none (desktop "this computer" mode).
import path from "node:path";
import fs from "node:fs";
import { buildApp } from "./app";
import { ServerKeyError } from "./auth";

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";
const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = process.env.DATABASE_URL
  ? (await import("@somnium/engine/pg")).pgDb(process.env.DATABASE_URL)
  : await (await import("@somnium/engine/pglite")).pgliteDb(path.join(DATA_DIR, "db"));

const { app } = await buildApp({
  db,
  dataDir: DATA_DIR,
  webDir: process.env.WEB_DIR,
  logger: process.env.LOG !== "0",
}).catch((e) => {
  if (!(e instanceof ServerKeyError)) throw e;
  console.error(e.message); // a bad key at start: the message says it all
  process.exit(1);
});
await app.listen({ host: HOST, port: PORT });

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, async () => { await app.close(); await db.close(); process.exit(0); });
