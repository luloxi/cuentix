import { asc, eq } from "drizzle-orm";
import { getDb, hasDatabase, schema } from "@/lib/db";

/** Solo este email puede administrar accesos (panel /admin). */
export const ADMIN_EMAIL = "lucianoolivabianco@gmail.com";

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === ADMIN_EMAIL;
}

/** Bootstrap opcional vía env (coma-separado). Se suma a la tabla de la DB. */
function envAllowedEmails(): string[] {
  const fromEnv = process.env.ALLOWED_EMAILS;
  if (!fromEnv?.trim()) return [];
  return fromEnv
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export async function listAllowedEmails(): Promise<
  Array<{ email: string; createdAt: Date | null; source: "admin" | "db" | "env" }>
> {
  const rows: Array<{
    email: string;
    createdAt: Date | null;
    source: "admin" | "db" | "env";
  }> = [{ email: ADMIN_EMAIL, createdAt: null, source: "admin" }];

  const seen = new Set<string>([ADMIN_EMAIL]);

  if ((await hasDatabase())) {
    const db = (await getDb());
    const dbRows = await db
      .select()
      .from(schema.allowedEmails)
      .orderBy(asc(schema.allowedEmails.email));
    for (const r of dbRows) {
      const email = r.email.toLowerCase();
      if (seen.has(email)) continue;
      seen.add(email);
      rows.push({ email, createdAt: r.createdAt, source: "db" });
    }
  }

  for (const email of envAllowedEmails()) {
    if (seen.has(email)) continue;
    seen.add(email);
    rows.push({ email, createdAt: null, source: "env" });
  }

  return rows;
}

export async function isEmailAllowed(
  email: string | null | undefined,
): Promise<boolean> {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (isAdminEmail(normalized)) return true;

  if (envAllowedEmails().includes(normalized)) return true;

  if (!(await hasDatabase())) return false;

  const db = (await getDb());
  const [row] = await db
    .select({ email: schema.allowedEmails.email })
    .from(schema.allowedEmails)
    .where(eq(schema.allowedEmails.email, normalized))
    .limit(1);
  return Boolean(row);
}

export async function addAllowedEmail(
  email: string,
  createdBy?: string | null,
): Promise<{ email: string }> {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) {
    throw new Error("Email inválido");
  }
  if (isAdminEmail(normalized)) {
    return { email: normalized };
  }

  const db = (await getDb());
  await db
    .insert(schema.allowedEmails)
    .values({
      email: normalized,
      createdBy: createdBy ?? null,
    })
    .onConflictDoNothing();
  return { email: normalized };
}

export async function removeAllowedEmail(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (isAdminEmail(normalized)) {
    throw new Error("No se puede quitar al administrador");
  }
  const db = (await getDb());
  await db
    .delete(schema.allowedEmails)
    .where(eq(schema.allowedEmails.email, normalized));
}
