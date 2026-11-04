import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAbortError,
  messageFromBody,
  readJson,
  settleWaiters,
  type Waiter,
} from "./use-json-resource";

function waiterLog(): { map: Map<number, Waiter>; log: string[] } {
  const log: string[] = [];
  const map = new Map<number, Waiter>();
  for (const token of [1, 2, 3]) {
    map.set(token, {
      resolve: () => log.push(`ok${token}`),
      reject: (e) => log.push(`err${token}:${(e as Error).message}`),
    });
  }
  return { map, log };
}

describe("settleWaiters", () => {
  it("resolves the token and every older waiter, and keeps newer ones", () => {
    const { map, log } = waiterLog();
    settleWaiters(map, 2, undefined);
    assert.deepEqual(log, ["ok1", "ok2"]);
    assert.deepEqual([...map.keys()], [3]);
  });

  it("resolves when a fetch is aborted so reload() does not hang", async () => {
    const map = new Map<number, Waiter>();
    const pending = new Promise<void>((resolve, reject) => {
      map.set(1, { resolve, reject });
    });
    // What the effect cleanup does after ac.abort().
    settleWaiters(map, 1, undefined);
    await pending;
    assert.equal(map.size, 0);
  });

  it("rejects the token and older waiters with the error", () => {
    const { map, log } = waiterLog();
    settleWaiters(map, 1, new Error("boom"));
    assert.deepEqual(log, ["err1:boom"]);
    assert.deepEqual([...map.keys()], [2, 3]);
  });

  it("does nothing when no waiter is at or below the token", () => {
    const map = new Map<number, Waiter>();
    settleWaiters(map, 5, undefined);
    assert.equal(map.size, 0);
  });
});


describe("messageFromBody", () => {
  it("uses a non-empty string error", () => {
    assert.equal(messageFromBody({ error: "no permitido" }, "Error"), "no permitido");
  });

  it("falls back when the body has no usable error", () => {
    assert.equal(messageFromBody(null, "Error"), "Error");
    assert.equal(messageFromBody({ error: "" }, "Error"), "Error");
    assert.equal(messageFromBody({ error: "   " }, "Error"), "Error");
    assert.equal(messageFromBody({ error: 404 }, "Error"), "Error");
    assert.equal(messageFromBody("nope", "Error"), "Error");
  });
});

describe("isAbortError", () => {
  it("matches AbortError and ignores everything else", () => {
    assert.equal(isAbortError({ name: "AbortError" }), true);
    assert.equal(isAbortError(new DOMException("aborted", "AbortError")), true);
    assert.equal(isAbortError(new Error("AbortError")), false);
    assert.equal(isAbortError(null), false);
    assert.equal(isAbortError("AbortError"), false);
  });
});

describe("readJson", () => {
  it("returns the parsed body when the response is ok", async () => {
    const res = new Response(JSON.stringify({ items: [1] }), { status: 200 });
    assert.deepEqual(await readJson<{ items: number[] }>(res, "Error"), { items: [1] });
  });

  it("throws the API error string when the response is not ok", async () => {
    const res = new Response(JSON.stringify({ error: "sin hogar" }), { status: 400 });
    await assert.rejects(readJson(res, "Error"), { message: "sin hogar" });
  });

  it("uses the fallback when a failed response has no JSON error", async () => {
    const empty = new Response("", { status: 500 });
    await assert.rejects(readJson(empty, "Error al cargar"), { message: "Error al cargar" });
    const broken = new Response("not-json", { status: 502 });
    await assert.rejects(readJson(broken, "Error"), { message: "Error" });
  });

  it("rethrows a JSON parse error on a successful response", async () => {
    const res = new Response("{", { status: 200 });
    await assert.rejects(readJson(res, "Error"), SyntaxError);
  });
});
