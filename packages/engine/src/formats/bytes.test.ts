import { describe, expect, it } from "vitest";
import { viewOf } from "./bytes";

describe("viewOf", () => {
  it("reads a slice, not the bytes in front of it", () => {
    const raw = new Uint8Array([0xaa, 0xbb, 0x34, 0x12]);
    expect(viewOf(raw.subarray(2)).getUint16(0, true)).toBe(0x1234);
  });
});
