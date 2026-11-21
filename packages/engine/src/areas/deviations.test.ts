import { describe, expect, it } from "vitest";
import { isInertMacro, macroMouseX } from "./deviations";

describe(" rope descent fix (synthetic)", () => {
  it("without the rope the right edge x 321-338 is clamped to the ladder branch", () => {
    for (const x of [321, 330, 338]) expect(macroMouseX("SC087", "POKAZANIE-DOL", x, false)).toBe(320);
  });
  it("without the rope the ladder side is unchanged", () => {
    for (const x of [210, 300, 320]) expect(macroMouseX("SC087", "POKAZANIE-DOL", x, false)).toBe(x);
  });
  it("with the rope nothing changes", () => {
    for (const x of [321, 338, 360]) expect(macroMouseX("SC087", "POKAZANIE-DOL", x, true)).toBe(x);
  });
  it("other macro or scene is untouched", () => {
    expect(macroMouseX("SC087", "PATRZENIE-DOL", 330, false)).toBe(330);
    expect(macroMouseX("SC070", "POKAZANIE-DOL", 330, false)).toBe(330);
  });
  it(" inert macro still works", () => {
    expect(isInertMacro("BRANIE-AUTO", () => 1)).toBe(true);
    expect(isInertMacro("BRANIE-AUTO", () => 0)).toBe(false);
  });
});
