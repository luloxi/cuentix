import { defineConfig } from "drizzle-kit";

/**
 * SQLite dialect for local inspection. D1 migrations live in `migrations/`
 * and are applied with `wrangler d1 migrations apply`. Do not point `out`
 * at `migrations/` or drizzle-kit will mix generated files with those SQL files.
 */
export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
});
