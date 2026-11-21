export class GlobalError extends Error {}

// --- text tokenizer (shared by every text format; scene.ts re-exports it) ------------------
// Interface for readers of the game's text files (scene .CCG/.ACE/.PCS/.ACI.ICS.SSD, and
// the .MCC compiler in). Same as the external checker.
// new Tokens(plain) reader over a decrypted buffer (latin-1)
// .next(buf?) Text_NextToken: next run of bytes > 0x20. At the end of the
// text the game leaves the destination buffer alone, so the token last
// read into the same named buffer is returned again ("" if none)
// .short() Text_ReadShort /: next token via atoi as int16; null
// at the end of the text
// .atEnd() nothing but separators left
// .findSection(n) Text_FindSection: rewinds, scans for token n (upper-cased
// compare); true only if text remains after it
// .pos.len cursor and length
// tokens(plain) all tokens as a string[] (strict parsers below)
// cAtoi/cAtof/s16 atoi/atof of a token, int16 wrap
// cUpper _strupr of the C locale (only a-z change)
// strBetween Str_Between ; bracketName = its "[" "]" use
// parseIcs/parseSsd the single ICS and SSD parsers (scene.ts adapts their result)

export function cAtoi(tok: string): number {
  const m = /^[+-]?[0-9]+/.exec(tok);
  return m ? parseInt(m[0], 10) : 0;
}

export function s16(v: number): number {
  return (((v + 0x8000) & 0xffff) - 0x8000) | 0;
}

export function cAtof(tok: string): number {
  const m = /^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?/.exec(tok);
  return m ? parseFloat(m[0]) : 0;
}

/** _strupr in the C locale: only a-z change. */
export function cUpper(s: string): string {
  return s.replace(/[a-z]+/g, (m) => m.toUpperCase());
}

/** Str_Between: characters after the first `opening` up to `closing` or the end. */
export function strBetween(tok: string, opening: string, closing: string): string {
  const i = tok.indexOf(opening);
  if (i < 0) return "";
  const j = tok.indexOf(closing, i + 1);
  return j < 0 ? tok.slice(i + 1) : tok.slice(i + 1, j);
}

export function bracketName(tok: string): string {
  return strBetween(tok, "[", "]");
}

/**
 * Text_NextToken over decrypted bytes. At the end of the text the game does not write the
 * destination buffer, so the token read last into it is returned again.
 */
export class Tokens {
  readonly text: string;
  pos = 0;
  private readonly buffers = new Map<string, string>();

  constructor(plain: Uint8Array) {
    let s = "";
    for (let i = 0; i < plain.length; i += 4096) s += String.fromCharCode(...plain.subarray(i, i + 4096));
    this.text = s; // latin-1: one char per byte
  }

  get len(): number {
    return this.text.length;
  }

  skip(): void {
    while (this.pos < this.len && this.text.charCodeAt(this.pos) < 0x21) this.pos++;
  }

  next(buf = "tok"): string {
    this.skip();
    if (this.pos < this.len) {
      const start = this.pos;
      while (this.pos < this.len && this.text.charCodeAt(this.pos) > 0x20) this.pos++;
      this.buffers.set(buf, this.text.slice(start, this.pos));
      this.skip();
    }
    return this.buffers.get(buf) ?? "";
  }

  /** /: next token, atoi, s16; null = at end, destination unchanged. */
  short(): number | null {
    this.skip();
    if (this.pos >= this.len) return null;
    return s16(cAtoi(this.next("num")));
  }

  atEnd(): boolean {
    return this.pos >= this.len;
  }

  /** scan from the start for a token equal to name; true only if text remains. */
  findSection(name: string): boolean {
    const want = cUpper(name);
    this.pos = 0;
    for (;;) {
      const tok = this.next("section");
      if (cUpper(tok) === want || this.pos >= this.len) break;
    }
    return this.pos < this.len;
  }
}

/** All tokens of the text (Text_NextToken until the end). */
export function tokens(plain: Uint8Array): string[] {
  const t = new Tokens(plain);
  t.skip();
  const out: string[] = [];
  while (!t.atEnd()) out.push(t.next());
  return out;
}
