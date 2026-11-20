import { describe, expect, it } from "vitest";
import { pad2 } from "./pad";

describe("pad2", () => {
  it("writes at least two digits", () => {
    expect(pad2(0)).toBe("00");
    expect(pad2(9)).toBe("09");
    expect(pad2(10)).toBe("10");
    expect(pad2(100)).toBe("100");
  });
});
