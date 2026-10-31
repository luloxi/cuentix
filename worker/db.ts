/**
 * Drizzle on D1 is available for rare code paths via `await import("./db")`.
 * Stage-1 routes do not import this module: evaluating drizzle-orm at
 * startup was ~8 ms, which does not fit the Workers free-plan CPU limit.
 * Hot paths use `env.DB.prepare` instead.
 */
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../src/lib/db/schema";
import type { Env } from "./env";

export { schema };

export function getDb(env: Env) {
  return drizzle(env.DB as unknown as Parameters<typeof drizzle>[0], { schema });
}

export type AppDb = ReturnType<typeof getDb>;
