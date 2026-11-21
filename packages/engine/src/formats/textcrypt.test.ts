import { describe, expect, it } from "vitest";
import {
  checkText,
  decrypt,
  decryptText,
  encrypt,
  isEncryptedName,
  MAZOVIA,
} from "./textcrypt";


// --- synthetic data ----------------------------------------------------------

const bytes = (...b: number[]) => new Uint8Array(b);
const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

describe("textcrypt on synthetic data", () => {
  it("applies b = ~(b - 7) to every byte", () => {
    // 'A' (0x41): 0x41 - 7 = 0x3a, ~0x3a = 0xc5
    expect([...decrypt(bytes(0xc5))]).toEqual([0x41]);
    for (let b = 0; b < 256; b++) expect(decrypt(bytes(b))[0]).toBe(~(b - 7) & 0xff);
  });

  it("wraps around at the byte boundaries", () => {
    expect([...decrypt(bytes(0x00, 0x06, 0x07, 0xff))]).toEqual([0x06, 0x00, 0xff, 0x07]);
  });

  it("is its own inverse", () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(encrypt).toBe(decrypt);
    expect([...decrypt(encrypt(all))]).toEqual([...all]);
  });

  it("handles empty input and does not modify its argument", () => {
    expect(decrypt(new Uint8Array(0)).length).toBe(0);
    const src = bytes(1, 2, 3);
    decrypt(src);
    expect([...src]).toEqual([1, 2, 3]);
  });

  it("decrypts text with CRLF and Polish letters", () => {
    const plain = bytes(...ascii("[A]\r\n"), 0x92, 0x86, 0x0d, 0x0a);
    expect(decryptText(encrypt(plain))).toBe("[A]\r\nłą\r\n");
  });

  it("maps all 256 bytes, with the 18 Polish letters at their Mazovia codes", () => {
    expect(MAZOVIA.length).toBe(256);
    expect(new Set(MAZOVIA).size).toBe(256);
    const polish: Record<number, string> = {
      0x86: "ą", 0x8d: "ć", 0x8f: "Ą", 0x90: "Ę", 0x91: "ę", 0x92: "ł", 0x95: "Ć", 0x98: "Ś", 0x9c: "Ł",
      0x9e: "ś", 0xa0: "Ź", 0xa1: "Ż", 0xa2: "ó", 0xa3: "Ó", 0xa4: "ń", 0xa5: "Ń", 0xa6: "ź", 0xa7: "ż",
    };
    for (const [b, c] of Object.entries(polish)) expect(MAZOVIA[Number(b)]).toBe(c);
    // the rest is CP437
    expect([MAZOVIA[0x41], MAZOVIA[0x80], MAZOVIA[0x82], MAZOVIA[0xb0], MAZOVIA[0xe1], MAZOVIA[0xff]]).toEqual([
      "A", "Ç", "é", "░", "ß", " ",
    ]);
  });

  it("recognises encrypted file names by extension", () => {
    expect(isEncryptedName("SC001.CCG")).toBe(true);
    expect(isEncryptedName("tekst.cod")).toBe(true);
    expect(isEncryptedName("VARIABLE.ALL")).toBe(false);
    expect(isEncryptedName("ELEM.LST")).toBe(false);
    expect(isEncryptedName("CCG")).toBe(false);
  });

  it("accepts tabs, CRLF lines and Polish letters", () => {
    expect(checkText("X.MCC", bytes(0x09, ...ascii("Let A 1\r\n"), 0xa7, 0x0d, 0x0a))).toEqual([]);
  });

  it("reports an empty file", () => {
    expect(checkText("X.CCG", new Uint8Array(0))).toEqual(["empty file"]);
  });

  it("reports control bytes, lone CR and lone LF", () => {
    expect(checkText("X.CCG", ascii("A\0\r\n"))).toEqual(["line 1: control byte 0x00"]);
    expect(checkText("X.CCG", ascii("A\rB\r\n"))).toEqual(["line 1: control byte 0x0d"]);
    expect(checkText("X.CCG", ascii("A\r\nB\nC\r\n"))).toEqual(["line 2: control byte 0x0a"]);
  });

  it("reports a missing final CRLF", () => {
    expect(checkText("X.CCG", ascii("A\r\nB"))).toEqual(["does not end with CRLF"]);
  });

  it("reports unexpected high bytes, except in .MCC comments and known typos", () => {
    expect(checkText("X.DCN", bytes(0x41, 0xbe, 0x0d, 0x0a))).toEqual(["line 1: unexpected byte 0xbe"]);
    expect(checkText("X.MCC", bytes(0x41, 0xbe, 0x0d, 0x0a))).toEqual(["line 1: unexpected byte 0xbe"]);
    expect(checkText("X.MCC", bytes(0x2f, 0xbe, 0x0d, 0x0a))).toEqual([]);
    // a comment does not carry over to the next line
    expect(checkText("X.MCC", bytes(0x2f, 0x0d, 0x0a, 0xbe, 0x0d, 0x0a))).toEqual(["line 2: unexpected byte 0xbe"]);
    expect(checkText("SC205.DCN", bytes(0x9f, 0x0d, 0x0a))).toEqual([]);
    expect(checkText("SC205.DCN", bytes(0xbe, 0x0d, 0x0a))).toEqual(["line 1: unexpected byte 0xbe"]);
  });

  it("stops after 10 problems", () => {
    expect(checkText("X.CCG", new Uint8Array(50)).length).toBe(10);
  });

  it("rejects text that was not encrypted", () => {
    // reading plain "ABC\r\n" as encrypted gives high bytes and no CRLF
    expect(checkText("X.CCG", decrypt(ascii("ABC\r\n")))).not.toEqual([]);
  });
});
