import { describe, expect, it } from "vitest";
import {
  DONOTHING, JACK, MAX_COMMANDS, MAX_MACROS, MacroError, NAMES, WORDS, compileMcc,
  findMacro, macroCommands, parseVariables, problemsOf, stripBrackets,
} from "./compiler";

const bytes = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const compile = (s: string) => compileMcc(bytes(s));
const one = (s: string) => compile(`[M]\r\n${s}\r\n`).commands[0];


describe("word table", () => {
  it("has the 155 words of the compiler and codes 1..0xa3 without the gaps", () => {
    expect(Object.keys(WORDS)).toHaveLength(155);
    const codes = new Set(Object.values(WORDS));
    expect(codes.size).toBe(155);
    for (const gap of [0x1f, 0x24, 0x35, 0x4e, 0x4f, 0x69, 0x6b, 0x7f]) expect(codes.has(gap)).toBe(false);
    expect(Math.max(...codes)).toBe(0xa3);
    expect(NAMES[0x21]).toBe("TALKRANDOM");
    expect(NAMES[0x22]).toBe("TAKE");
    expect(NAMES[0xa1]).toBe("SAVEABLE");
    expect(NAMES[0xa2]).toBe("EXITTODOS");
  });
});

describe("structure", () => {
  it("splits macros, upper-cases names and words, numbers lines", () => {
    const p = compile("[pre]\r\n\tlet LAST 2\r\n\r\n[Init]\r\nGoToScene SC006\r\n");
    expect(p.macros).toEqual([
      { name: "PRE", start: 0, count: 1, line: 1 },
      { name: "INIT", start: 1, count: 1, line: 4 },
    ]);
    expect(p.commands.map((c) => [c.code, c.word, c.line])).toEqual([[0x1a, "LET", 2], [0x14, "GOTOSCENE", 5]]);
    expect(findMacro(p, "INIT")).toBe(1);
    expect(macroCommands(p, "INIT")?.[0].n1).toBe("SC006");
    expect(macroCommands(p, "NONE")).toBeNull();
  });

  it("skips comments: '/ /' and '/* */' as whole tokens, also before the first macro", () => {
    const p = compile("/ head comment / [A]\r\n/ x / /* y z */ Hide JACK / again / Stay KOT\r\n");
    expect(p.macros[0].name).toBe("A");
    expect(p.commands.map((c) => c.word)).toEqual(["HIDE", "STAY"]);
    expect(compile("/* a */ [B] Stay X").macros[0].name).toBe("B");
  });

  it("a token that only starts with '/' is a word, not a comment (unknown -> DONOTHING)", () => {
    const c = one("/note 5");
    expect(c.code).toBe(DONOTHING);
    expect(c.word).toBe("/NOTE");
    expect(c.a[0]).toBe(5);
  });

  it("an unknown word compiles to DONOTHING and eats one number", () => {
    const p = compile("[M] Foo 7 Stay X");
    expect(p.commands.map((c) => [c.code, c.word, c.a[0]])).toEqual([[DONOTHING, "FOO", 7], [0x4a, "STAY", 0]]);
  });

  it("keeps one If counter for the whole file (not per macro)", () => {
    const p = compile("[A] If X 1 [B] EndIf If Y 2 If Z 3 EndIf EndIf");
    expect(p.depth).toBe(0);
    expect(p.commands.filter((c) => c.code === 0x1b).map((c) => c.a[1])).toEqual([0, 0, 1]);
    expect(compile("[A] If X 1").depth).toBe(1);
  });

  it("empty text: no macros", () => {
    expect(compile("")).toEqual({ macros: [], commands: [], depth: 0 });
  });

  it("stripBrackets drops the first and the last character", () => {
    expect(stripBrackets("[PRE]")).toBe("PRE");
    expect(stripBrackets("PRE")).toBe("R");
  });
});

describe("errors", () => {
  it("EndIf without If", () => {
    expect(() => compile("[A] EndIf")).toThrow("EndIf without If");
    expect(() => compile("[A] If X 1 EndIf EndIf")).toThrow(MacroError);
  });

  it("unterminated comments (the game loops)", () => {
    expect(() => compile("[A] / never closed")).toThrow(/unterminated comment, no "\/"/);
    expect(() => compile("[A] Stay X /* open")).toThrow(/no "\*\/"/);
    expect(() => compile("/ open")).toThrow(/unterminated/);
    expect(() => compile("/* open")).toThrow(/unterminated/);
  });

  it("text that ends where a command is expected (empty last macro, trailing comment)", () => {
    expect(() => compile("[A] Stay X [B]")).toThrow(/command is expected/);
    expect(() => compile("[A] Stay X / tail /")).toThrow(/command is expected/);
    expect(() => compile("/ only a comment /")).toThrow(/command is expected/);
  });

  it("text that ends inside the arguments", () => {
    expect(() => compile("[A] WalkTo JACK 10")).toThrow(/inside the arguments of WALKTO/);
    expect(() => compile("[A] SetScrollX1")).toThrow(/inside the arguments of SETSCROLLX1/);
  });

  it("macro name shorter than 2 characters", () => {
    expect(() => compile("X Stay A")).toThrow(/shorter than 2/);
  });

  it("Macros Error at 1500 commands or 150 macros", () => {
    expect(compile("[A] " + "Stay X ".repeat(MAX_COMMANDS - 1)).commands).toHaveLength(MAX_COMMANDS - 1);
    expect(() => compile("[A] " + "Stay X ".repeat(MAX_COMMANDS))).toThrow(/Macros Error: 1500 commands/);
    let many = "";
    for (let i = 0; i < MAX_MACROS - 1; i++) many += `[M${i}] Stay X `;
    expect(compile(many).macros).toHaveLength(MAX_MACROS - 1);
    expect(() => compile(many + "[LAST] Stay X")).toThrow(/150 macros/);
  });
});

describe("arguments", () => {
  it("SetPosition: numbers, *VARIABLES and JACK", () => {
    expect(one("SetPosition JACK 472 425")).toMatchObject({ n1: "JACK", a: [472, 425, JACK, 0, 0, 0, 0], refs: [] });
    const c = one("SetPosition KOT *JACKX *JACKY");
    expect(c.a).toEqual([0, 0, 0, 1, 1, 0, 0]);
    expect(c.refs).toEqual([[0, "var", "JACKX"], [1, "var", "JACKY"], [2, "person", "KOT"]]);
  });

  it("WalkTo / WalkToDir: flag char and flag slots", () => {
    expect(one("WalkTo OLDLADY 370 293 -")).toMatchObject({ a: [370, 293, 0, 0, 0, 0, 0], c: "-" });
    const d = one("WalkToDir JACK *X 5 3 +");
    expect(d.a).toEqual([0, 5, 3, JACK, 1, 0, 0]);
    expect(d.c).toBe("+");
  });

  it("numbers wrap to int16 like Text_ReadShort", () => {
    expect(one("SetScroll 70000").a[0]).toBe(70000 - 65536);
    expect(one("SetScroll -12abc").a[0]).toBe(-12);
  });

  it("floats are float32", () => {
    expect(one("Brightness 0.7").f).toBe(Math.fround(0.7));
    expect(one("SetPersonData JACK 5 0.63 416 12").f).toBe(Math.fround(0.63));
  });

  it("Anima reads the fifth number only for modes 3..6", () => {
    expect(one("Anima O11.PBM 0 50 2 +")).toMatchObject({ a: [0, 50, 2, 0, 0, 0, 0], c: "+" });
    expect(one("Anima O11.PBM 0 50 4 7 -")).toMatchObject({ a: [0, 50, 4, 0, 7, 0, 0], c: "-" });
    expect(one("Anima O11.PBM 0 50 7 -")).toMatchObject({ a: [0, 50, 7, 0, 0, 0, 0], c: "-" });
  });

  it("Talk speakers LEFT / RIGHT / JACK / POS / person", () => {
    expect(one("Talk LEFT 175 1 -").a.slice(0, 3)).toEqual([175, 1, -10]);
    expect(one("Talk RIGHT 150 2 -").a.slice(0, 3)).toEqual([150, 2, -11]);
    expect(one("Talk JACK 5 2 +").a.slice(0, 3)).toEqual([5, 2, JACK]);
    expect(one("Talk POS 5 2 +").a.slice(0, 3)).toEqual([5, 2, -12]);
    expect(one("Talk OLDLADY 10 2 -").refs).toEqual([[0, "line", 10], [2, "person", "OLDLADY"]]);
    expect(one("TalkRandom LEFT 300 1 -").refs).toEqual([[0, "dialog", 300]]);
    expect(one("TalkRandomIndex KOT 300 4 2 -")).toMatchObject({ a: [300, 2, 0, 4, 0, 0, 0] });
  });

  it("If / IfF / IfAnswer / IfMouseX", () => {
    const p = compile("[M] If LAST 4 IfF LAST > 3 IfF LAST = 3 IfF LAST < 3 IfF LAST ! 3 IfAnswer 1900 2 IfMouseXM 100 IfMouseXW 200 EndIf EndIf EndIf EndIf EndIf EndIf EndIf EndIf");
    const [iff, gt, eq, lt, bad, ans, xm, xw] = p.commands;
    expect(iff).toMatchObject({ a: [4, 0, 0, 0, 0, 0, 0], refs: [[2, "var", "LAST"]] });
    expect([gt.a[3], eq.a[3], lt.a[3], bad.a[3]]).toEqual([0, 1, 2, 0]);
    expect(gt.a[1]).toBe(1);
    expect(ans).toMatchObject({ a: [2, 5, 1900, 0, 0, 0, 0], refs: [[2, "dialog", 1900]] });
    expect([xm.a[0], xw.a[0]]).toEqual([100, 200]);
    expect(p.depth).toBe(0);
  });

  it("special forms", () => {
    expect(one("Music TR17-xx 0 1").n1).toBe("TR17-22.PMS");
    expect(one("Music TR17 0 1").n1).toBe("TR1722.PMS");
    expect(one("WalkEffect JACK 16 KROK1.SND").a).toEqual([16, 0, 0, JACK, 0, 0, 0]);
    expect(one("WalkEffect POL1 0 KROK1L.SND 2 64 9").a).toEqual([0, 2, 64, 0, 0, 9, 0]);
    expect(one("ShowFace KOT -*").a[1]).toBe(1);
    expect(one("ShowFace KOT -").a[1]).toBe(0);
    expect(one("JackTempo FREE").a[0]).toBe(0);
    expect(one("JackTempo SLOW").a[0]).toBe(1);
    expect(one("SetPosScroll L 10 20").a).toEqual([10, 20, 0, 0, 0, 0, 0]);
    expect(one("SetPosScroll R 10 20").a[2]).toBe(1);
    expect(one("ShowShadow EXTRA 1 2 0.5")).toMatchObject({ a: [-1, 1, 2, 0, 0, 0, 0], f: 0.5 });
    expect(one("HideShadow KOT").refs).toEqual([[0, "person", "KOT"]]);
    expect(one("AnimaShadow A1 JACK NULL 3").a).toEqual([0, JACK, -1, 3, 0, 0, 0]);
    expect(one("AnimaShadow A1 KOT S1 3").refs).toEqual([[0, "anim", "A1"], [1, "person", "KOT"], [2, "shadow", "S1"]]);
    expect(one("Effect DZW 1 2 3").a).toEqual([1, 0, 3, 3, 0, 0, 0]);
    expect(one("EffectVolume DZW 1 9").a).toEqual([9, 0, 9, 0, 0, 0, 0]);
    expect(one("PinArea KOT DRZWI 1 V1").refs).toEqual([[0, "person", "KOT"], [1, "area", "DRZWI"], [2, "var", "V1"]]);
    expect(one("SetPositionE GAZ.000 *X 500").a).toEqual([0, 500, 0, 1, 0, 0, 0]);
    expect(one("AnyKey KEY").refs).toEqual([[0, "var", "KEY"]]);
    expect(one("Take PET.001").refs).toEqual([[1, "object", "PET.001"]]);
    expect(one("HideTalk").a).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("problems", () => {
  const vars = new Map([["LAST", 5]]);
  it("reports unknown variables, long names and long flags", () => {
    const p = compile(`[M] If NOPE 1 Let LAST 1 Hide ${"N".repeat(40)} WalkTo KOT 1 2 -xyz`);
    expect(problemsOf(p, vars)).toEqual([
      'line 1 IF: variable "NOPE" not in VARIABLE.ALL',
      `line 1 HIDE: n1 "${"N".repeat(40)}" longer than 39`,
      'line 1 WALKTO: flag "-xyz" overruns the compiler\'s stack',
    ]);
    expect(problemsOf(p, vars, new Set(["NOPE"]))).toHaveLength(2);
    expect(problemsOf(compile(`[${"M".repeat(60)}] Stay X`), vars)).toEqual([`[${"M".repeat(60)}]: name longer than 59`]);
  });

  it("parseVariables reads name/value pairs, the first of a name wins", () => {
    expect([...parseVariables(bytes("XXX 0\r\nLAST 5\r\nSLAP  0\r\nLAST 9\r\n"))]).toEqual([["XXX", 0], ["LAST", 5], ["SLAP", 0]]);
  });
});
