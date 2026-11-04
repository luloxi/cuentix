import { describe, expect, it } from "vitest";
import { buenosAiresToday } from "./dates";

describe("buenosAiresToday", () => {
  it("uses America/Argentina/Buenos_Aires, which is UTC-3", () => {
    expect(buenosAiresToday(new Date("2026-11-04T02:30:00Z"))).toBe("2026-11-03");
    expect(buenosAiresToday(new Date("2026-11-04T03:00:00Z"))).toBe("2026-11-04");
  });
});
