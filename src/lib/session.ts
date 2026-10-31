import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getAuth } from "@/lib/auth/server";
import { isEmailAllowed } from "@/lib/auth/allowlist";
import { getDb, hasDatabase } from "@/lib/db";
import { schema } from "@/lib/db";

export type AppUser = {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
};

type SessionResult =
  | { status: "ok"; user: AppUser }
  | { status: "anonymous" }
  | { status: "forbidden"; email: string | null }
  | { status: "unconfigured" };

export async function resolveSession(): Promise<SessionResult> {
  const auth = await getAuth();
  if (!auth) {
    return { status: "unconfigured" };
  }

  const { headers } = await import("next/headers");
  const session = await auth.api.getSession({ headers: await headers() });
  const raw = session?.user;

  if (!raw?.id) return { status: "anonymous" };

  if (!(await isEmailAllowed(raw.email))) {
    return { status: "forbidden", email: raw.email ?? null };
  }

  return {
    status: "ok",
    user: {
      id: raw.id,
      email: raw.email ?? null,
      name: raw.name ?? null,
      image: raw.image ?? null,
    },
  };
}

/** Upsert app user row so FKs work. */
export async function syncUser(user: AppUser) {
  if (!(await hasDatabase())) return;
  const db = (await getDb());
  const existing = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
    .limit(1);

  if (existing[0]) {
    // Keep an existing display name. The seeded app row is
    // "Agent"; the auth user name is the Google profile name. Linking must
    // not overwrite the app row.
    await db
      .update(schema.users)
      .set({
        email: user.email,
        image: existing[0].image ?? user.image,
      })
      .where(eq(schema.users.id, user.id));
    return;
  }

  if (user.email) {
    const byEmail = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, user.email))
      .limit(1);
    if (byEmail[0]) {
      // Prefer existing row id stability for households — rare edge case
      return byEmail[0];
    }
  }

  await db.insert(schema.users).values({
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
  });
}

export async function getCurrentUser(): Promise<AppUser | null> {
  const s = await resolveSession();
  if (s.status === "ok") return s.user;
  return null;
}

export async function requireUser(): Promise<AppUser> {
  const s = await resolveSession();
  if (s.status === "forbidden") redirect("/login?error=forbidden");
  if (s.status !== "ok") redirect("/login");
  await syncUser(s.user);
  return s.user;
}
