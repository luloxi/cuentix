import { describe, expect, it } from "vitest";
import { signSession, timingSafeEqual, verifySession, SESSION_MAX_AGE_SEC } from "./auth";

describe("timingSafeEqual", () => {
  it("matches equal strings and rejects different ones", () => {
    expect(timingSafeEqual("access-key", "access-key")).toBe(true);
    expect(timingSafeEqual("access-key", "access-kez")).toBe(false);
    expect(timingSafeEqual("short", "much-longer-secret")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
    expect(timingSafeEqual("", "x")).toBe(false);
  });
});

describe("session cookie", () => {
  const secret = "test-session-secret";
  const now = 1_700_000_000;

  it("round-trips a signed exp", async () => {
    const exp = now + SESSION_MAX_AGE_SEC;
    const token = await signSession(secret, exp);
    expect(token.startsWith(`${exp}.`)).toBe(true);
    expect(await verifySession(secret, token, now)).toBe(true);
  });

  it("rejects a tampered signature, a wrong secret, and an expired exp", async () => {
    const token = await signSession(secret, now + 100);
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    expect(await verifySession(secret, tampered, now)).toBe(false);
    expect(await verifySession("other-secret", token, now)).toBe(false);
    expect(await verifySession(secret, token, now + 100)).toBe(false);
    expect(await verifySession(secret, token, now + 101)).toBe(false);
  });

  it("rejects an exp past the 30 day window", async () => {
    const token = await signSession(secret, now + SESSION_MAX_AGE_SEC + 120);
    expect(await verifySession(secret, token, now)).toBe(false);
  });
});
