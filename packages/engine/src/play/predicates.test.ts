// `isDeathFilm` and `deathAhead`. The script bytes are built in the test.
import { describe, expect, it } from "vitest";
import { compileMcc, Interpreter } from "../script";
import { Variables } from "../script/interpreter";
import { deathAhead, isDeathFilm } from "./predicates";

describe("play: the death sequence hides the cursor (synthetic)", () => {
  const make = (text: string, vars: Record<string, number> = {}) => {
    const host = { command: () => ({ done: true }) } as never;
    return new Interpreter(
      compileMcc(new Uint8Array([...text].map((c) => c.charCodeAt(0)))),
      host,
      new Variables(new Map(Object.entries(vars))),
    );
  };

  it("every film but OUTRO is a death film", () => {
    expect(["Z32A.AVX", "ONCAR.AVX", "KRATY.AVX", "83JC.AVX"].map(isDeathFilm)).toEqual([true, true, true, true]);
    expect(["OUTRO.AVX", "outro.avx", "OUTRO"].map(isDeathFilm)).toEqual([false, false, false]);
  });
  it("an IF var value block is entered by the variable: GANGSTERZY dies with GUN = 0 only", () => {
    const text = "[GANGSTERZY] WalkTo AUTOG 10 10 0 If GUN 0 DoNothing 180 RunAvx Z32A.AVX NULL EndIf";
    const dead = make(text, { GUN: 0 });
    dead.start("GANGSTERZY");
    expect(deathAhead(dead)).toBe(true);
    const armed = make(text, { GUN: 1 });
    armed.start("GANGSTERZY");
    expect(deathAhead(armed)).toBe(false);
  });
  it("nothing runs, nothing dies; an inactive macro with RUNAVX does not count", () => {
    const it = make("[ZABJACK] RunAvx Z51.AVX NULL");
    expect(deathAhead(it)).toBe(false);
    it.start("ZABJACK");
    expect(deathAhead(it)).toBe(true);
    it.macros[0].active = false;
    expect(deathAhead(it)).toBe(false);
  });
  it("a wait before the death macro leaves the player free (CZEKAJ), OUTRO never counts", () => {
    const it = make(
      "[CZEKAJ] Unlock DoNothing 400 ActiveMacro ZABJACK [ZABJACK] RunAvx Z51.AVX NULL [KONIEC] RunAvx OUTRO.AVX NULL",
    );
    it.start("CZEKAJ");
    expect(deathAhead(it)).toBe(false);
    it.start("ZABJACK");
    expect(deathAhead(it)).toBe(true);
    const end = make("[KONIEC] RunAvx OUTRO.AVX NULL");
    end.start("KONIEC");
    expect(deathAhead(end)).toBe(false);
  });
  it("GOTOSCENE or DEACTIVESELF before the film ends the scan; unknown conditions and nested blocks are not entered", () => {
    const a = make("[A] GotoScene SC037 RunAvx Z38.AVX NULL");
    a.start("A");
    expect(deathAhead(a)).toBe(false);
    const b = make("[B] DeactiveSelf RunAvx Z38.AVX NULL");
    b.start("B");
    expect(deathAhead(b)).toBe(false);
    const c = make("[C] IfMouseXM 100 RunAvx Z38.AVX NULL EndIf");
    c.start("C");
    expect(deathAhead(c)).toBe(false);
    const d = make("[D] If GUN 0 If LOC1 5 RunAvx Z38.AVX NULL EndIf EndIf", { GUN: 0 });
    d.start("D");
    expect(deathAhead(d)).toBe(false);
  });
  it("the scan starts at the macro's current command: past the film it is over", () => {
    const it = make("[A] DoNothing 10 RunAvx Z42.AVX NULL DoNothing 5");
    it.start("A");
    expect(deathAhead(it)).toBe(true);
    it.macros[0].pc = it.macros[0].start + 2; // after RUNAVX
    expect(deathAhead(it)).toBe(false);
  });
});
