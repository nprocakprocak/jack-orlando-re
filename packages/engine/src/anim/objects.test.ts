import { describe, expect, it } from "vitest";
import type { ObjectAnim } from "../formats/scene";
import { LOADED_MODE, ObjectAnimation, sceneAnimations, type ObjectTick } from "./objects";

const ANIM: ObjectAnim = {
  object: 3,
  name: "KA1.BM",
  count: 1,
  recs: [
    [1, 2, 3, 2],
    [3, -2, 1],
  ],
  images: [
    ["KA2.PBM", 1, -2],
    ["KA3.PBM", 0, 4],
  ],
};

function run(a: ObjectAnimation, n: number): ObjectTick[] {
  return Array.from({ length: n }, () => a.tick());
}
const shown = (t: ObjectTick[]) => t.filter((x) => x.frame).map((x) => x.frame!.index);

describe("ObjectAnimation (.ACI)", () => {
  it("is idle after loading and resolves images (0 = the CCG image)", () => {
    const a = new ObjectAnimation(ANIM);
    expect(a.mode).toBe(LOADED_MODE);
    expect(a.imageCount).toBe(3);
    expect(run(a, 5).every((t) => !t.frame)).toBe(true);
    expect(a.image(0)).toEqual({ index: 0, file: null, dx: 0, dy: 0 });
    expect(a.image(2)).toEqual({ index: 2, file: "KA3.PBM", dx: 0, dy: 4 });
    expect(a.image(-1).file).toBeNull();
    expect(a.image(9).file).toBeNull();
  });

  it("mode 2 cycles all images every `delay` ticks, mode 1 stops after the last", () => {
    const a = new ObjectAnimation(ANIM);
    a.start({ mode: 2, delay: 2 });
    expect(shown(run(a, 12))).toEqual([0, 1, 2, 0, 1, 2]);
    const b = new ObjectAnimation(ANIM);
    b.start({ mode: 1, delay: 1 });
    const t = run(b, 5);
    expect(shown(t)).toEqual([0, 1, 2]);
    expect(t[2].stopped).toBe("end");
    expect(b.active).toBe(false);
  });

  it("backwards from the last image", () => {
    const a = new ObjectAnimation(ANIM);
    a.start({ mode: 2, delay: 1, backward: true });
    expect(shown(run(a, 4))).toEqual([2, 1, 0, 2]);
    const b = new ObjectAnimation(ANIM);
    b.start({ mode: 1, delay: 1, backward: true });
    expect(run(b, 3)[2].stopped).toBe("end");
  });

  it("mode 4 plays a REC sequence (value - 1 = image) in a loop, mode 3 once", () => {
    const a = new ObjectAnimation(ANIM);
    a.start({ mode: 4, delay: 1, rec: 0 });
    expect(shown(run(a, 6))).toEqual([0, 1, 2, 1, 0, 1]);
    const b = new ObjectAnimation(ANIM);
    b.start({ mode: 3, delay: 1, rec: 0 });
    const t = run(b, 5);
    expect(shown(t)).toEqual([0, 1, 2, 1]);
    expect(t[3].stopped).toBe("end");
    expect(t[3].frame!.changed).toBe(true);
  });

  it("negative REC values are shown as positive and stop the animation when asked", () => {
    const a = new ObjectAnimation(ANIM);
    a.start({ mode: 4, delay: 1, rec: 1 });
    expect(shown(run(a, 4))).toEqual([2, 1, 0, 2]);
    const b = new ObjectAnimation(ANIM);
    b.start({ mode: 4, delay: 1, rec: 1 });
    b.stopAtMarker = true;
    const t = run(b, 3);
    expect(t[0].stopped).toBe("stop");
    expect(shown(t)).toEqual([2]);
    expect(b.index).toBe(1);
  });

  it("stops at a REC position, reports unchanged frames, plays effects at a position", () => {
    const a = new ObjectAnimation(ANIM);
    a.start({ mode: 4, delay: 1, rec: 0 });
    a.stopAt = 2;
    a.effects = [
      { frame: 1, rec: 0, sound: "X.SND", channel: 0, volume: 40 },
      { frame: 1, rec: 1, sound: "Y.SND", channel: 0, volume: 40 },
    ];
    const t = run(a, 3);
    expect(t[1].sounds.map((e) => e.sound)).toEqual(["X.SND"]);
    expect(t[1].stopped).toBe("stop");
    expect(a.active).toBe(false);
    const c = new ObjectAnimation({ ...ANIM, recs: [[2, 2, 3]] });
    c.start({ mode: 4, delay: 1 });
    expect(run(c, 3).map((x) => x.frame!.changed)).toEqual([true, false, true]);
  });

  it("backward REC start, setFrame, stop and errors", () => {
    const a = new ObjectAnimation(ANIM);
    a.start({ mode: 4, delay: 1, rec: 0, backward: true });
    expect(shown(run(a, 5))).toEqual([1, 2, 1, 0, 1]);
    a.setFrame(1, 1);
    expect([a.pos[1], a.index]).toEqual([1, 1]);
    a.stop();
    expect(run(a, 3).every((t) => !t.frame)).toBe(true);
    const m = new ObjectAnimation(ANIM);
    m.start({ mode: 2, delay: 1 });
    m.setFrame(0, 2);
    expect(m.tick().frame!.index).toBe(2);
    expect(() => new ObjectAnimation(ANIM).start({ mode: 3, delay: 1, rec: 5 })).toThrow(RangeError);
    expect([...sceneAnimations([ANIM]).keys()]).toEqual(["KA1.BM"]);
  });
});
