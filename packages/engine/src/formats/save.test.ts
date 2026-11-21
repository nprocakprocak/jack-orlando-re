import { describe, expect, it } from "vitest";
import {
  EMPTY_SIZE,
  HEADER_SIZE,
  INV_SLOTS,
  ITEM_IMAGE_SIZE,
  ITEM_NAME_SIZE,
  ITEM_PIXELS_MAX,
  ITEM_SIZE,
  MUSIC_SIZE,
  SCENE_SIZE,
  SaveError,
  VAR_SLOTS,
  acceptedBy,
  copyHeader,
  copyTemp,
  currentHeader,
  encodeCstr,
  headerText,
  isCopy,
  isLight,
  itemImage,
  itemName,
  itemPixels,
  itemSize,
  parseSave,
  savedMusic,
  verifySave,
  writeSave,
  type SaveGame,
} from "./save";

// --- synthetic saves ---------------------------------------------------------

function makeSave(over: Partial<SaveGame> = {}): SaveGame {
  const varValues = new Array<number>(VAR_SLOTS).fill(0);
  varValues[3] = 5; // LAST
  return {
    header: currentHeader(false),
    music: encodeCstr("TR17-22.PMS", MUSIC_SIZE),
    scene: encodeCstr("SC001.CCG", SCENE_SIZE),
    varCount: 247,
    varValues,
    items: [],
    autoincMin: 0,
    autoincMax: 0,
    autoincVar: -1,
    restorePose: 1,
    jackX: 343,
    jackY: 355,
    jackScale: 0.5,
    jackDir: 0,
    jackFacing: 1,
    ...over,
  };
}

function item(slot: number, name = "NOTES.BM", w = 2, h = 3) {
  const px = new Uint8Array(w * h * 2).map((_, i) => i + slot);
  return { slot, name: encodeCstr(name, ITEM_NAME_SIZE), image: itemImage(w, h, px) };
}

const bytes = (s: SaveGame) => writeSave(s);

describe("save on synthetic data", () => {
  it("writes the documented layout", () => {
    const s = makeSave({
      items: [item(5), item(0, "MONEY.BM")],
      autoincMin: -2,
      autoincMax: 200,
      autoincVar: 21,
    });
    const d = bytes(s);
    expect(d.length).toBe(EMPTY_SIZE + 2 * ITEM_SIZE);
    expect(new TextDecoder().decode(d.subarray(0, 25))).toBe("Jack Orlando - normal ver");
    const v = new DataView(d.buffer);
    expect(v.getUint16(108, true)).toBe(247);
    expect(v.getInt16(110 + 3 * 2, true)).toBe(5);
    expect(v.getUint16(1110, true)).toBe(2);
    expect(v.getUint16(1112, true)).toBe(0); // items sorted by slot
    expect(v.getUint16(1112 + ITEM_SIZE, true)).toBe(5);
    const tail = 1112 + 2 * ITEM_SIZE;
    expect(v.getInt16(tail, true)).toBe(-2);
    expect(v.getInt16(tail + 4, true)).toBe(21);
    expect(v.getUint8(tail + 6)).toBe(1);
    expect(v.getFloat32(tail + 7, true)).toBe(343);
    expect(v.getFloat32(tail + 15, true)).toBe(0.5);
  });

  it("round-trips parse -> write -> parse", () => {
    const s = makeSave({
      items: [item(0), item(83, "GAZ_I.047", 42, 42)],
      jackScale: 0.1,
      jackFacing: -1,
      jackDir: 4,
    });
    const d = bytes(s);
    const p = parseSave(d);
    expect(writeSave(p)).toEqual(d);
    expect(itemName(p.items[1])).toBe("GAZ_I.047");
    expect(itemSize(p.items[1])).toEqual({ width: 42, height: 42 });
    expect(itemPixels(p.items[1]).length).toBe(42 * 42 * 2);
    expect(p.jackScale).toBeCloseTo(0.1, 6);
    expect(verifySave("x.SAV", d)).toEqual([]);
  });

  it("keeps leftover bytes in names and images", () => {
    const it0 = item(1, "A.BM");
    it0.name[10] = 0x41;
    it0.image[ITEM_IMAGE_SIZE - 1] = 0x99;
    const d = bytes(makeSave({ items: [it0] }));
    expect(writeSave(parseSave(d))).toEqual(d);
    expect(itemName(parseSave(d).items[0])).toBe("A.BM");
  });

  it("detects the version byte and copy headers", () => {
    const light = makeSave({ header: currentHeader(true) });
    expect(isLight(light)).toBe(true);
    expect(acceptedBy(light, true)).toBe(true);
    expect(acceptedBy(light, false)).toBe(false);
    const copy = copyHeader(currentHeader(true));
    expect(copy.subarray(0, 13)).toEqual(new TextEncoder().encode("Jack Orlando\0"));
    expect(copy[15]).toBe(0x6c);
    const c = makeSave({ header: copy, restorePose: 0 });
    expect(isCopy(c)).toBe(true);
    expect(headerText(c)).toBe("Jack Orlando");
    expect(verifySave("AUTO - ZAPIS.svl", bytes(c))).toEqual([]);
  });

  it("copyTemp replaces only the header", () => {
    const temp = bytes(makeSave({ restorePose: 0 }));
    const out = copyTemp(temp);
    expect(out.subarray(HEADER_SIZE)).toEqual(temp.subarray(HEADER_SIZE));
    expect(headerText(parseSave(out))).toBe("Jack Orlando");
    expect(verifySave("AUTO - ZAPIS.sav", out)).toEqual([]);
    expect(() => copyTemp(new Uint8Array(10))).toThrow("tempjs shorter than its header");
  });

  it("replaces menu music TR02 with TR17-22.PMS", () => {
    expect(new TextDecoder().decode(savedMusic("TR02-22.PMS").subarray(0, 11))).toBe("TR17-22.PMS");
    expect(new TextDecoder().decode(savedMusic("TR12-22.PMS").subarray(0, 11))).toBe("TR12-22.PMS");
  });

  it("encodes Mazovia text", () => {
    const h = encodeCstr("Menu główne", HEADER_SIZE);
    expect(h[6]).toBe(0x92); // l-stroke
    expect(headerText(makeSave({ header: h }))).toBe("Menu główne");
    expect(() => encodeCstr("€", 10)).toThrow("not in Mazovia");
    expect(() => encodeCstr("SC001.CCG.LONG", SCENE_SIZE - 1)).toThrow("does not fit");
  });

  it("builds item images", () => {
    expect(itemImage(42, 42, new Uint8Array(42 * 42 * 2)).length).toBe(ITEM_IMAGE_SIZE);
    expect(() => itemImage(43, 42, new Uint8Array(43 * 42 * 2))).toThrow(`more than ${ITEM_PIXELS_MAX} pixels`);
    expect(() => itemImage(2, 2, new Uint8Array(3))).toThrow("pixel bytes");
  });

  // --- parser errors

  it("rejects short and truncated files", () => {
    expect(() => parseSave(new Uint8Array(EMPTY_SIZE - 1))).toThrow(SaveError);
    expect(() => parseSave(new Uint8Array(EMPTY_SIZE - 1))).toThrow("too short");
    const d = bytes(makeSave({ items: [item(0)] }));
    expect(() => parseSave(d.subarray(0, d.length - 1))).toThrow("truncated");
    const extra = new Uint8Array(d.length + 3);
    extra.set(d);
    expect(() => parseSave(extra)).toThrow("3 bytes after the end");
  });

  it("rejects bad item counts and slots", () => {
    const d = bytes(makeSave({ items: [item(0)] }));
    const v = new DataView(d.buffer);
    v.setUint16(1110, INV_SLOTS + 1, true);
    expect(() => parseSave(d)).toThrow("85 items");
    v.setUint16(1110, 1, true);
    v.setUint16(1112, INV_SLOTS, true);
    expect(() => parseSave(d)).toThrow("slot 84 out of range");
  });

  // --- writer errors

  it("rejects malformed structures on write", () => {
    expect(() => writeSave(makeSave({ header: new Uint8Array(79) }))).toThrow("header: 79 bytes");
    expect(() => writeSave(makeSave({ music: new Uint8Array(12) }))).toThrow("music");
    expect(() => writeSave(makeSave({ scene: new Uint8Array(16) }))).toThrow("scene");
    expect(() => writeSave(makeSave({ varValues: [1, 2] }))).toThrow("expected 500");
    expect(() => writeSave(makeSave({ items: [item(3), item(3)] }))).toThrow("same slot");
    expect(() => writeSave(makeSave({ items: [item(84)] }))).toThrow("slot: 84 out of range");
    expect(() => writeSave(makeSave({ items: Array.from({ length: 85 }, (_, i) => item(i)) }))).toThrow("85 items");
    const bad = item(1);
    bad.image = new Uint8Array(10);
    expect(() => writeSave(makeSave({ items: [bad] }))).toThrow("item 1 image");
    bad.image = itemImage(1, 1, new Uint8Array(2));
    bad.name = new Uint8Array(3);
    expect(() => writeSave(makeSave({ items: [bad] }))).toThrow("item 1 name");
    const vals = new Array<number>(VAR_SLOTS).fill(0);
    vals[7] = 40000;
    expect(() => writeSave(makeSave({ varValues: vals }))).toThrow("variable 7: 40000");
    expect(() => writeSave(makeSave({ varCount: -1 }))).toThrow("varCount");
    expect(() => writeSave(makeSave({ jackDir: 1.5 }))).toThrow("jackDir");
    expect(() => writeSave(makeSave({ restorePose: 256 }))).toThrow("restorePose");
  });

  // --- verify rules

  it("reports each documented inconsistency", () => {
    const check = (name: string, over: Partial<SaveGame>) => verifySave(name, bytes(makeSave(over)));
    expect(verifySave("x.SAV", new Uint8Array(5))[0]).toMatch("too short");
    expect(check("x.SVL", {})).toEqual(["extension does not match version byte 0x6e"]);
    expect(check("x.SAV", { restorePose: 0 })).toEqual(["restore_pose 0, expected 1"]);
    expect(check("tempjs", { restorePose: 1 })).toEqual(["restore_pose 1, expected 0"]);
    expect(check("x.SAV", { header: encodeCstr("Jack Orlando - demo", HEADER_SIZE) })).toEqual([
      'unknown header "Jack Orlando - demo"',
    ]);
    const odd = copyHeader(currentHeader(false));
    odd[20] = 0x58;
    expect(check("x.SAV", { header: odd, restorePose: 0 })).toEqual([
      "copy header: rest differs from the current header",
    ]);
    expect(check("x.SAV", { header: new Uint8Array(HEADER_SIZE).fill(0x41) })).toEqual(["header has no NUL"]);
    expect(check("x.SAV", { music: encodeCstr("TR02-22.PMS", MUSIC_SIZE) })).toEqual([
      "menu music TR02 saved (the writer replaces it)",
    ]);
    expect(check("x.SAV", { music: encodeCstr("X.WAV", MUSIC_SIZE) })).toEqual(['music "X.WAV" is not a .PMS']);
    expect(check("x.SAV", { scene: encodeCstr("SC001", SCENE_SIZE) })).toEqual(['scene "SC001" is not a .CCG']);
    expect(check("x.SAV", { varCount: 0, autoincVar: -1 })).toEqual(["var_count 0"]);
    const vals = new Array<number>(VAR_SLOTS).fill(0);
    vals[400] = 1;
    expect(check("x.SAV", { varValues: vals })).toEqual(["nonzero values past var_count"]);
    expect(check("x.SAV", { autoincVar: 247 })).toEqual(["autoinc_var 247"]);
    expect(check("x.SAV", { jackDir: 5 })).toEqual(["jack_dir 5"]);
    expect(check("x.SAV", { jackFacing: 0 })).toEqual(["jack_facing 0"]);
    expect(check("x.SAV", { jackScale: 0 })).toEqual(["jack_scale 0"]);
    expect(check("x.SAV", { header: encodeCstr("Menu główne", HEADER_SIZE), restorePose: 2 })).toEqual([
      "restore_pose 2",
    ]);
    const noName = item(2);
    noName.name = new Uint8Array(ITEM_NAME_SIZE);
    expect(check("x.SAV", { items: [noName] })).toEqual(["slot 2: bad name"]);
    const empty = item(2);
    empty.image = new Uint8Array(ITEM_IMAGE_SIZE);
    expect(check("x.SAV", { items: [empty] })).toEqual(["slot 2: image 0x0"]);
  });

  it("reports unsorted items and non-round-trip files", () => {
    const d = bytes(makeSave({ items: [item(1), item(4)] }));
    const v = new DataView(d.buffer);
    v.setUint16(1112, 9, true); // first item claims slot 9: order 9, 4
    expect(verifySave("x.SAV", d)).toEqual([
      "writeSave(parseSave(data)) differs from the file",
      "item slots not strictly increasing: 9,4",
    ]);
  });
});
