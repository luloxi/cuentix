import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Env } from "./env";
import worker from "./index";
import { redirectLegacyHost } from "./legacy-host";

const OLD = "https://cuentix.lulox.com.ar";

describe("legacy host", () => {
  it("redirects pages to tarask with the same path and query", () => {
    const response = redirectLegacyHost(new Request(`${OLD}/resumen?x=1`));
    assert.equal(response?.status, 301);
    assert.equal(response?.headers.get("location"), "https://tarask.lulox.com.ar/resumen?x=1");
    assert.equal(response?.headers.get("cache-control"), "no-store");
  });

  it("forces https and keeps the root", () => {
    const response = redirectLegacyHost(new Request("http://cuentix.lulox.com.ar/"));
    assert.equal(response?.headers.get("location"), "https://tarask.lulox.com.ar/");
  });

  it("leaves /api on the old host except the Google callback", () => {
    assert.equal(
      redirectLegacyHost(new Request(`${OLD}/api/auth/callback/google?code=a&state=b`))?.headers.get("location"),
      "https://tarask.lulox.com.ar/api/auth/callback/google?code=a&state=b",
    );
    assert.equal(redirectLegacyHost(new Request(`${OLD}/api/me`)), null);
    assert.equal(redirectLegacyHost(new Request(`${OLD}/apiary`))?.status, 301);
  });

  it("does not redirect other hosts", () => {
    assert.equal(redirectLegacyHost(new Request("https://tarask.lulox.com.ar/dashboard")), null);
    assert.equal(redirectLegacyHost(new Request(`${OLD}.evil.example/`)), null);
    assert.equal(redirectLegacyHost(new Request("https://not.cuentix.lulox.com.ar/")), null);
  });

  it("runs in fetch before assets", async () => {
    const page = await worker.fetch(new Request(`${OLD}/dashboard`), undefined as unknown as Env);
    assert.equal(page.status, 301);
    assert.equal(page.headers.get("location"), "https://tarask.lulox.com.ar/dashboard");
  });
});
