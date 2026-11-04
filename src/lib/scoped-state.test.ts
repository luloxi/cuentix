import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readScoped, scoped } from "./scoped-state";

describe("scoped state", () => {
  it("shows a value only under the scope it was set in", () => {
    const error = scoped("2026-10", "No se pudo guardar");
    assert.equal(readScoped(error, "2026-10"), "No se pudo guardar");
    assert.equal(readScoped(error, "2026-11"), null);
    assert.equal(readScoped(error, "2026-10"), "No se pudo guardar");
  });

  it("reads null when nothing was set", () => {
    assert.equal(readScoped(null, "2026-10"), null);
  });
});
