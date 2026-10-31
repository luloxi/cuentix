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
import {
  captureDailySnapshots,
  handleAhorros,
  handleDebtSettings,
  handleDebtStats,
  handlePatrimonio,
  handlePatrimonioSnapshot,
} from "./finance";
import { json, notPorted } from "./http";
import { handleHouseholdActive, handleMe } from "./household-routes";
import { flushOutbox } from "./serpix-sync";
import { handleSvc } from "./svc";
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
      if (path === "/api/svc" || path.startsWith("/api/svc/")) {
        return await handleSvc(req, env);
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
      if (path === "/api/ahorros") return await handleAhorros(req, env, user);
      if (path === "/api/debt-settings") return await handleDebtSettings(req, env, user);
      if (path === "/api/stats/deuda" && req.method === "GET") {
        return await handleDebtStats(req, env, user);
      }
      if (path === "/api/patrimonio/snapshot") return await handlePatrimonioSnapshot(req, env, user);
      if (path === "/api/patrimonio" && req.method === "GET") {
        return await handlePatrimonio(req, env, user);
      }
      return notPorted();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error interno";
      return json({ error: message.slice(0, 300) }, 500);
    }
  },

  async scheduled(_event: unknown, env: Env, ctx: WorkerContext): Promise<void> {
    const outbox = flushOutbox(env).catch((err) => {
      console.error("outbox flush failed", err instanceof Error ? err.message : "error");
    });
    const snapshots = captureDailySnapshots(env).catch((err) => {
      console.error("patrimonio snapshot failed", err instanceof Error ? err.message : "error");
    });
    const work = Promise.all([outbox, snapshots]).then(() => undefined);
    ctx.waitUntil(work);
    await work;
  },
};

export default worker;
