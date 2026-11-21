// decodeSceneImage: the format of a scene archive file comes from its content, not its extension (DL0.011 is a PBM).
import { describe, expect, it } from "vitest";
import { decodeSceneImage } from "./player";

function pbm(w: number, h: number, stream: number[]): Uint8Array {
  const pal = new Array(128).fill(0);
  pal[1] = 0xf800;
  return new Uint8Array([w & 255, w >> 8, h & 255, h >> 8, ...pal.flatMap((c) => [c & 255, c >> 8]), ...stream]);
}

function bm16(w: number, h: number, px: number[]): Uint8Array {
  return new Uint8Array([w & 255, w >> 8, h & 255, h >> 8, ...px.flatMap((c) => [c & 255, c >> 8])]);
}

describe("decodeSceneImage", () => {
  it("decodes a PBM stored under a numeric extension (DL0.011)", () => {
    const img = decodeSceneImage(pbm(3, 1, [3, 3]), "DL0.011");
    expect(img.kind).toBe("pal8rle");
    expect([...img.pixels]).toEqual([0xf800, 0xf800, 0xf800]);
  });

  it("an all-literal PBM has the size of an 8-bit BM: the CCG object type decides", () => {
    const data = pbm(3, 1, [2, 2, 2]);
    expect(decodeSceneImage(data, "DL0.011").kind).toBe("pal8");
    expect(decodeSceneImage(data, "DL0.011", true).kind).toBe("pal8rle");
  });

  it("decodes a PBM under a .PBM extension", () => {
    expect(decodeSceneImage(pbm(1, 1, [2]), "A.PBM").kind).toBe("pal8rle");
  });

  it("decodes a 16-bit image under a numeric extension as raw RGB565", () => {
    const img = decodeSceneImage(bm16(2, 1, [0x1234, 0xabcd]), "KEY2.011");
    expect(img.kind).toBe("rgb565");
    expect([...img.pixels]).toEqual([0x1234, 0xabcd]);
  });

  it("decodes an 8-bit palette image (size 4 + 256 + w*h) as BM", () => {
    const data = new Uint8Array(4 + 256 + 2);
    data[0] = 2;
    data[2] = 1;
    expect(decodeSceneImage(data, "X.012").kind).toBe("pal8");
  });

  it("falls back to PBM for data shorter than a header", () => {
    expect(() => decodeSceneImage(new Uint8Array([1, 0]), "X.011")).toThrow();
  });
});
