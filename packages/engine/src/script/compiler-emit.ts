import { Tokens, cAtof, cAtoi, cUpper, s16 } from "../formats/global";
import {
  A, DONOTHING, ENDIF, JACK, MAX_COMMANDS, MAX_MACROS, MacroError, O, P, S, SPEC, V, WORDS, stripBrackets,
  type Command, type Macro, type Program, type RefKind, type Step,
} from "./compiler-words";

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

  // Next command word. A whole token "/" or "/*" starts a comment and is skipped.
  private nextCommandWord(): { word: string; start: number } {
    for (;;) {
      const start = this.t.pos;
      const word = this.word("cmd");
      if (word === "/") {
        this.skipComment("cmd", "/");
        continue;
      }
      if (word === "/*") {
        this.skipComment("cmd", "*/");
        continue;
      }
      return { word, start };
    }
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
      for (;;) {
        const { word, start } = this.nextCommandWord();
        if (word.startsWith("[")) {
          head = word;
          headPos = start;
          break;
        }
        this.command(cUpper(word), this.line(start));
        macro.count++;
        if (this.commands.length >= MAX_COMMANDS || this.macros.length >= MAX_MACROS) {
          throw new MacroError(`Macros Error: ${this.commands.length} commands, ${this.macros.length} macros`);
        }
        if (t.pos >= t.len) return this.result();
      }
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
      case 0x3f: // MUSIC
        this.music();
        break;
      case 0x42: // WALKEFFECT
        this.walkEffect();
        break;
      case 0x5b: // IFF
        this.iff();
        break;
      case 0x84: // JACKTEMPO FREE|...
        this.steps(["n1"]);
        a[0] = cmd.n1 === "FREE" ? 0 : 1;
        break;
      case 0x8e: // ANIMASHADOW
        this.animaShadow();
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

  /** MUSIC NAME-x -> "NAME-22.PMS" */
  private music(): void {
    const cmd = this.cmd;
    const tok = this.argToken("tmp");
    const i = tok.indexOf("-", 1);
    cmd.n1 = (i < 0 ? tok : tok.slice(0, i + 1)) + "22.PMS";
    this.steps([["s", 0], ["s", 1]]);
  }

  /** WALKEFFECT person steps sound, with the extra shorts when the person is not Jack. */
  private walkEffect(): void {
    const cmd = this.cmd;
    const a = cmd.a;
    this.steps(["n1", ["s", 0], "n2", ["r", 3, P, "n1"]]);
    if (a[3] !== JACK) this.steps([["s", 1], ["s", 2], ["s", 5]]);
    this.steps([["r", 4, S, "n2"]]);
  }

  /** IFF var op value */
  private iff(): void {
    const cmd = this.cmd;
    const a = cmd.a;
    this.steps(["n1", "n2", ["s", 0]]);
    const op = ({ "<": 2, "=": 1, ">": 0 } as Record<string, number>)[cmd.n2.slice(0, 1)];
    if (op !== undefined) a[3] = op;
    this.steps([["r", 2, V, "n1"]]);
    a[1] = this.depth++;
  }

  /** ANIMASHADOW anim person shadow|NULL n */
  private animaShadow(): void {
    const cmd = this.cmd;
    const a = cmd.a;
    this.steps(["n1", ["r", 0, A, "n1"], "n1", ["r", 1, P, "n1"], "n1"]);
    if (cmd.n1 === "NULL") a[2] = -1;
    else cmd.refs.push([2, "shadow", cmd.n1]);
    this.steps([["s", 3]]);
  }
}

/** Compiles .MCC text (decrypted). Throws MacroError where the game stops or hangs. */
export function compileMcc(plain: Uint8Array): Program {
  return new Compiler(plain).compile();
}
