import { describe, expect, it } from "vitest";
import { compileMcc, type Command } from "./compiler";
import {
  CO_RESET, CO_START, Interpreter, LoggingHost, Variables, WAIT_KIND, gotoSceneName,
  type CommandContext, type CommandResult, type LogEntry, type ScriptHost,
} from "./interpreter";

const bytes = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const VARS = new Map([["LAST", 5], ["A", 0], ["B", 0], ["RAND", 0], ["JACKX", 0]]);

/** Records host commands as "WORD n1"; results per word can be scripted. */
class TestHost implements ScriptHost {
  readonly calls: string[] = [];
  readonly entries: LogEntry[] = [];
  readonly ended: string[] = [];
  results: Record<string, CommandResult | (() => CommandResult)> = {};
  click = 0;
  rand = 0;
  lastCtx: CommandContext | null = null;
  command(cmd: Command, ctx: CommandContext): CommandResult {
    this.lastCtx = ctx;
    this.calls.push(`${cmd.word} ${cmd.n1}`.trim());
    const r = this.results[cmd.word];
    return typeof r === "function" ? r() : (r ?? "done");
  }
  clickX(): number {
    return this.click;
  }
  random(): number {
    return this.rand;
  }
  macroEnded(name: string): void {
    this.ended.push(name);
  }
  log(e: LogEntry): void {
    this.entries.push(e);
  }
}

function setup(text: string, vars: ReadonlyMap<string, number> = VARS) {
  const host = new TestHost();
  const it = new Interpreter(compileMcc(bytes(text)), host, vars);
  return { host, it };
}

/** Runs ticks until no macro is active (or the limit). */
function runAll(it: Interpreter, limit = 1000): number {
  let n = 0;
  while (it.anyActive() && n < limit) {
    it.tick();
    n++;
  }
  return n;
}

describe("variables and conditions", () => {
  it("Let / Inc / IncC / Let from a variable", () => {
    const { it } = setup("[M] Let A 7 Inc A IncC A 10 Let B *A");
    it.start("M");
    runAll(it);
    expect(it.vars.get("A")).toBe(18);
    expect(it.vars.get("B")).toBe(18);
  });

  it("values wrap to int16", () => {
    const v = new Variables(new Map([["A", 32767]]));
    v.set("A", 32768);
    expect(v.get("A")).toBe(-32768);
  });

  it("If skips to the matching EndIf, nested blocks included", () => {
    const { host, it } = setup("[M] If LAST 4 Stay X1 If LAST 5 Stay X2 EndIf IfF LAST > 0 Stay X3 EndIf EndIf If LAST 5 Stay X4 EndIf");
    it.start("M");
    runAll(it);
    expect(host.calls).toEqual(["STAY X4"]);
  });

  it("IfF with > = <", () => {
    const { host, it } = setup("[M] IfF LAST > 4 Stay GT EndIf IfF LAST = 5 Stay EQ EndIf IfF LAST < 6 Stay LT EndIf IfF LAST > 5 Stay NO EndIf IfF LAST < 5 Stay NO2 EndIf");
    it.start("M");
    runAll(it);
    expect(host.calls).toEqual(["STAY GT", "STAY EQ", "STAY LT"]);
  });

  it("IfMouseXM / IfMouseXW compare with the click x", () => {
    const { host, it } = setup("[M] IfMouseXM 100 Stay LEFT EndIf IfMouseXW 100 Stay RIGHT EndIf");
    host.click = 50;
    it.start("M");
    runAll(it);
    host.click = 150;
    it.start("M");
    runAll(it);
    host.click = 100;
    it.start("M");
    runAll(it);
    expect(host.calls).toEqual(["STAY LEFT", "STAY RIGHT", "STAY LEFT", "STAY RIGHT"]);
  });

  it("IfAnswer uses the answer of the dialog; its skip does not count IfF (game bug)", () => {
    const { host, it } = setup("[M] IfAnswer 1900 2 Stay TWO EndIf IfAnswer 1900 1 IfF LAST > 0 Stay IN EndIf Stay STILL EndIf Stay AFTER");
    it.answers.set(1900, 2);
    it.start("M");
    runAll(it);
    // the false IfAnswer ends at the IfF's EndIf, so "STAY STILL" runs and the last EndIf is a no-op
    expect(host.calls).toEqual(["STAY TWO", "STAY STILL", "STAY AFTER"]);
  });

  it("Random lo..hi with the host's rand()", () => {
    const { host, it } = setup("[M] Random A 3 5");
    host.rand = 7;
    it.start("M");
    runAll(it);
    expect(it.vars.get("A")).toBe(3 + (7 % 3));
  });

  it("*VAR arguments reach the host through ctx.arg", () => {
    const { host, it } = setup("[M] Let JACKX 300 WalkTo KOT *JACKX 20 +");
    it.start("M");
    runAll(it);
    expect(host.lastCtx!.arg(0)).toBe(300);
    expect(host.lastCtx!.arg(1)).toBe(20);
  });

  it("unknown variables read 0, writes are dropped and logged", () => {
    const { host, it } = setup("[M] Let NOPE 3 If NOPE 0 Stay ZERO EndIf");
    it.start("M");
    runAll(it);
    expect(host.calls).toEqual(["STAY ZERO"]);
    expect(it.vars.missing.has("NOPE")).toBe(true);
    expect(host.entries.some((e) => e.kind === "missing-var")).toBe(true);
  });
});

describe("ticks and waiting", () => {
  it("one command per macro per tick, the end is noticed on the next tick", () => {
    const { host, it } = setup("[A] Stay A1 Stay A2 [B] Stay B1");
    it.start("A");
    it.start("B");
    it.tick();
    expect(host.calls).toEqual(["STAY A1", "STAY B1"]);
    it.tick();
    expect(host.calls).toEqual(["STAY A1", "STAY B1", "STAY A2"]);
    expect(host.ended).toEqual(["B"]);
    it.tick();
    expect(host.ended).toEqual(["B", "A"]);
    expect(it.anyActive()).toBe(false);
  });

  it("async with '-' waits for complete(), with '+' goes on", () => {
    const { host, it } = setup("[M] WalkTo JACK 1 2 - Stay AFTER WalkTo JACK 3 4 + Stay END");
    host.results = { WALKTO: "async" };
    const m = it.start("M");
    it.tick();
    it.tick();
    it.tick();
    expect(host.calls).toEqual(["WALKTO JACK"]);
    expect(it.macros[m].blocked).toBe(true);
    it.complete(m);
    it.tick();
    it.tick();
    it.tick();
    expect(host.calls).toEqual(["WALKTO JACK", "STAY AFTER", "WALKTO JACK", "STAY END"]);
    expect(it.macros[m].pending).toBe(1);
  });

  it("a '-' wait ends only when all started operations are done", () => {
    const { it, host } = setup("[M] Anima A 0 5 1 + WalkTo JACK 1 2 - Stay AFTER");
    host.results = { ANIMA: "async", WALKTO: "async" };
    const m = it.start("M");
    it.tick();
    it.tick();
    it.complete(m);
    expect(it.macros[m].blocked).toBe(true);
    it.complete(m);
    it.tick();
    expect(host.calls.at(-1)).toBe("STAY AFTER");
  });

  it("block waits whatever the flag; repeat runs the command again", () => {
    let n = 0;
    const { host, it } = setup("[M] Dialog RIGHT 1800 Pickup 1 Stay END");
    host.results = { DIALOG: "block", PICKUP: () => (++n < 3 ? "repeat" : "done") };
    const m = it.start("M");
    it.tick();
    it.tick();
    expect(host.calls).toEqual(["DIALOG RIGHT"]);
    it.complete(m);
    runAll(it);
    expect(host.calls).toEqual(["DIALOG RIGHT", "PICKUP", "PICKUP", "PICKUP", "STAY END"]);
  });

  it("DoNothing n waits n ticks", () => {
    const { host, it } = setup("[M] DoNothing 3 Stay END");
    it.start("M");
    for (let i = 0; i < 4; i++) it.tick();
    expect(host.calls).toEqual([]);
    it.tick();
    expect(host.calls).toEqual(["STAY END"]);
    const z = setup("[M] DoNothing 0 Stay END");
    z.it.start("M");
    z.it.tick();
    z.it.tick();
    expect(z.host.calls).toEqual(["STAY END"]);
  });

  it("WaitWhile var value polls the variable", () => {
    const { host, it } = setup("[M] WaitWhile A 0 Stay END");
    it.start("M");
    it.tick();
    it.tick();
    expect(host.calls).toEqual([]);
    it.vars.set("A", 1);
    it.tick();
    it.tick();
    expect(host.calls).toEqual(["STAY END"]);
  });

  it("unhandled commands are logged and skipped", () => {
    const host = new LoggingHost();
    const it = new Interpreter(compileMcc(bytes("[M] Talk LEFT 10 1 - ShowFace KOT - Let A 1")), host, VARS);
    it.start("M");
    runAll(it);
    expect(it.vars.get("A")).toBe(1);
    expect(host.entries.filter((e) => e.kind === "unhandled").map((e) => e.text)).toEqual([
      "TALK (line 1) skipped",
      "SHOWFACE (line 1) skipped",
    ]);
  });
});

describe("macro control", () => {
  it("ActiveMacro starts another macro (from its beginning), DeactiveMacro stops it", () => {
    const { host, it } = setup("[A] ActiveMacro B DoNothing 5 DeactiveMacro B [B] Stay B1 Stay B2 Stay B3 Stay B4");
    it.start("A");
    runAll(it);
    expect(host.calls).toEqual(["STAY B1", "STAY B2", "STAY B3", "STAY B4"].slice(0, host.calls.length));
    expect(it.isActive("B")).toBe(false);
  });

  it("ActiveMacro of itself restarts after the first command (pc+1 after the restart)", () => {
    const { host, it } = setup("[A] Stay FIRST Inc A IfF A < 3 ActiveMacro A EndIf");
    it.start("A");
    runAll(it);
    expect(host.calls).toEqual(["STAY FIRST"]);
    expect(it.vars.get("A")).toBe(3);
  });

  it("DeactiveSelf ends the macro, ReactiveSelf loops it", () => {
    const { host, it } = setup("[A] Inc A IfF A > 2 DeactiveSelf EndIf ReactiveSelf");
    it.start("A");
    runAll(it);
    expect(it.vars.get("A")).toBe(3);
    expect(host.ended).toEqual([]);
  });

  it("BlockMacro / UnblockMacro (also ALL) keep a macro from starting", () => {
    const { it, host } = setup("[A] BlockMacro B ActiveMacro B UnblockMacro ALL ActiveMacro B [B] Stay B");
    it.start("A");
    runAll(it);
    expect(host.calls).toEqual(["STAY B"]);
    expect(host.entries.filter((e) => e.kind === "missing-macro")).toHaveLength(1);
  });

  it("ActiveMacroAt starts a macro after n ticks", () => {
    const { host, it } = setup("[A] ActiveMacroAt B 3 [B] Stay B");
    it.start("A");
    it.tick();
    it.tick();
    it.tick();
    expect(host.calls).toEqual([]);
    it.tick();
    expect(host.calls).toEqual(["STAY B"]);
  });

  it("missing macros are logged, not fatal", () => {
    const { it, host } = setup("[A] ActiveMacro NOWHERE");
    expect(it.start("NONE")).toBe(-1);
    it.start("A");
    runAll(it);
    expect(host.entries.filter((e) => e.kind === "missing-macro").map((e) => e.macro)).toEqual(["NONE", "NOWHERE"]);
  });

  it("[PRE] runs to its end at once and ignores waits", () => {
    const { host, it } = setup("[PRE] WalkTo JACK 1 2 - Dialog RIGHT 1 Let A 1 [INIT] Stay I");
    host.results = { WALKTO: "async", DIALOG: "block" };
    it.runSynchronous();
    expect(it.vars.get("A")).toBe(1);
    expect(host.calls).toEqual(["WALKTO JACK", "DIALOG RIGHT"]);
    expect(host.ended).toEqual(["PRE"]);
    expect(host.lastCtx!.synchronous).toBe(true);
  });

  it("an ActiveMacro inside [PRE] hands the loop to that macro (g_macroStarted); [PRE]'s tail waits for the frames", () => {
    const { host, it } = setup("[PRE] ActiveMacro M Stay P2 [M] Stay M1 Stay M2");
    it.runSynchronous();
    expect(host.calls).toEqual(["STAY M1", "STAY M2"]);
    expect(it.isActive("PRE")).toBe(true);
    it.tick();
    expect(host.calls).toEqual(["STAY M1", "STAY M2", "STAY P2"]);
  });

  it("an ActiveMacro of a missing macro inside [PRE] ends the loop (g_macroStarted = -1)", () => {
    const { host, it } = setup("[PRE] ActiveMacro NOWHERE Stay P2");
    it.runSynchronous();
    expect(host.calls).toEqual([]);
    expect(host.entries.some((e) => e.kind === "missing-macro")).toBe(true);
  });

  it("a [PRE] that never ends is cut and logged as a hang", () => {
    const { host, it } = setup("[PRE] WaitWhile A 0");
    it.runSynchronous();
    expect(host.entries.some((e) => e.kind === "hang")).toBe(true);
    expect(it.anyActive()).toBe(false);
  });

  it("CO60 / CO30 / CO10 from the logic-tick counter", () => {
    const { it, host } = setup("[CO60] Stay 60 [CO30] Stay 30 [CO10] Stay 10");
    expect(it.coCounter).toBe(CO_START);
    const started: string[] = [];
    host.log = (e) => e.kind === "start" && started.push(e.macro);
    for (let i = 0; i < 2999 - 2700; i++) it.logicTick();
    it.tick(); // 2700: 2700 % 300 == 0
    expect(started).toEqual(["CO10"]);
    it.coCounter = 2000;
    it.tick();
    expect(started).toEqual(["CO10", "CO30"]);
    it.coCounter = -1;
    it.tick();
    expect(started).toEqual(["CO10", "CO30", "CO60", "CO30", "CO10"]);
    expect(it.coCounter).toBe(CO_RESET);
  });

  it("interruptOutMacros stops OUTMACRO macros and starts their destructors", () => {
    const { it, host } = setup("[A] OutMacro MacroDestructor CLEAN DoNothing 100 [B] OutMacro DoNothing 100 [C] DoNothing 100 [CLEAN] Stay CLEAN [~B] Stay TILDE");
    it.start("A");
    it.start("B");
    it.start("C");
    it.tick();
    it.tick();
    expect(it.playerLocked()).toBe(true);
    it.interruptOutMacros();
    expect(it.isActive("A")).toBe(false);
    expect(it.isActive("B")).toBe(false);
    expect(it.isActive("C")).toBe(true);
    it.tick();
    expect(host.calls).toContain("STAY CLEAN");
    expect(host.calls).toContain("STAY TILDE");
  });

  it("Unlock / Lock decide whether the player waits", () => {
    const { it } = setup("[A] Unlock DoNothing 3 Lock DoNothing 3");
    it.start("A");
    it.tick();
    expect(it.playerLocked()).toBe(false);
    for (let i = 0; i < 5; i++) it.tick();
    expect(it.playerLocked()).toBe(true);
  });
});

describe("helpers", () => {
  it("gotoSceneName cuts the extension", () => {
    expect(gotoSceneName("SC026.CFG")).toBe("SC026");
    expect(gotoSceneName("sc006")).toBe("SC006");
  });

  it("WAIT_KIND names only compiled codes", () => {
    for (const code of Object.keys(WAIT_KIND)) expect(Number(code)).toBeLessThanOrEqual(0xa3);
  });
});
