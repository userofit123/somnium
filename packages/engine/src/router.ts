// A small router: "GET /routines/:id" → handler(ctx, params, body, query).
import type { Sql } from "./db";
import type { Change } from "@somnium/shared";

export interface Ctx {
  q: Sql;
  userId: string;
  mode: "server" | "local";
  /** Announce what changed, so every open screen on every device updates (PLAN.md §5). */
  changed: (...c: Change[]) => void;
  now: () => Date;
}
export type Handler = (ctx: Ctx, params: Record<string, string>, body: any, query: Record<string, string>) => Promise<unknown>;
interface Route { method: string; parts: string[]; handler: Handler }

export class Router {
  private routes: Route[] = [];
  add(method: string, path: string, handler: Handler) {
    this.routes.push({ method, parts: path.split("/").filter(Boolean), handler });
    return this;
  }
  get = (p: string, h: Handler) => this.add("GET", p, h);
  post = (p: string, h: Handler) => this.add("POST", p, h);
  put = (p: string, h: Handler) => this.add("PUT", p, h);
  del = (p: string, h: Handler) => this.add("DELETE", p, h);
  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
    const parts = path.split("/").filter(Boolean);
    for (const r of this.routes) {
      if (r.method !== method || r.parts.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < parts.length; i++) {
        const want = r.parts[i]!;
        if (want.startsWith(":")) params[want.slice(1)] = decodeURIComponent(parts[i]!);
        else if (want !== parts[i]) { ok = false; break; }
      }
      if (ok) return { handler: r.handler, params };
    }
    return null;
  }
}
