import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

/**
 * Per-request D1 accessor. The binding only exists inside a Worker request
 * (`getCloudflareContext`), including route handlers, server components, and
 * `src/proxy.ts`. Do not cache the binding across requests.
 */
export type AppDatabase = ReturnType<typeof drizzle<typeof schema>>;

let testDb: AppDatabase | null = null;

/** Test hook. Production code leaves this unset. */
export function setDatabaseForTests(db: AppDatabase | null) {
  testDb = db;
}

function duringBuild(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

export async function getDb(): Promise<AppDatabase> {
  if (testDb) return testDb;
  if (duringBuild()) {
    throw new Error("D1 no está disponible durante el build.");
  }
  const { env } = await getCloudflareContext({ async: true });
  const binding = env.DB;
  if (!binding) {
    throw new Error(
      "El binding D1 DB no está configurado en este Worker.",
    );
  }
  return drizzle(binding as Parameters<typeof drizzle>[0], { schema });
}

export async function hasDatabase(): Promise<boolean> {
  if (testDb) return true;
  if (duringBuild()) return false;
  try {
    const { env } = await getCloudflareContext({ async: true });
    return Boolean(env.DB);
  } catch {
    return false;
  }
}

export { schema };
