import { getCloudflareContext } from "@opennextjs/cloudflare";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb } from "@/lib/db";
import {
  authAccount,
  authSession,
  authUser,
  authVerification,
} from "@/lib/db/schema";

const APP_ORIGIN = "https://cuentix.lulox.com.ar";

async function readEnv(name: string): Promise<string | undefined> {
  const fromProcess = process.env[name]?.trim();
  if (fromProcess) return fromProcess;
  if (process.env.NEXT_PHASE === "phase-production-build") return undefined;
  try {
    const { env } = await getCloudflareContext({ async: true });
    const value = (env as Record<string, unknown>)[name];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

export async function isAuthConfigured(): Promise<boolean> {
  return Boolean(await readEnv("BETTER_AUTH_SECRET"));
}

export async function isGoogleAuthConfigured(): Promise<boolean> {
  const id = await readEnv("GOOGLE_CLIENT_ID");
  const secret = await readEnv("GOOGLE_CLIENT_SECRET");
  return Boolean(id && secret);
}

/**
 * Better Auth on D1. Built per request because the D1 binding must not be
 * cached across requests. Returns null when the secret or the binding is missing
 * so public pages still render.
 */
export async function getAuth() {
  const secret = await readEnv("BETTER_AUTH_SECRET");
  if (!secret) return null;

  let db: Awaited<ReturnType<typeof getDb>>;
  try {
    db = await getDb();
  } catch {
    return null;
  }

  const baseURL =
    (await readEnv("BETTER_AUTH_URL")) ||
    (await readEnv("AUTH_URL")) ||
    APP_ORIGIN;
  const googleId = await readEnv("GOOGLE_CLIENT_ID");
  const googleSecret = await readEnv("GOOGLE_CLIENT_SECRET");

  return betterAuth({
    appName: "Cuentix",
    baseURL,
    secret,
    trustedOrigins: (request) => {
      const origins = [APP_ORIGIN];
      const host = request?.headers
        .get("host")
        ?.split(":")[0]
        ?.toLowerCase();
      if (host && host.endsWith(".workers.dev") && host.startsWith("cuentix")) {
        origins.push(`https://${host}`);
      }
      return origins;
    },
    database: drizzleAdapter(db, {
      provider: "sqlite",
      // D1 has no interactive transactions. The adapter default runs statements
      // one after another.
      transaction: false,
      schema: {
        auth_user: authUser,
        auth_session: authSession,
        auth_account: authAccount,
        auth_verification: authVerification,
      },
    }),
    advanced: {
      useSecureCookies: true,
      database: { generateId: "uuid" },
    },
    emailAndPassword: { enabled: false },
    user: { modelName: "auth_user" },
    session: { modelName: "auth_session" },
    account: {
      modelName: "auth_account",
      accountLinking: {
        enabled: true,
        trustedProviders: ["google"],
      },
    },
    verification: { modelName: "auth_verification" },
    socialProviders:
      googleId && googleSecret
        ? {
            google: {
              clientId: googleId,
              clientSecret: googleSecret,
            },
          }
        : undefined,
    plugins: [nextCookies()],
  });
}
