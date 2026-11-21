import { describe, expect, it } from "vitest";
import {
  CREDIT_ROW_HEIGHT,
  lookupItem,
  parseCredits,
  parseItems,
  parseVariables,
  TextError,
  VAR_MAX,
  VAR_NAME_MAX,
  verifyText,
} from "./text";
import { encrypt } from "./textcrypt";

const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const crlf = (...l: string[]) => bytes(l.join("\r\n") + "\r\n");


// --- synthetic data ---------------------------------------------------------

describe("VARIABLE.ALL", () => {
  it("reads NAME value pairs in order, atoi into int16", () => {
    const v = parseVariables(crlf("A 1", "B  -2", "C 40000", "D x", "E 12ab"));
    expect(v).toEqual([
      { name: "A", value: 1 },
      { name: "B", value: -2 },
      { name: "C", value: -25536 },
      { name: "D", value: 0 },
      { name: "E", value: 12 },
    ]);
  });

  it("accepts leading blanks, a missing final CR LF and any whitespace between tokens", () => {
    expect(parseVariables(bytes("\r\n  A\t1 B\r\n2"))).toEqual([
      { name: "A", value: 1 },
      { name: "B", value: 2 },
    ]);
  });

  it("is empty for an empty or blank text", () => {
    expect(parseVariables(new Uint8Array())).toEqual([]);
    expect(parseVariables(bytes(" \r\n"))).toEqual([]);
  });

  it("rejects a name without value", () => {
    expect(() => parseVariables(crlf("A 1", "B"))).toThrow(new TextError("variable 'B' has no value"));
  });

  it("rejects an overlong name, accepts the longest", () => {
    expect(parseVariables(crlf("N".repeat(VAR_NAME_MAX) + " 1"))).toHaveLength(1);
    expect(() => parseVariables(crlf("N".repeat(VAR_NAME_MAX + 1) + " 1"))).toThrow(/longer than 29/);
  });

  it("rejects more variables than the table holds", () => {
    const lines = Array.from({ length: VAR_MAX + 1 }, (_, i) => `V${i} 0`);
    expect(parseVariables(crlf(...lines.slice(0, VAR_MAX)))).toHaveLength(VAR_MAX);
    expect(() => parseVariables(crlf(...lines))).toThrow(/more than 2024/);
  });

  it("verify reports duplicates, missing specials and bad line ends", () => {
    const base = ["GUN", "LAST", "RAND", "MOUSEX", "MOUSEY", "JACKX", "JACKY", "MENU", "SHOOT", "SLAP"].map((n) => `${n} 0`);
    expect(verifyText("VARIABLE.ALL", crlf(...base))).toEqual([]);
    expect(verifyText("VARIABLE.ALL", crlf(...base, "GUN 1"))).toEqual(["duplicate variable GUN"]);
    expect(verifyText("VARIABLE.ALL", crlf(...base.slice(1)))).toEqual(["variable GUN missing"]);
    expect(verifyText("VARIABLE.ALL", bytes(base.join("\n") + "\r\n"))).toContain("line ends other than CR LF");
    expect(verifyText("VARIABLE.ALL", bytes(base.join("\r\n")))).toContain("no CR LF at the end");
    expect(verifyText("VARIABLE.ALL", bytes("A\x01 1\r\n"))).toContain("control bytes in plain text");
  });
});

describe("ELEM.LST", () => {
  it("reads number, name and file; '_' in the name becomes a space; Mazovia in names", () => {
    const it = parseItems(bytes("1  RED_LAMP\tLAMP.BM\r\n&  ZO\x9cA\t\tZOA.BM \r\n"));
    expect(it).toEqual([
      { number: "1", name: "RED LAMP", file: "LAMP.BM" },
      { number: "&", name: "ZOŁA", file: "ZOA.BM" },
    ]);
  });

  it("looks up the first record with exactly the same file, case-sensitive", () => {
    const it = parseItems(crlf("1 A X.BM", "2 B X.BM", "3 C y.bm"));
    expect(lookupItem(it, "X.BM")).toBe("A");
    expect(lookupItem(it, "Y.BM")).toBe("");
    expect(lookupItem(it, "y.bm")).toBe("C");
    expect(lookupItem(it, "none")).toBe("");
  });

  it("rejects a record cut short", () => {
    expect(() => parseItems(crlf("1 A X.BM", "2 B"))).toThrow(new TextError("text ends before an item file"));
    expect(() => parseItems(crlf("1 A X.BM", "2"))).toThrow(new TextError("text ends before an item name"));
  });

  it("verify checks number, file length and duplicates", () => {
    expect(verifyText("ELEM.LST", crlf("1 A X.BM", "& B Y.BM"))).toEqual([]);
    expect(verifyText("ELEM.GER", crlf("x A X.BM"))).toEqual(["bad item number 'x'"]);
    expect(verifyText("ELEM.LST", crlf("1 A 12345678.BMPXY"))).toEqual(["item file '12345678.BMPXY' longer than 13"]);
    expect(verifyText("ELEM.LST", crlf("1 A X.BM", "2 B X.BM"))).toEqual(["duplicate item file X.BM"]);
    expect(verifyText("ELEM.LST", crlf("1 A"))).toEqual(["text ends before an item file"]);
  });
});

describe("TEKST.COD", () => {
  it("splits lines at bytes <= 0x0d and keeps spaces", () => {
    const rows = parseCredits(crlf("#1NOTE", "=2Ma\x92y Kot", "#!", "=1"));
    expect(rows).toEqual([
      { kind: "#", style: "1", text: "NOTE" },
      { kind: "=", style: "2", text: "Mały Kot" },
      { kind: "#", style: "!", text: "" },
      { kind: "=", style: "1", text: "" },
    ]);
    expect(CREDIT_ROW_HEIGHT).toEqual({ "=": 13, "#": 9 });
  });

  it("rejects too short lines and unknown kinds", () => {
    expect(() => parseCredits(crlf("#1A", "="))).toThrow(/too short/);
    expect(() => parseCredits(crlf("?1A"))).toThrow(new TextError("unknown credits line kind '?'"));
  });

  it("verify decrypts first and checks the styles", () => {
    expect(verifyText("TEKST.COD", encrypt(crlf("#1A", "=2B", "#!")))).toEqual([]);
    expect(verifyText("TEKST.COD", encrypt(crlf("#9A")))).toEqual(["credits style '9' unknown"]);
    expect(verifyText("TEKST.COD", crlf("#1A"))).not.toEqual([]);
  });

  it("verify rejects unknown files", () => {
    expect(verifyText("OTHER.TXT", new Uint8Array())).toEqual(["unknown file OTHER.TXT"]);
  });
});
