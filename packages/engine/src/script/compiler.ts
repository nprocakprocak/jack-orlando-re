// Macro compiler.MCC text -> commands, after Script_CompileMacros.
// Same model as the external checker (keys as in Python).
// The game reads each command into a 0x6c-byte record: names n1 (+0x02) and n2 (+0x2a),
// shorts a[0..6] (+0x52..), a float f (+0x60) and the first char c of a flag token (+0x68).
// Names of scene things stay names in `refs` ([slot, kind, name]); the game resolves them
// to indices while compiling, the engine resolves them when a command runs.
import { Tokens, cAtof, cAtoi, cUpper, s16 } from "../formats/global";

export const MAX_COMMANDS = 1500; // "Macros Error" when the command count passes 0x5db
export const MAX_MACROS = 150; // ... or the macro count passes 0x95
export const NAME_MAX = 39; // n1/n2 are 40-byte fields
export const MACRO_NAME_MAX = 59; // 0x3c bytes in the macro table
export const FLAG_MAX = 3; // flag tokens go to a 1-byte stack buffer (3 chars still fit padding)
export const JACK = 0x66; // person index of Jack
export const DONOTHING = 0x6f;
export const ENDIF = 0x0f;
/** Codes that open a block closed by ENDIF (the interpreter's skip loop counts these). */
export const IF_CODES: readonly number[] = [0x0e, 0x1b, 0x2d, 0x2e, 0x5b];

/** Command words of the compiler's strcmp chain and their codes. */
export const WORDS: Readonly<Record<string, number>> = {
  CHWINDOW: 0x01, SETPOSITION: 0x02, INITFIRST: 0x03, SETPERSONDATA: 0x04, ANIMA: 0x05,
  STOPANIMA: 0x06, WALKTO: 0x07, RUNINSERTION: 0x08, RUNFILM: 0x09, HIDE: 0x0a, TALK: 0x0b,
  DIALOG: 0x0c, ACTIVEMACRO: 0x0d, IFANSWER: 0x0e, ENDIF: 0x0f, SHOWFRAME: 0x10, HIDETALK: 0x11,
  SHADOWBY: 0x12, SETSHADOW: 0x13, GOTOSCENE: 0x14, PUNDERP: 0x15, PUNDERE: 0x16, WALKTODIR: 0x17,
  SHOWFACE: 0x18, HIDEFACE: 0x19, LET: 0x1a, IF: 0x1b, SHOWANIMAFRAME: 0x1c, POVERE: 0x1d,
  EFFECT: 0x1e, EFFECTVOLUME: 0x20, TALKRANDOM: 0x21, TAKE: 0x22, RUNFILMP: 0x23, EXTRA: 0x25,
  MOVEAR: 0x26, SETFRAME: 0x27, NOHAVE: 0x28, HIDEE: 0x29, SHOWE: 0x2a, SETSHIFTX: 0x2b,
  SETPOSITIONE: 0x2c, SETPOSITIONEV: 0x70, IFMOUSEXM: 0x2d, IFMOUSEXW: 0x2e, SCROLLLEFT: 0x2f,
  SCROLLRIGHT: 0x30, SETSCROLLX1: 0x31, SETSCROLLX2: 0x32, SETPOSXY: 0x33, SETCHKPRIOR: 0x34,
  BRIGHTNESS: 0x36, SETPERSPY: 0x37, MOVEP: 0x38, STOPANIMAFRAME: 0x39, SETDIALOG: 0x3a,
  STOPANIMANEG: 0x3b, SETANIMAFRAME: 0x3c, DEACTIVESELF: 0x3d, EOVERE: 0x3e, MUSIC: 0x3f,
  MOVEE: 0x40, BRIGHTNESSE: 0x41, WALKEFFECT: 0x42, HAVEGUN: 0x43, NOHAVEGUN: 0x44,
  ACTIVEMACROAT: 0x45, HAVETOOL: 0x46, NOHAVETOOL: 0x47, INC: 0x48, WAITWHILE: 0x49, STAY: 0x4a,
  GAMEOVER: 0x4b, MOVEEP: 0x4c, WAITWHILEANIMA: 0x4d, SHOWFRAMEDIR: 0x50, STAYDEF: 0x51,
  UNLOCK: 0x52, CURSORAS: 0x53, ANIMAEFFECT: 0x54, SETAREA: 0x55, SETSPECAREA: 0x76,
  WAITTOANIMAFRAME: 0x56, SCROLLMARGINL: 0x57, SCROLLMARGINR: 0x58, OUTMACRO: 0x59,
  NORMALMACRO: 0x5a, IFF: 0x5b, AUTOINCRANGE: 0x5c, LOCK: 0x5e, HIDEFACEAT: 0x5f, INCLUDE: 0x60,
  LOOKTO: 0x61, GETPERSONX: 0x62, GETPERSONY: 0x63, INCC: 0x64, CONTINUEANIMA: 0x5d,
  LOCKWALK: 0x65, UNLOCKWALK: 0x66, WAITWHILEEFFECT: 0x67, SETDARKNESSANIMA: 0x68,
  SETDIRWALK: 0x6a, MESSAGE: 0x6c, POINTROTATE: 0x6d, RUNGLOBALFILMP: 0x6e, DONOTHING: 0x6f,
  SLAP: 0x71, SHOOT: 0x72, ACTIVEMACROANIMA: 0x73, PAUSE: 0x74, EXITGAME: 0x75, ROTATETO: 0x77,
  MACRODESTRUCTOR: 0x78, BLOCKMACRO: 0x79, UNBLOCKMACRO: 0x7a, PINAREA: 0x7b, ANIMADELAY: 0x7c,
  RANDOM: 0x7d, DEACTIVEMACRO: 0x7e, MIXING: 0x80, REFRESHSCREEN: 0x81, CLEARANIMABUFFER: 0x82,
  RUNAVX: 0x83, JACKTEMPO: 0x84, CLEARMENUBAR: 0x85, UNLOCKCANAL: 0x86, POINTINSECAREA: 0x87,
  TALKRANDOMINDEX: 0x88, MOUSETOTOOL: 0x89, RELATIVEMULP: 0x8a, MINSHADOW: 0x8b, MAXSHADOW: 0x8c,
  PUTSHADOW: 0x8d, ANIMASHADOW: 0x8e, SHIFTSHADOWP: 0x8f, PICKUP: 0x90, MUSICVOLUME: 0x91,
  GIVE: 0x92, SLAPF: 0x94, SHOOTF: 0x93, REACTIVESELF: 0x95, SETPOSSCROLL: 0x96,
  CHKDISTANCE: 0x97, POINTINWALKAREA: 0x98, SETSCROLL: 0x99, SETSPECSHADOW: 0x9a,
  SHOWSHADOW: 0x9b, SHADOWSTATUS: 0x9c, HIDESHADOW: 0x9d, SHADOWONE: 0x9e, ITEMPRESENT: 0x9f,
  IGNOREAREA: 0xa0, SAVEABLE: 0xa1, EXITTODOS: 0xa2, ANYKEY: 0xa3,
};

/** Canonical word of each code. */
export const NAMES: Readonly<Record<number, string>> = Object.fromEntries(
  Object.entries(WORDS).map(([w, c]) => [c, w]),
);

export class MacroError extends Error {}

/** What a name in a command refers to; resolved against the scene (or VARIABLE.ALL). */
export type RefKind =
  | "person" | "anim" | "object" | "var" | "sound" | "dialog" | "line" | "face" | "area" | "shadow";
/** [slot of a[], kind, name] — "dialog"/"line" refs carry the number read from the text. */
export type Ref = [number, RefKind, string | number];

export interface Command {
  code: number;
  /** the word as written, upper-cased (an unknown word compiles to DONOTHING) */
  word: string;
  line: number;
  n1: string;
  n2: string;
  a: number[];
  f: number | null;
  c: string | null;
  refs: Ref[];
  /** whole flag token (only for the length check) */
  flag?: string;
}

export interface Macro {
  name: string;
  start: number;
  count: number;
  line: number;
}

export interface Program {
  macros: Macro[];
  commands: Command[];
  /** If counter left at the end of the text (the game does not check it) */
  depth: number;
}

type Step =
  | "n1" | "n2" | "f" | "c"
  | ["s", number]
  | ["v", number, number]
  | ["r", number, RefKind, "n1" | "n2" | number];

const P = "person", A = "anim", O = "object", V = "var", S = "sound";

/** Argument readers per code, in the compiler's order (see the external checker SPEC). */
const SPEC: Readonly<Record<number, Step[]>> = {
  0x01: ["n1", ["s", 0], ["s", 1], ["s", 2], ["s", 3]],
  0x02: ["n1", ["v", 0, 4], ["v", 1, 3], ["r", 2, P, "n1"]],
  0x03: ["n1", "n2", ["s", 0], ["r", 1, P, "n1"]],
  0x04: ["n1", ["s", 0], "f", ["s", 1], ["s", 2], ["r", 3, P, "n1"]],
  0x06: ["n1", ["r", 3, A, "n1"]],
  0x07: ["n1", ["v", 0, 4], ["v", 1, 3], "c", ["r", 2, P, "n1"]],
  0x08: ["n1", "n2", "f", ["s", 0], "c", ["r", 1, P, "n1"]],
  0x09: ["n1", ["s", 0], ["s", 1], ["s", 2]],
  0x0a: ["n1", ["r", 0, P, "n1"]],
  0x0c: ["n1", ["s", 0]],
  0x0d: ["n1"],
  0x10: ["n1", ["s", 0], ["r", 1, P, "n1"]],
  0x12: ["n1", ["s", 0], ["s", 1], ["s", 2]],
  0x13: ["n1", ["s", 0], ["r", 1, P, "n1"]],
  0x14: ["n1"],
  0x15: ["n1", "n2", ["r", 0, P, "n1"], ["r", 1, P, "n2"]],
  0x16: ["n1", "n2", ["r", 0, P, "n1"], ["r", 1, O, "n2"]],
  0x17: ["n1", ["v", 0, 4], ["v", 1, 5], ["s", 2], "c", ["r", 3, P, "n1"]],
  0x19: ["c"],
  0x1a: ["n1", ["v", 0, 4], ["r", 1, V, "n1"]],
  0x1c: ["n1", ["s", 0], ["r", 3, A, "n1"]],
  0x1d: ["n1", "n2", ["r", 0, P, "n1"], ["r", 1, O, "n2"]],
  0x23: ["n1", ["s", 0], ["s", 1], ["s", 2]],
  0x25: [["s", 0]],
  0x26: ["n1", ["s", 0], ["s", 1], ["s", 3], ["r", 2, P, "n1"]],
  0x27: ["n1", ["s", 0], ["s", 1], ["r", 2, P, "n1"]],
  0x29: ["n1", ["r", 0, O, "n1"]],
  0x2a: ["n1", ["r", 0, O, "n1"]],
  0x2b: [["s", 0]],
  0x2c: ["n1", ["v", 0, 3], ["v", 1, 4], ["r", 2, O, "n1"]],
  0x31: [["s", 0]],
  0x32: [["s", 0]],
  0x33: [["s", 0], ["s", 1]],
  0x34: ["n1", ["s", 0], ["r", 1, P, "n1"]],
  0x36: ["f"],
  0x37: ["n1", ["s", 0], ["r", 1, P, "n1"]],
  0x38: ["n1", ["s", 0], ["s", 1], ["r", 2, P, "n1"]],
  0x39: ["n1", ["s", 0], ["r", 3, A, "n1"]],
  0x3a: [["s", 0], ["s", 1], ["s", 2], ["r", 0, "dialog", 0]],
  0x3b: ["n1", ["r", 3, A, "n1"]],
  0x3c: ["n1", ["s", 0], ["s", 1], ["r", 3, A, "n1"]],
  0x3e: ["n1", "n2", ["r", 0, O, "n1"], ["r", 1, O, "n2"]],
  0x40: ["n1", ["s", 0], ["s", 1], ["r", 2, O, "n1"]],
  0x41: ["n1", "f", ["r", 0, O, "n1"]],
  0x45: ["n1", ["s", 0]],
  0x46: ["n1", ["r", 0, O, "n1"]],
  0x47: ["n1"],
  0x48: ["n1", ["r", 1, V, "n1"]],
  0x49: ["n1", ["s", 0], ["r", 1, V, "n1"]],
  0x4a: ["n1"],
  0x4c: ["n1", ["s", 0], ["s", 1], ["r", 2, O, "n1"]],
  0x4d: ["n1", ["r", 3, A, "n1"]],
  0x50: ["n1", ["s", 0], ["s", 2], ["r", 1, P, "n1"]],
  0x53: ["n1"],
  0x54: ["n1", ["s", 5], ["s", 0], "n2", ["s", 1], ["s", 2], ["s", 6], ["r", 3, A, "n1"], ["r", 4, S, "n2"]],
  0x55: ["n1", ["s", 0], ["s", 1], ["r", 0, "area", "n1"]],
  0x56: ["n1", ["s", 0], ["r", 3, A, "n1"]],
  0x57: [["s", 0]],
  0x58: [["s", 0]],
  0x5c: ["n1", ["s", 0], ["s", 1], ["r", 2, V, "n1"]],
  0x5d: ["n1", ["r", 3, A, "n1"]],
  0x5f: ["c"],
  0x60: ["n1"],
  0x61: [["v", 0, 2], ["v", 1, 3]],
  0x62: ["n1", "n2", ["r", 0, P, "n1"], ["r", 1, V, "n2"]],
  0x63: ["n1", "n2", ["r", 0, P, "n1"], ["r", 1, V, "n2"]],
  0x64: ["n1", ["s", 0], ["r", 1, V, "n1"]],
  0x67: ["n1", ["r", 1, S, "n1"]],
  0x68: ["n1", "f", ["r", 3, A, "n1"]],
  0x6a: ["n1", ["s", 0], ["r", 2, P, "n1"]],
  0x6c: ["n1"],
  0x6d: [["s", 0]],
  0x6e: ["n1", ["s", 0], ["s", 1], ["s", 2]],
  0x6f: [["s", 0]],
  0x70: ["n1", ["s", 0], ["s", 1], ["r", 2, O, "n1"]],
  0x73: ["n1", "n2", ["s", 2], ["s", 0], ["r", 1, A, "n2"]],
  0x76: ["n1", ["s", 0], ["s", 1], ["r", 0, "area", "n1"]],
  0x77: [["v", 0, 2], ["v", 1, 3]],
  0x78: ["n1"],
  0x79: ["n1"],
  0x7a: ["n1"],
  0x7b: ["n1", ["r", 0, P, "n1"], "n1", ["s", 1], ["r", 1, "area", "n1"], "n1", ["r", 2, V, "n1"]],
  0x7c: ["n1", ["r", 0, A, "n1"], ["s", 1]],
  0x7d: ["n1", ["r", 0, V, "n1"], ["s", 1], ["s", 2]],
  0x7e: ["n1"],
  0x80: [["s", 0]],
  0x82: ["n1", ["r", 3, A, "n1"]],
  0x83: ["n1", "n2"],
  0x85: [["s", 0]],
  0x86: [["s", 0]],
  0x87: ["n1", ["r", 0, V, "n1"], "n1", ["r", 1, V, "n1"], "n1", ["r", 2, V, "n1"]],
  0x8a: ["n1", ["r", 0, P, "n1"], "f"],
  0x8b: ["n1", ["r", 1, P, "n1"], ["s", 2], ["s", 0]],
  0x8c: ["n1", ["r", 1, P, "n1"], ["s", 2], ["s", 0]],
  0x8d: [["s", 0], ["s", 1], "f"],
  0x8f: ["n1", ["r", 0, P, "n1"], ["s", 1], ["s", 2]],
  0x90: [["s", 0]],
  0x91: ["f"],
  0x92: [["s", 0]],
  0x93: [["s", 0]],
  0x94: [["s", 0]],
  0x97: ["n1", ["r", 0, P, "n1"], ["s", 1]],
  0x98: ["n1", ["r", 0, V, "n1"], "n1", ["r", 1, V, "n1"], "n1", ["r", 2, V, "n1"]],
  0x99: [["s", 0]],
  0x9a: ["n1", ["r", 0, P, "n1"], "n1", ["r", 1, O, "n1"]],
  0x9c: ["n1", ["r", 0, P, "n1"], ["s", 1]],
  0x9e: ["n1", ["r", 0, O, "n1"]],
  0x9f: ["n1", "n2", ["r", 0, V, "n2"]],
  0xa0: ["n1", ["s", 0], ["r", 0, "area", "n1"]],
  0xa1: [["s", 0]],
  0xa3: ["n2", ["r", 0, V, "n2"]],
};

/** drops the first and the last character ("[PRE]" -> "PRE"). */
export function stripBrackets(tok: string): string {
  if (tok.length < 2) throw new MacroError(`macro name "${tok}" shorter than 2 characters (the game overruns it)`);
  return tok.slice(1, -1);
}

const SPEAKERS: Readonly<Record<string, [number, number | null]>> = {
  LEFT: [-10, 1],
  RIGHT: [-11, 2],
  JACK: [JACK, null],
  POS: [-12, null],
};

class Compiler {
  private readonly t: Tokens;
  private readonly macros: Macro[] = [];
  private readonly commands: Command[] = [];
  private depth = 0; // one If counter for the whole file
  private cmd!: Command;

  constructor(plain: Uint8Array) {
    this.t = new Tokens(plain);
  }

  private argToken(buf: string): string {
    if (this.t.atEnd()) {
      throw new MacroError(`text ends inside the arguments of ${this.cmd.word} (the game would reuse stale buffers)`);
    }
    return this.t.next(buf);
  }

  private short(): number {
    if (this.t.atEnd()) throw new MacroError(`text ends inside the arguments of ${this.cmd.word}`);
    return this.t.short() as number;
  }

  private word(buf: string): string {
    if (this.t.atEnd()) throw new MacroError("text ends where a command is expected (the game loops for ever)");
    return this.t.next(buf);
  }

  private skipComment(buf: string, closing: string): void {
    for (;;) {
      if (this.t.atEnd()) throw new MacroError(`unterminated comment, no "${closing}" (the game loops for ever)`);
      if (this.t.next(buf) === closing) return;
    }
  }

  private line(pos: number): number {
    let n = 1;
    for (let i = this.t.text.indexOf("\n"); i >= 0 && i < pos; i = this.t.text.indexOf("\n", i + 1)) n++;
    return n;
  }

  compile(): Program {
    const t = this.t;
    if (t.len < 1) return this.result();
    t.skip();
    let headPos = t.pos;
    let head = t.next("head");
    if (head === "/") {
      this.skipComment("head", "/");
      headPos = t.pos;
      head = this.word("head");
    }
    if (head === "/*") {
      this.skipComment("head", "*/");
      headPos = t.pos;
      head = this.word("head");
    }
    for (;;) {
      const macro: Macro = { name: cUpper(stripBrackets(head)), start: this.commands.length, count: 0, line: this.line(headPos) };
      this.macros.push(macro);
      let word: string;
      let start: number;
      for (;;) {
        for (;;) {
          for (;;) {
            start = t.pos;
            word = this.word("cmd");
            if (word !== "/") break;
            this.skipComment("cmd", "/");
          }
          if (word !== "/*") break;
          this.skipComment("cmd", "*/");
        }
        if (word.startsWith("[")) break;
        this.command(cUpper(word), this.line(start));
        macro.count++;
        if (this.commands.length >= MAX_COMMANDS || this.macros.length >= MAX_MACROS) {
          throw new MacroError(`Macros Error: ${this.commands.length} commands, ${this.macros.length} macros`);
        }
        if (t.pos >= t.len) return this.result();
      }
      head = word;
      headPos = start;
    }
  }

  private result(): Program {
    return { macros: this.macros, commands: this.commands, depth: this.depth };
  }

  private command(word: string, line: number): void {
    const code = WORDS[word] ?? DONOTHING;
    this.cmd = { code, word, line, n1: "", n2: "", a: [0, 0, 0, 0, 0, 0, 0], f: null, c: null, refs: [] };
    this.commands.push(this.cmd);
    const spec = SPEC[code];
    if (spec) this.steps(spec);
    else this.special(code);
  }

  private steps(steps: readonly Step[]): void {
    const cmd = this.cmd;
    for (const st of steps) {
      if (st === "n1" || st === "n2") cmd[st] = this.argToken(st);
      else if (st === "f") cmd.f = Math.fround(cAtof(this.argToken("num")));
      else if (st === "c") {
        const tok = this.argToken("flag");
        cmd.c = tok.slice(0, 1);
        cmd.flag = tok;
      } else if (st[0] === "s") cmd.a[st[1]] = this.short();
      else if (st[0] === "v") {
        const tok = this.argToken("val");
        if (tok.startsWith("*")) {
          cmd.a[st[2]] = 1;
          cmd.refs.push([st[1], V, tok.slice(1)]);
        } else cmd.a[st[1]] = s16(cAtoi(tok));
      } else {
        const [, slot, kind, src] = st;
        const name = typeof src === "number" ? cmd.a[src] : cmd[src];
        if (kind === P && name === "JACK") cmd.a[slot] = JACK;
        else cmd.refs.push([slot, kind, name]);
      }
    }
  }

  /** TALK / TALKRANDOM / TALKRANDOMINDEX: who speaks (a[2]) from n1. */
  private speaker(lineKind: RefKind): void {
    const cmd = this.cmd;
    cmd.refs.push([0, lineKind, cmd.a[0]]);
    const special = SPEAKERS[cmd.n1];
    if (special) {
      cmd.a[2] = special[0];
      if (special[1] !== null) cmd.a[1] = special[1];
    } else cmd.refs.push([2, P, cmd.n1]);
  }

  private special(code: number): void {
    const cmd = this.cmd;
    const a = cmd.a;
    switch (code) {
      case 0x05: // ANIMA
        this.steps(["n1", ["s", 0], ["s", 1], ["s", 2]]);
        if (a[2] > 2 && a[2] < 7) a[4] = this.short();
        this.steps(["c", ["r", 3, A, "n1"]]);
        break;
      case 0x0b: // TALK
        this.steps(["n1", ["s", 0], ["s", 1], "c"]);
        this.speaker("line");
        break;
      case 0x21: // TALKRANDOM
        this.steps(["n1", ["s", 0], ["s", 1], "c"]);
        this.speaker("dialog");
        break;
      case 0x88: // TALKRANDOMINDEX
        this.steps(["n1", ["s", 0], ["s", 3], ["s", 1], "c"]);
        this.speaker("dialog");
        break;
      case 0x0c: // DIALOG
        this.steps(["n1", ["s", 0], ["r", 0, "dialog", 0]]);
        break;
      case 0x0e: // IFANSWER
        this.steps([["s", 2], ["s", 0], ["r", 2, "dialog", 2]]);
        a[1] = this.depth++;
        break;
      case ENDIF:
        if (--this.depth < 0) throw new MacroError("EndIf without If");
        break;
      case 0x18: // SHOWFACE: "-*" = the second char
        this.steps(["n1", "c"]);
        a[1] = cmd.flag?.slice(1, 2) === "*" ? 1 : 0;
        cmd.refs.push([0, "face", cmd.n1]);
        break;
      case 0x1b: // IF
        this.steps(["n1", ["s", 0], ["r", 2, V, "n1"]]);
        a[1] = this.depth++;
        break;
      case 0x1e: // EFFECT
        this.steps(["n1", ["s", 0], ["s", 2], ["s", 3], ["r", 1, S, "n1"]]);
        a[2] = a[3];
        break;
      case 0x20: // EFFECTVOLUME
        this.steps(["n1", ["s", 0], ["s", 2], ["r", 1, S, "n1"]]);
        a[0] = a[2];
        break;
      case 0x22: // TAKE: a[0] = sprite of object a[1] (runtime table)
        this.steps(["n1", ["r", 1, O, "n1"]]);
        break;
      case 0x2d: // IFMOUSEXM
      case 0x2e: // IFMOUSEXW
        this.steps([["s", 0]]);
        this.depth++;
        break;
      case 0x3f: {
        // MUSIC NAME-x -> "NAME-22.PMS"
        const tok = this.argToken("tmp");
        const i = tok.indexOf("-", 1);
        cmd.n1 = (i < 0 ? tok : tok.slice(0, i + 1)) + "22.PMS";
        this.steps([["s", 0], ["s", 1]]);
        break;
      }
      case 0x42: // WALKEFFECT
        this.steps(["n1", ["s", 0], "n2", ["r", 3, P, "n1"]]);
        if (a[3] !== JACK) this.steps([["s", 1], ["s", 2], ["s", 5]]);
        this.steps([["r", 4, S, "n2"]]);
        break;
      case 0x5b: {
        // IFF var op value
        this.steps(["n1", "n2", ["s", 0]]);
        const op = ({ "<": 2, "=": 1, ">": 0 } as Record<string, number>)[cmd.n2.slice(0, 1)];
        if (op !== undefined) a[3] = op;
        this.steps([["r", 2, V, "n1"]]);
        a[1] = this.depth++;
        break;
      }
      case 0x84: // JACKTEMPO FREE|...
        this.steps(["n1"]);
        a[0] = cmd.n1 === "FREE" ? 0 : 1;
        break;
      case 0x8e: // ANIMASHADOW anim person shadow|NULL n
        this.steps(["n1", ["r", 0, A, "n1"], "n1", ["r", 1, P, "n1"], "n1"]);
        if (cmd.n1 === "NULL") a[2] = -1;
        else cmd.refs.push([2, "shadow", cmd.n1]);
        this.steps([["s", 3]]);
        break;
      case 0x96: // SETPOSSCROLL L|R x y
        this.steps(["n1"]);
        a[2] = cmd.n1.slice(0, 1) === "L" ? 0 : 1;
        this.steps([["s", 0], ["s", 1]]);
        break;
      case 0x9b: // SHOWSHADOW EXTRA|person a b f
      case 0x9d: // HIDESHADOW EXTRA|person
        this.steps(["n1"]);
        if (cmd.n1 === "EXTRA") a[0] = -1;
        else this.steps([["r", 0, P, "n1"]]);
        if (code === 0x9b) this.steps([["s", 1], ["s", 2], "f"]);
        break;
      default: // every other code reads no arguments
    }
  }
}

/** Compiles .MCC text (decrypted). Throws MacroError where the game stops or hangs. */
export function compileMcc(plain: Uint8Array): Program {
  return new Compiler(plain).compile();
}

export function findMacro(program: Program, name: string): number {
  return program.macros.findIndex((m) => m.name === name);
}

export function macroCommands(program: Program, name: string): Command[] | null {
  const m = program.macros.find((x) => x.name === name);
  return m ? program.commands.slice(m.start, m.start + m.count) : null;
}

/** Var_LoadAll: names and start values of RESOURCE.PAK:VARIABLE.ALL (plain text). */
export function parseVariables(plain: Uint8Array): Map<string, number> {
  const t = new Tokens(plain);
  const out = new Map<string, number>();
  t.skip();
  while (!t.atEnd()) {
    const name = t.next("name");
    const v = t.short() ?? 0;
    if (!out.has(name)) out.set(name, v);
  }
  return out;
}

/** Problems the game would get wrong (same checks as the external checker problems_of). */
export function problemsOf(program: Program, variables: ReadonlyMap<string, number>, known: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = [];
  for (const m of program.macros) {
    if (m.name.length > MACRO_NAME_MAX) out.push(`[${m.name}]: name longer than ${MACRO_NAME_MAX}`);
  }
  for (const cmd of program.commands) {
    const where = `line ${cmd.line} ${cmd.word}`;
    for (const f of ["n1", "n2"] as const) {
      if (cmd[f].length > NAME_MAX) out.push(`${where}: ${f} "${cmd[f]}" longer than ${NAME_MAX}`);
    }
    if (cmd.flag !== undefined && cmd.flag.length > FLAG_MAX) out.push(`${where}: flag "${cmd.flag}" overruns the compiler's stack`);
    for (const [, kind, name] of cmd.refs) {
      if (kind === V && !variables.has(name as string) && !known.has(name as string)) {
        out.push(`${where}: variable "${name}" not in VARIABLE.ALL`);
      }
    }
  }
  return out;
}

/** Floats as millionths, without the flag token: the shape the external checker hashes. */
export function canonicalProgram(program: Program): unknown {
  return {
    macros: program.macros,
    commands: program.commands.map(({ flag: _flag, ...c }) => ({ ...c, f: c.f === null ? null : Math.floor(c.f * 1e6 + 0.5) })),
    depth: program.depth,
  };
}
