import {
  handleGoogleCallback,
  handleGoogleStart,
  handleLogout,
  isUser,
  requireUser,
} from "./auth";
import { handleCategories } from "./categories";
import { handleDashboard } from "./dashboard";
import type { Env, WorkerContext } from "./env";
import { json, notPorted } from "./http";
import { handleHouseholdActive, handleMe } from "./household-routes";
import { flushOutbox } from "./serpix-sync";
import { handleTransactions } from "./transactions";

const worker = {
  async fetch(req: Request, env: Env, ctx?: WorkerContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
    try {
      if (path === "/api/auth/google" && req.method === "GET") {
        return await handleGoogleStart(req, env);
      }
      if (path === "/api/auth/callback/google" && req.method === "GET") {
        return await handleGoogleCallback(req, env);
      }
      if (path === "/api/auth/logout" && req.method === "POST") {
        return await handleLogout(req, env);
      }
      if (!path.startsWith("/api/")) {
        if (path.startsWith("/.well-known/")) return json({ error: "No encontrado" }, 404);
        return env.ASSETS.fetch(req);
      }

      const user = await requireUser(req, env);
      if (!isUser(user)) return user;

      if (path === "/api/me" && req.method === "GET") return await handleMe(req, env, user);
      if (path === "/api/dashboard" && req.method === "GET") {
        return await handleDashboard(req, env, user);
      }
      if (path === "/api/transactions") return await handleTransactions(req, env, user, ctx);
      if (path === "/api/categories" && req.method === "GET") {
        return await handleCategories(req, env, user);
      }
      if (path === "/api/household/active") return await handleHouseholdActive(req, env, user);
      return notPorted();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error interno";
      return json({ error: message.slice(0, 300) }, 500);
    }
  },

  async scheduled(_event: unknown, env: Env, ctx: WorkerContext): Promise<void> {
    const work = flushOutbox(env);
    ctx.waitUntil(work);
    await work;
  },
};

export default worker;
