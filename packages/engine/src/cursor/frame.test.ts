import { describe, expect, it } from "vitest";
import { frameOverlay, frameVisible, type FrameEnv } from "./frame";

const env = (o: Partial<FrameEnv> = {}): FrameEnv => ({ idle: false, mode: 5, barOpen: false, menuOpen: false, captionShown: false, bulletOpen: false, ...o });
const IMG = { width: 48, height: 41, pixels: new Uint16Array(48 * 41) };

describe("RAMKA frame", () => {
  it("is visible only for the item cursor over a target with nothing open", () => {
    expect(frameVisible(env())).toBe(true);
    expect(frameVisible(env({ idle: true }))).toBe(false);
    for (const mode of [0, 1, 2, 3, 4]) expect(frameVisible(env({ mode }))).toBe(false);
    expect(frameVisible(env({ barOpen: true }))).toBe(false);
    expect(frameVisible(env({ menuOpen: true }))).toBe(false);
    expect(frameVisible(env({ captionShown: true }))).toBe(false);
    expect(frameVisible(env({ bulletOpen: true }))).toBe(false);
  });
  it("sits at the mouse minus (0x18, 0x14); no image, no frame", () => {
    expect(frameOverlay(IMG, env(), 200, 150)).toEqual({ x: 200 - 24, y: 150 - 20, image: IMG });
    expect(frameOverlay(null, env(), 200, 150)).toBeNull();
    expect(frameOverlay(IMG, env({ idle: true }), 200, 150)).toBeNull();
  });
});
