// A ScenePlayer built from invented archive bytes: the constructor, one walk, one object, HIDE JACK.
import { describe, expect, it } from "vitest";
import { WALK_FRAMES, WALK_SERIES, standFrameFile, walkFrameFile, type JackDir } from "../anim/jack";
import { Pak } from "../formats/pak";
import { encrypt } from "../formats/textcrypt";
import { Z_JACK, ScenePlayer } from "./player";

const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const lines = (...l: string[]) => ascii(l.join("\r\n") + "\r\n");

/** Minimal .PAK, same layout as the scene format tests. Text files are already encrypted. */
function pakOf(files: Record<string, Uint8Array>): Pak {
  const names = Object.keys(files);
  let dirSize = 16;
  for (const n of names) dirSize += 12 + n.length + 1;
  const total = dirSize + names.reduce((s, n) => s + files[n].length, 0);
  const out = new Uint8Array(total);
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

/** 1×1 RGB565 .BM. */
function bm1(): Uint8Array {
  return new Uint8Array([1, 0, 1, 0, 0, 0]);
}

/** 1×1 .PBM: header, 256-byte palette, one even pixel byte. */
function pbm1(): Uint8Array {
  const data = new Uint8Array(4 + 256 + 1);
  const v = new DataView(data.buffer);
  v.setUint16(0, 1, true);
  v.setUint16(2, 1, true);
  return data;
}

/** Twelve hot spots, one per walk frame. */
function sfb12(): Uint8Array {
  return new Uint8Array(WALK_FRAMES * 6);
}

function resource(): Pak {
  const files: Record<string, Uint8Array> = { "CIEN1.BM": bm1() };
  for (let d = 0; d < WALK_SERIES.length; d++) {
    const dir = d as JackDir;
    files[`${WALK_SERIES[dir]}.SFB`] = sfb12();
    files[standFrameFile(dir)] = pbm1();
    for (let f = 0; f < WALK_FRAMES; f++) files[walkFrameFile(dir, f)] = pbm1();
  }
  return pakOf(files);
}

function scene(walk: boolean): Pak {
  const ccg = lines(
    "[grafiki]",
    "BG.BM",
    "BOX.BM 16 10 420 1.000000 0.500000 0 0 2 0 2 2 0 2",
    "[perspektywa]",
    "310 220 416 0.630000",
    ...(walk ? ["[obszar_chodu]", "1", "0 400 400 400 200 700"] : []),
  );
  return pakOf({
    "SC001.CCG": encrypt(ccg),
    "SC001.MCC": encrypt(lines("[PRE]", "Let LOC1 1")),
    "BG.BM": bm1(),
    "BOX.BM": bm1(),
  });
}

function player(walk = true): ScenePlayer {
  return new ScenePlayer({ name: "SC001", resource: resource(), phk: scene(walk) }, { shadows: false });
}

describe("ScenePlayer on a synthetic archive", () => {
  it("refuses a scene with no walk area", () => {
    expect(() => new ScenePlayer({ name: "SC001", resource: resource(), phk: scene(false) })).toThrow(/no walk area/);
  });

  it("walks Jack to a point inside the triangle and finds the object", () => {
    const p = player();
    expect(p.hasObject("BOX.BM")).toBe(true);
    expect(p.objectPosition("BOX.BM")).toEqual({ x: 10, y: 420 });
    const start = { x: p.walker.x, y: p.walker.y };
    expect(p.walkJackTo(200, 560)).toBe(true);
    let arrived = false;
    for (let i = 0; i < 400 && !arrived; i++) arrived = p.tick().arrived;
    expect(arrived).toBe(true);
    expect(p.walker.x !== start.x || p.walker.y !== start.y).toBe(true);
    expect(p.walker.walking).toBe(false);
  });

  it("hides Jack, and a tick while he stands leaves him hidden", () => {
    const p = player();
    p.hideJack();
    p.tick();
    expect(p.jackHidden).toBe(true);
    const jack = p.renderer.sprites.items.find((s) => s.z === Z_JACK);
    expect(jack?.visible).toBe(false);
  });
});
