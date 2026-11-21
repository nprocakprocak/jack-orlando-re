import { describe, expect, it } from "vitest";
import {
  dialogOptions,
  faceFiles,
  findDialog,
  findFace,
  findTalkLine,
  parseDcn,
  parseFcc,
  parseSceneDialogs,
  voiceName,
} from "./dialog";
import { Pak } from "./pak";
import { encrypt } from "./textcrypt";

const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const text = (...l: string[]) => ascii(l.join("\r\n") + "\r\n");

// --- synthetic data ----------------------------------------------------------

const dcn = (...l: string[]) => parseDcn(text(...l));
const fcc = (...l: string[]) => parseFcc(text(...l));

describe("parseDcn on synthetic data", () => {
  it("reads lone lines (id, text with '_', width, sound)", () => {
    const d = dcn("10", "Hej,_wy_tam=!", "320", "T002.SND", "", "15", "Dobrze.", "150", "T004.SND", "", "");
    expect(d.dialogs).toEqual([]);
    expect(d.entries).toEqual([
      { id: 10, text: "Hej, wy tam=!", width: 320, sound: "T002.SND" },
      { id: 15, text: "Dobrze.", width: 150, sound: "T004.SND" },
    ]);
  });

  it("reads Q and R blocks: options get consecutive ids, lines stay in one table", () => {
    const d = dcn(
      "5",
      "A",
      "100",
      "T1.SND",
      "Q 1000",
      "2",
      "B",
      "110",
      "T2.SND",
      "C",
      "120",
      "T3.SND",
      "R 2000 1",
      "D",
      "130",
      "T4.SND",
      "6",
      "E",
      "140",
      "T5.SND",
      "",
    );
    expect(d.entries.map((e) => [e.id, e.text])).toEqual([
      [5, "A"],
      [1000, "B"],
      [1001, "C"],
      [2000, "D"],
      [6, "E"],
    ]);
    expect(d.dialogs).toEqual([
      { id: 1000, kind: "Q", first: 1, count: 2 },
      { id: 2000, kind: "R", first: 3, count: 1 },
    ]);
    expect(dialogOptions(d, 0).map((o) => o.text)).toEqual(["B", "C"]);
    expect(findDialog(d, 2000)).toBe(1);
    expect(findDialog(d, 1001)).toBe(-1);
    expect(findTalkLine(d, 1001)).toBe(2);
    expect(findTalkLine(d, 99)).toBe(-1);
  });

  it("decodes Mazovia text and wraps option ids as int16", () => {
    const bytes = Uint8Array.from([0x31, 0x20, 0x8d, 0x92, 0x5f, 0xa7, 0x20, 0x31, 0x20, ...ascii("T.SND")]);
    expect(parseDcn(bytes).entries[0].text).toBe("ćł ż");
    const d = dcn("Q 32767", "2", "A", "1", "T.SND", "B", "1", "T.SND", "");
    expect(d.entries.map((e) => e.id)).toEqual([32767, -32768]);
  });

  it("keeps a long lone line cut at 0x103 characters", () => {
    const d = dcn("1", "x".repeat(300), "5", "T.SND", "");
    expect(d.entries[0].text).toHaveLength(0x103);
  });

  it("ignores an id token that is the last thing in the file (as the loader does)", () => {
    expect(dcn("1", "A", "5", "T.SND", "99").entries).toHaveLength(1);
    expect(dcn("").entries).toEqual([]);
    expect(dcn("Q").dialogs).toEqual([]);
  });

  it("a non-numeric id token reads as 0 (atoi)", () => {
    expect(dcn("abc", "A", "5", "T.SND", "").entries[0].id).toBe(0);
  });

  it("a negative option count reads no options", () => {
    const d = dcn("Q 7 -1", "1", "A", "5", "T.SND", "");
    expect(d.dialogs).toEqual([{ id: 7, kind: "Q", first: 0, count: 0 }]);
    expect(d.entries.map((e) => e.id)).toEqual([1]);
  });

  it("rejects truncated files", () => {
    expect(() => dcn("1", "A", "5")).toThrow(/line sound missing/);
    expect(() => dcn("1", "A")).toThrow(/line width missing/);
    expect(() => dcn("1 A")).toThrow(/line width missing/);
    expect(() => dcn("1", "A", "5", "T.SND", "2", "B")).toThrow(/line width missing/);
    expect(() => dcn("Q 5 2", "A", "1", "T.SND")).toThrow(/option text missing/);
    expect(() => dcn("Q 5 1", "A", "1")).toThrow(/option sound missing/);
    expect(() => dcn("Q 5 1", "A")).toThrow(/option width missing/);
    expect(() => dcn("Q 5 1")).toThrow(/option text missing/);
    expect(() => dcn("Q 5")).toThrow(/option count missing/);
    expect(() => dcn("Q 5 ")).toThrow(/option count missing/);
  });

  it("rejects values that do not fit the game's buffers", () => {
    expect(() => dcn("12345678", "A", "1", "T.SND")).toThrow(/id token too long/);
    expect(() => dcn("1", "A", "1", "T1234567890123.SND")).toThrow(/sound name too long/);
    expect(() => dcn("Q 5 1", "x".repeat(0x104), "1", "T.SND")).toThrow(/option text too long/);
  });

  it("voiceName swaps the extension for .S22", () => {
    expect(voiceName("T002.SND")).toBe("T002.S22");
    expect(voiceName("T002")).toBe("T002.S22");
  });
});

describe("parseFcc on synthetic data", () => {
  const face = (name: string) => [
    name,
    "F.PBM",
    "1 2",
    "o1.pbm",
    "O2.PBM",
    "O3.PBM",
    "3 -4",
    "U1",
    "U2",
    "U3",
    "U4",
    "U5",
  ];

  it("reads faces; eye frames are upper-cased, the others are kept", () => {
    const f = fcc(...face("[AB]"), "", ...face("[CD]"), "");
    expect(f).toHaveLength(2);
    expect(f[0]).toEqual({
      name: "AB",
      face: "F.PBM",
      eyesPos: [1, 2],
      eyes: ["O1.PBM", "O2.PBM", "O3.PBM"],
      mouthPos: [3, -4],
      mouth: ["U1", "U2", "U3", "U4", "U5"],
    });
    expect(faceFiles(f[0])).toHaveLength(9);
  });

  it("drops the first and last character of the name, whatever they are", () => {
    expect(fcc(...face("xABy"))[0].name).toBe("AB");
    expect(fcc(...face("AB"))[0].name).toBe("");
  });

  it("face indices start at 2 and names are case-sensitive", () => {
    const f = fcc(...face("[AB]"), ...face("[CD]"));
    expect(findFace(f, "AB")).toBe(2);
    expect(findFace(f, "CD")).toBe(3);
    expect(findFace(f, "cd")).toBe(-1);
  });

  it("an empty file has no faces; a lone name is ignored", () => {
    expect(fcc("")).toEqual([]);
    expect(fcc("[AB]")).toEqual([]);
  });

  it("rejects truncated files and long names", () => {
    expect(() => fcc("[AB]", "F.PBM")).toThrow(/eyes x missing/);
    expect(() => fcc("[AB]", "F.PBM", "1")).toThrow(/eyes y missing/);
    expect(() => fcc("[AB]", "F.PBM", "1 2", "a", "b")).toThrow(/eye frame missing/);
    expect(() => fcc("[AB]", "F.PBM", "1 2", "a", "b", "c")).toThrow(/mouth x missing/);
    expect(() => fcc("[AB]", "F.PBM", "1 2", "a", "b", "c", "3 4", "1", "2", "3", "4")).toThrow(/mouth frame missing/);
    expect(() => fcc("[AB]")).not.toThrow();
    expect(() => fcc("[" + "N".repeat(20) + "]", "F.PBM")).toThrow(/face name too long/);
    expect(() => fcc("[AB]", "")).not.toThrow();
  });
});

describe("parseSceneDialogs on a synthetic archive", () => {
  function pakOf(files: Record<string, Uint8Array>): Pak {
    const names = Object.keys(files);
    let dirSize = 16;
    for (const n of names) dirSize += 12 + n.length + 1;
    const out = new Uint8Array(dirSize + names.reduce((s, n) => s + files[n].length, 0));
    const v = new DataView(out.buffer);
    out.set(ascii("PAK\0"));
    v.setUint32(4, names.length, true);
    v.setUint32(8, dirSize, true);
    let pos = 16;
    let off = dirSize;
    for (const n of names) {
      v.setUint32(pos, off, true);
      v.setUint32(pos + 4, files[n].length, true);
      v.setUint32(pos + 8, n.length + 1, true);
      out.set(ascii(n), pos + 12);
      pos += 12 + n.length + 1;
      out.set(files[n], off);
      off += files[n].length;
    }
    return new Pak(out);
  }

  it("decrypts the files; a missing file gives null", () => {
    const pak = pakOf({ "SC9.DCN": encrypt(text("10", "A_B", "5", "T.SND", "")) });
    const s = parseSceneDialogs(pak, "SC9");
    expect(s.fcc).toBeNull();
    expect(s.dcn!.entries[0].text).toBe("A B");
    expect(parseSceneDialogs(pakOf({}), "SC9")).toEqual({ scene: "SC9", dcn: null, fcc: null });
  });

  it("an empty file parses as an empty list", () => {
    const pak = pakOf({ "SC9.DCN": new Uint8Array(0), "SC9.FCC": new Uint8Array(0) });
    expect(parseSceneDialogs(pak, "SC9")).toEqual({
      scene: "SC9",
      dcn: { entries: [], dialogs: [] },
      fcc: [],
    });
  });
});
