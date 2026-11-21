import { describe, expect, it } from "vitest";
import { Flx } from "../formats/media";
import { FlxAnimation } from "./flx";
import { buildFlx, deltaChunk, emptyChunk, paletteChunk, rectChunk } from "./synthetic";

const RED = 0xf800;
const GREEN = 0x07e0;

describe("FlxAnimation (ANIMA modes 5/6)", () => {
  // 4x3 frame buffer, palette 1 = red, 2 = green
  const pal = paletteChunk([0, RED, GREEN]);

  it("mode != 2 cuts the rectangle out of the full-size buffer", () => {
    const flx = new Flx(
      buildFlx(4, 3, 0, [
        [
          pal,
          rectChunk(1, 1, 2, 2),
          deltaChunk(0, [
            [5, [1, 2]],
            [2, [2, 1]],
          ]),
        ],
        [rectChunk(0, 0, 4, 3), emptyChunk()],
      ]),
    );
    const anim = new FlxAnimation(flx, false);
    const a = anim.step();
    expect(a.index).toBe(0);
    expect(a.finished).toBe(false);
    // buffer: row0 0000 / row1 0120 / row2 0210... pixels 5,6 = 1,2 ; 9,10 = 2,1
    expect(a.sprite).toMatchObject({ x: 1, y: 1, width: 2, height: 2 });
    expect([...a.sprite!.pixels]).toEqual([RED, GREEN, GREEN, RED]);
    const b = anim.step();
    expect(b.index).toBe(1);
    expect(b.sprite).toBeNull(); // empty chunk: the sprite is left as it was
    expect(b.rect).toEqual([0, 0, 4, 3]);
    expect(b.finished).toBe(true);
    expect(anim.isFinished).toBe(true);
    expect(() => anim.step()).toThrow(/finished/);
  });

  it("mode 2 cuts (0, 0, w, h): the frame is stored cropped in the top left corner", () => {
    const flx = new Flx(buildFlx(4, 3, 2, [[pal, rectChunk(7, 9, 2, 1), deltaChunk(0, [[0, [1, 2]]])]]));
    const a = new FlxAnimation(flx, false).step();
    expect(a.sprite).toMatchObject({ x: 7, y: 9, width: 2, height: 1 });
    expect([...a.sprite!.pixels]).toEqual([RED, GREEN]);
    expect(a.finished).toBe(true);
  });

  it("deltas accumulate in the buffer, untouched pixels stay transparent (0)", () => {
    const flx = new Flx(
      buildFlx(2, 2, 0, [[pal, rectChunk(0, 0, 2, 2), deltaChunk(0, [[0, [1]]])], [deltaChunk(3, [[0, [2]]])]]),
    );
    const anim = new FlxAnimation(flx, false);
    expect([...anim.step().sprite!.pixels]).toEqual([RED, 0, 0, 0]);
    expect([...anim.step().sprite!.pixels]).toEqual([RED, 0, 0, GREEN]);
  });

  it("an empty rectangle gives no sprite (31_SAM3 frame 0 style)", () => {
    const flx = new Flx(buildFlx(2, 2, 0, [[pal, rectChunk(1, 1, -2, -1), deltaChunk(0, [[0, [1]]])]]));
    expect(new FlxAnimation(flx, false).step().sprite).toBeNull();
  });

  it("a rectangle one column too wide reads on into the next row", () => {
    const flx = new Flx(buildFlx(3, 2, 0, [[pal, rectChunk(1, 0, 3, 1), deltaChunk(0, [[0, [1, 1, 1, 2, 2, 2]]])]]));
    expect([...new FlxAnimation(flx, false).step().sprite!.pixels]).toEqual([RED, RED, GREEN]);
  });

  it("mode 6 wraps: counter back to 0, picture buffer kept, restart with the given FLX", () => {
    const first = new Flx(
      buildFlx(2, 1, 0, [[pal, rectChunk(0, 0, 2, 1), deltaChunk(0, [[0, [1, 1]]])], [emptyChunk()]]),
    );
    const rec0 = new Flx(buildFlx(2, 1, 0, [[pal, rectChunk(0, 0, 2, 1), deltaChunk(0, [[1, [2]]])], [emptyChunk()]]));
    const anim = new FlxAnimation(first, true, rec0);
    expect(anim.step().finished).toBe(false);
    expect(anim.step().finished).toBe(false); // frame 1 of 2, wraps instead of finishing
    expect(anim.counter).toBe(0);
    expect(anim.loops).toBe(1);
    const again = anim.step();
    expect(again.index).toBe(0);
    // record 0 of the object is what restarts, and the old pixel 0 (red) is still in the buffer
    expect([...again.sprite!.pixels]).toEqual([RED, GREEN]);
    expect(anim.isFinished).toBe(false);
  });
});
