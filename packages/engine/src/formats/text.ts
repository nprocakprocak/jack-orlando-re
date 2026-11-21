// Plain game text files of RESOURCE.PAK: VARIABLE.ALL, ELEM.LST / ELEM.GER, TEKST.COD.
// Python twin: the external checker.
import { Tokens } from "./global";
import { decodeText, decrypt } from "./textcrypt";

export const VAR_NAME_MAX = 29; // g_varNames: 0x1e bytes per name, NUL included
export const VAR_MAX = 2024; // g_varValues (int16) 008a27d8 g_varNames 008a37a8
export const ITEM_FILE_MAX = 13; // item bitmap names live in 0xe-byte slots (007bf0d8 + n * 0xe)

/** Variables Var_LoadAll remembers the index. SHIFTX is not in the shipped file. */
export const SPECIAL_VARS = [
  "GUN",
  "LAST",
  "RAND",
  "MOUSEX",
  "MOUSEY",
  "JACKX",
  "JACKY",
  "MENU",
  "SHOOT",
  "SLAP",
  "SHIFTX",
];

/** TEKST.COD line kind -> row height in pixels. */
export const CREDIT_ROW_HEIGHT: Readonly<Record<string, number>> = { "=": 13, "#": 9 };

export class TextError extends Error {}

export interface GameVariable {
  name: string;
  value: number;
}
export interface ItemRecord {
  /** first token as is: digits or "&" (the game ignores the field) */
  number: string;
  /** display name, "_" turned into spaces */
  name: string;
  /** lookup key: the item's bitmap file */
  file: string;
}
export interface CreditLine {
  kind: string;
  style: string;
  text: string;
}

const latin1Bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** Next token; the game keeps a stale buffer at the end of the text, here it is an error. */
function strictToken(t: Tokens, what: string): string {
  t.skip();
  if (t.pos >= t.len) throw new TextError(`text ends before ${what}`);
  return t.next("tok");
}

/** VARIABLE.ALL (Var_LoadAll): "NAME value" pairs; the array index is the variable index. */
export function parseVariables(data: Uint8Array): GameVariable[] {
  const t = new Tokens(data);
  const out: GameVariable[] = [];
  t.skip();
  while (t.pos < t.len) {
    const name = t.next("name");
    if (name.length > VAR_NAME_MAX) throw new TextError(`variable name '${name}' longer than ${VAR_NAME_MAX} bytes`);
    const value = t.short();
    if (value === null) throw new TextError(`variable '${name}' has no value`);
    out.push({ name: decodeText(latin1Bytes(name)), value });
    if (out.length > VAR_MAX) throw new TextError(`more than ${VAR_MAX} variables`);
  }
  return out;
}

/** ELEM.LST / ELEM.GER: records of three tokens: number, name, file. */
export function parseItems(data: Uint8Array): ItemRecord[] {
  const t = new Tokens(data);
  const out: ItemRecord[] = [];
  t.skip();
  while (t.pos < t.len) {
    const number = t.next("a");
    const name = strictToken(t, "an item name");
    const file = strictToken(t, "an item file");
    out.push({ number, name: decodeText(latin1Bytes(name.replaceAll("_", " "))), file });
  }
  return out;
}

/** name of the first record whose file equals key (case-sensitive), "" when none. */
export function lookupItem(items: readonly ItemRecord[], key: string): string {
  return items.find((i) => i.file === key)?.name ?? "";
}

/** Decrypted TEKST.COD (Gui_ShowAbout): lines split at bytes <= 0x0d. */
export function parseCredits(plain: Uint8Array): CreditLine[] {
  const out: CreditLine[] = [];
  let i = 0;
  while (i < plain.length) {
    while (i < plain.length && plain[i] <= 0x0d) i++;
    const start = i;
    while (i < plain.length && plain[i] > 0x0d) i++;
    if (i === start) break;
    const line = plain.subarray(start, i);
    if (line.length < 2) throw new TextError(`credits line too short: ${decodeText(line)}`);
    const kind = String.fromCharCode(line[0]);
    if (!(kind in CREDIT_ROW_HEIGHT)) throw new TextError(`unknown credits line kind '${kind}'`);
    out.push({ kind, style: String.fromCharCode(line[1]), text: decodeText(line.subarray(2)) });
  }
  return out;
}

export const PATTERNS = ["VARIABLE.ALL", "ELEM.LST", "ELEM.GER", "TEKST.COD"];

function checkPlain(data: Uint8Array): string[] {
  const problems: string[] = [];
  if (data.some((b) => b < 0x20 && b !== 0x0d && b !== 0x0a && b !== 0x09))
    problems.push("control bytes in plain text");
  let badEnds = false;
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0x0d && data[i + 1] !== 0x0a) badEnds = true;
    if (data[i] === 0x0a && (i === 0 || data[i - 1] !== 0x0d)) badEnds = true;
  }
  if (badEnds) problems.push("line ends other than CR LF");
  if (!(data.length >= 2 && data[data.length - 2] === 0x0d && data[data.length - 1] === 0x0a)) {
    problems.push("no CR LF at the end");
  }
  return problems;
}

const duplicates = (items: string[]) => [...new Set(items.filter((x, i) => items.indexOf(x) !== i))].sort();

/** Problems found in one file (empty = OK); same checks as verify() in the external checker. */
export function verifyText(name: string, data: Uint8Array): string[] {
  const upper = name.toUpperCase();
  try {
    if (upper === "VARIABLE.ALL") {
      const problems = checkPlain(data);
      const names = parseVariables(data).map((v) => v.name);
      problems.push(...duplicates(names).map((n) => `duplicate variable ${n}`));
      problems.push(
        ...SPECIAL_VARS.filter((n) => n !== "SHIFTX" && !names.includes(n)).map((n) => `variable ${n} missing`),
      );
      return problems;
    }
    if (upper === "ELEM.LST" || upper === "ELEM.GER") {
      const problems = checkPlain(data);
      const items = parseItems(data);
      for (const it of items) {
        if (!(/^[0-9]+$/.test(it.number) || it.number === "&")) problems.push(`bad item number '${it.number}'`);
        if (it.file.length > ITEM_FILE_MAX) problems.push(`item file '${it.file}' longer than ${ITEM_FILE_MAX}`);
      }
      problems.push(...duplicates(items.map((i) => i.file)).map((f) => `duplicate item file ${f}`));
      return problems;
    }
    if (upper === "TEKST.COD") {
      const plain = decrypt(data);
      const problems = checkPlain(plain);
      const styles = [...new Set(parseCredits(plain).map((l) => l.style))].filter((s) => !"12!".includes(s)).sort();
      problems.push(...styles.map((s) => `credits style '${s}' unknown`));
      return problems;
    }
  } catch (e) {
    if (e instanceof TextError) return [e.message];
    throw e;
  }
  return [`unknown file ${name}`];
}
