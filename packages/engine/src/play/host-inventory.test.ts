// Inventory commands.
import { describe, expect, it } from "vitest";
import type { ItemPort } from "./host";
import { setup, step } from "./testing";

describe("SceneHost: the inventory commands", () => {
  /** A recording ItemPort; `present` is what ITEMPRESENT finds. */
  function withItems(text: string, present: string[] = []) {
    const calls: string[] = [];
    const items: ItemPort = {
      haveTool: (o) => calls.push(`haveTool ${o}`),
      noHaveTool: (n) => calls.push(`noHaveTool ${n}`),
      noHave: () => calls.push("noHave"),
      take: (o) => {
        calls.push(`take ${o}`);
        return o !== "NOIMAGE";
      },
      mouseToTool: () => calls.push("mouseToTool"),
      itemPresent: (n) => present.includes(n),
      moveBigRegion: () => calls.push("moveBigRegion"),
      setGun: (on) => calls.push(`gun ${on}`),
      setUniform: (on) => calls.push(`uniform ${on}`),
    };
    const s = setup(text, 3, items);
    return { ...s, calls };
  }

  it("TAKE, HAVETOOL, NOHAVETOOL, NOHAVE, MOUSETOTOOL and CLEARMENUBAR reach the game, in order, with the object / item name", () => {
    const s = withItems("[A] Take KEY.011 HaveTool MIOT.BM NoHaveTool KEY.011 NoHave MouseToTool ClearMenuBar 1 Let A 1");
    s.it.start("A");
    for (let i = 0; i < 8; i++) step(s);
    expect(s.calls).toEqual(["take KEY.011", "haveTool MIOT.BM", "noHaveTool KEY.011", "noHave", "mouseToTool"]);
    expect(s.it.vars.get("A")).toBe(1); // CLEARMENUBAR is an empty command, not 'unhandled'
    expect(s.log.some((e) => e.kind === "unhandled")).toBe(false);
  });

  it("TAKE of an object without an image is 'unhandled' (the game logs it and goes on)", () => {
    const s = withItems("[A] Take NOIMAGE Let A 1");
    s.it.start("A");
    step(s);
    step(s);
    expect(s.host.skipped.get("TAKE")).toBe(1);
    expect(s.it.vars.get("A")).toBe(1);
  });

  it("ITEMPRESENT puts 1 / 0 into the variable", () => {
    const yes = withItems("[A] ItemPresent MONEY.BM A", ["MONEY.BM"]);
    yes.it.vars.set("A", 5);
    yes.it.start("A");
    step(yes);
    expect(yes.it.vars.get("A")).toBe(1);
    const no = withItems("[A] ItemPresent MONEY.BM A", ["OTHER.BM"]);
    no.it.vars.set("A", 5);
    no.it.start("A");
    step(no);
    expect(no.it.vars.get("A")).toBe(0);
  });

  it("EXTRA 6 / 8 / 11, HAVEGUN and NOHAVEGUN go to the port (the uniform also without a dialog layer)", () => {
    const s = withItems("[A] Extra 6 Extra 8 Extra 11 HaveGun NoHaveGun");
    s.it.start("A");
    for (let i = 0; i < 8; i++) step(s);
    expect(s.calls).toEqual(["uniform true", "uniform false", "moveBigRegion", "gun true", "gun false"]);
    expect(s.scene.tj.uniform).toBe(false);
    expect(s.scene.jack.uniform).toBe(false);
  });

  it("EXTRA 6 / 8 switch Jack's frame set and JACKISWOJ only when the uniform changes (case 0x24 tests g_jackUniform)", () => {
    const s = withItems("[A] Extra 6 Let JACKISWOJ 7 Extra 6 Extra 8 Extra 8");
    s.it.vars.set("JACKISWOJ", 0);
    s.it.start("A");
    step(s);
    expect(s.scene.jack.uniform).toBe(true);
    expect(s.scene.tj.uniform).toBe(true);
    expect(s.it.vars.get("JACKISWOJ")).toBe(1); // Var_Set("JACKISWOJ", 1) in
    for (let i = 0; i < 2; i++) step(s);
    expect(s.it.vars.get("JACKISWOJ")).toBe(7); // the second EXTRA 6 does nothing
    expect(s.scene.jack.uniform).toBe(true);
    for (let i = 0; i < 3; i++) step(s);
    expect(s.scene.jack.uniform).toBe(false);
    expect(s.it.vars.get("JACKISWOJ")).toBe(0); //
    expect(s.calls).toEqual(["uniform true", "uniform false"]);
  });

  it("HAVEGUN does not change the stand scale (it does not touch g_jackUniform)", () => {
    const s = withItems("[A] HaveGun");
    s.it.start("A");
    step(s);
    expect(s.scene.jack.uniform).toBe(false);
  });

  it("without a port the commands are 'unhandled' (the host of the pre- tests)", () => {
    const s = setup("[A] HaveTool MIOT.BM Extra 11 Let A 1");
    s.it.start("A");
    for (let i = 0; i < 4; i++) step(s);
    expect(s.host.skipped.get("HAVETOOL")).toBe(1);
    expect(s.host.skipped.get("EXTRA")).toBe(1);
    expect(s.it.vars.get("A")).toBe(1);
  });
});
