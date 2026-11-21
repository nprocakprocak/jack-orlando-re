import { describe, expect, it } from "vitest";
import { compileMcc } from "../script/compiler";
import { Interpreter, LoggingHost } from "../script/interpreter";
import { interpreterPort, resolveClick, type AreaClick, type ClickEnv, type Reaction } from "./index";

const bytes = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

describe("resolveClick", () => {
  const noArea: AreaClick = {
    area: -1,
    name: "",
    walkArea: false,
    handled: false,
    macro: null,
    started: -1,
    itemMacroFound: false,
    itemFailed: false,
  };
  const noReaction: Reaction = {
    macro: null,
    started: -1,
    itemMacroFound: false,
    itemFailed: false,
  };
  const mk = (o: Partial<ClickEnv> = {}): ClickEnv => ({
    mode: 0,
    armed: true,
    cursorEnabled: true,
    playerLocked: false,
    walkAllowed: true,
    itemInHand: false,
    area: () => noArea,
    sprite: () => null,
    inWalkArea: () => true,
    ...o,
  });
  it("guards: not armed, cursor disabled, turning, scroll cursor", () => {
    expect(resolveClick(mk({ armed: false }))).toEqual({
      outcome: { kind: "ignored" },
      armed: false,
    });
    for (const o of [{ cursorEnabled: false }, { turning: true }, { mode: 20 }, { mode: 21 }])
      expect(resolveClick(mk(o))).toEqual({ outcome: { kind: "ignored" }, armed: true });
  });
  it("area first, then sprite, then walk", () => {
    const area: AreaClick = {
      ...noArea,
      area: 0,
      name: "A",
      handled: true,
      started: 3,
      macro: "POKAZANIE-A",
    };
    expect(resolveClick(mk({ area: () => area }))).toEqual({
      outcome: { kind: "macro", source: "area" },
      armed: false,
    });
    const spr: Reaction = { ...noReaction, macro: "POKAZANIE-S", started: 2 };
    expect(resolveClick(mk({ sprite: () => spr }))).toEqual({
      outcome: { kind: "macro", source: "sprite" },
      armed: false,
    });
    expect(resolveClick(mk())).toEqual({ outcome: { kind: "walk" }, armed: false });
  });
  it("walking needs LOCKWALK off, a point in the walk area, mode 0 and no WALKAREA hit", () => {
    expect(resolveClick(mk({ walkAllowed: false })).outcome).toEqual({ kind: "nothing" });
    expect(resolveClick(mk({ inWalkArea: () => false })).outcome).toEqual({ kind: "nothing" });
    expect(resolveClick(mk({ mode: 1 })).outcome).toEqual({ kind: "nothing" });
    const walk: AreaClick = { ...noArea, area: 1, name: "WALKAREA", walkArea: true };
    expect(resolveClick(mk({ area: () => walk })).outcome).toEqual({ kind: "nothing" });
  });
  it("a locked player cannot click anything", () => {
    const e = mk({
      playerLocked: true,
      area: () => {
        throw new Error("not called");
      },
    });
    expect(resolveClick(e)).toEqual({ outcome: { kind: "nothing" }, armed: true });
  });
  it("item used on a target without any reaction: Jack refuses; on empty space: back to the bar", () => {
    const failed: AreaClick = { ...noArea, area: 0, name: "A", itemFailed: true };
    expect(resolveClick(mk({ mode: 5, itemInHand: true, area: () => failed }))).toEqual({
      outcome: { kind: "refuse" },
      armed: true,
    });
    expect(resolveClick(mk({ mode: 5, itemInHand: true }))).toEqual({
      outcome: { kind: "putBack" },
      armed: false,
    });
    const sprFail: Reaction = { ...noReaction, itemFailed: true };
    expect(resolveClick(mk({ mode: 5, itemInHand: true, sprite: () => sprFail })).outcome).toEqual({
      kind: "refuse",
    });
  });
});

describe("interpreterPort", () => {
  const text =
    "[POKAZANIE-A]\nLock\nOutMacro\nDoNothing 100\n[POKAZANIE-B]\nUnlock\nDoNothing 1\n[~POKAZANIE-A]\nUnlock\nDoNothing 1\n";
  it("exists / start / interrupt on the real interpreter", () => {
    const it = new Interpreter(compileMcc(bytes(text)), new LoggingHost(), new Map());
    const port = interpreterPort(it);
    expect(port.exists("POKAZANIE-A")).toBe(true);
    expect(port.exists("POKAZANIE-Z")).toBe(false);
    expect(port.start("POKAZANIE-Z")).toBe(-1);
    expect(it.anyActive()).toBe(false); // no "missing macro" entry started anything
    const a = port.start("POKAZANIE-A");
    for (let i = 0; i < 3; i++) it.tick();
    expect(it.macros[a].out).toBe(true);
    const b = port.start("POKAZANIE-B");
    port.interruptOutMacros(b);
    expect(it.macros[a].active).toBe(false);
    expect(it.isActive("~POKAZANIE-A")).toBe(true);
  });
});

describe(" inert BRANIE-AUTO", () => {
  const text = [
    "[PATRZENIE-AUTO]",
    "DoNothing 1",
    "[BRANIE-AUTO]",
    "DoNothing 1",
    "[BRANIE-DRZWI]",
    "DoNothing 1",
    "",
  ].join("\n");
  const mk = (makarte?: number) =>
    interpreterPort(
      new Interpreter(
        compileMcc(bytes(text)),
        new LoggingHost(),
        new Map(makarte === undefined ? [] : [["MAKARTE", makarte]]),
      ),
    );
  it("hand is off over the car after the card was taken, only for BRANIE", () => {
    expect(mk(0).exists("BRANIE-AUTO")).toBe(true);
    expect(mk(1).exists("BRANIE-AUTO")).toBe(false);
    expect(mk(1).exists("PATRZENIE-AUTO")).toBe(true);
    expect(mk(1).exists("BRANIE-DRZWI")).toBe(true);
    expect(mk().exists("BRANIE-AUTO")).toBe(true); // no MAKARTE: other scene, unchanged
  });
  it("click still starts the macro (as in the original)", () => {
    const p = mk(1);
    expect(p.start("BRANIE-AUTO")).toBeGreaterThanOrEqual(0);
  });
});
