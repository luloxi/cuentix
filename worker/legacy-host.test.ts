import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Env } from "./env";
import worker from "./index";
import { redirectLegacyHost } from "./legacy-host";

describe("legacy host", () => {
  it("redirects cuentix.lulox.com.ar to tarask with the same path and query", () => {
    const response = redirectLegacyHost(
      new Request("https://cuentix.lulox.com.ar/api/auth/callback/google?code=abc&state=xyz"),
    );
    assert.ok(response);
    assert.equal(response.status, 301);
    assert.equal(
      response.headers.get("location"),
      "https://tarask.lulox.com.ar/api/auth/callback/google?code=abc&state=xyz",
    );
  });

  it("forces https and keeps a bare path", () => {
    const response = redirectLegacyHost(
      new Request("http://cuentix.lulox.com.ar/dashboard?period=2026-08"),
    );
    assert.equal(response?.status, 301);
    assert.equal(
      response?.headers.get("location"),
      "https://tarask.lulox.com.ar/dashboard?period=2026-08",
    );
  });

  it("does not redirect other hosts", () => {
    assert.equal(redirectLegacyHost(new Request("https://tarask.lulox.com.ar/dashboard")), null);
    assert.equal(redirectLegacyHost(new Request("https://cuentix.lulox.com.ar.evil.example/")), null);
    assert.equal(redirectLegacyHost(new Request("https://not.cuentix.lulox.com.ar/")), null);
    assert.equal(redirectLegacyHost(new Request("https://cuentix.test/api/me")), null);
  });

  it("runs in fetch before auth and assets", async () => {
    const callback = await worker.fetch(
      new Request("https://cuentix.lulox.com.ar/api/auth/callback/google?code=abc&state=xyz"),
      undefined as unknown as Env,
    );
    assert.equal(callback.status, 301);
    assert.equal(
      callback.headers.get("location"),
      "https://tarask.lulox.com.ar/api/auth/callback/google?code=abc&state=xyz",
    );

    const page = await worker.fetch(
      new Request("https://cuentix.lulox.com.ar/dashboard"),
      undefined as unknown as Env,
    );
    assert.equal(page.status, 301);
    assert.equal(page.headers.get("location"), "https://tarask.lulox.com.ar/dashboard");
  });
});
