import { describe, expect, it } from "vitest";
import { PersonShadow } from "../persons/shadow";
import {
  f32,
  idleChoice,
  jackShadow,
  placeFrame,
  ROUND_SHADOW,
  shadowDirIndex,
  shadowFile,
  standHotSpot,
  stepVolumes,
  walkFrameFile,
  walkHotSpotFile,
  type ShadowRequest,
} from "./jack";
import { brightenPbm, jackBrightness, scaleColor } from "./light";

describe("Jack frame names and hot spots", () => {
  it("names walk, standing and shadow frames Game_Main", () => {
    expect(walkFrameFile(0, 0)).toBe("FRON1.PBM");
    expect(walkFrameFile(4, 11)).toBe("SKBA12.PBM");
    expect(walkHotSpotFile(1)).toBe("PROF.SFB");
    expect(shadowFile(3, 3)).toBe("SHSFR04.PBM");
    expect(shadowFile(2, 11)).toBe("SH_BA12.PBM");
    expect(standHotSpot(0, 100)).toEqual([46, 54, 264]);
    expect(standHotSpot(1, 60)).toEqual([23, 37, 262]);
  });

  it("places the hot spot on Jack's position, xLeft when mirrored, rounding only for insertions", () => {
    expect(placeFrame(300, 400, [46, 54, 264], 1, 1, false)).toEqual([254, 136]);
    expect(placeFrame(300, 400, [46, 54, 264], -1, 1, false)).toEqual([246, 136]);
    // 300 - 46 * 0.75 = 265.5 -> 265 truncated, 266 rounded
    expect(placeFrame(300, 400, [46, 54, 264], 1, 0.75, false)).toEqual([265, 202]);
    expect(placeFrame(300, 400, [46, 54, 264], 1, 0.75, true)).toEqual([266, 202]);
  });

  it("maps dir * facing to the 8-way shadow index of", () => {
    const got = [0, 1, 2, 3, 4].flatMap((d) => [1, -1].map((f) => shadowDirIndex(d, f)));
    expect(got).toEqual([0, 0, 2, 6, 4, 0, 1, 7, 5, 3]);
    expect(shadowDirIndex(16, 1)).toBe(0);
  });
});

describe("Jack_DrawShadow placement", () => {
  const base: ShadowRequest = {
    index: 0,
    dir: 0,
    facing: 1,
    x: 300,
    y: 400,
    walkFrame: null,
    directional: true,
    twoShadows: false,
    scale: 1,
    shadowScale: 1,
  };

  it("fadeBase: scale · shadowScale without the 0.7 of the lone round shadow and without the cap", () => {
    const alone = jackShadow({ ...base, directional: false, scale: 0.8, shadowScale: 0.5 });
    expect(alone.round).toBe(true);
    expect(alone.scale).toBe(f32(f32(0.4) * 0.7)); // normal branch: · 0.7
    expect(alone.fadeBase).toBe(f32(0.4)); // fade branches: no 0.7
    const two = jackShadow({ ...base, directional: true, twoShadows: true, scale: 1.2 });
    expect(two.scale).toBe(f32(0.99));
    expect(two.fadeBase).toBe(f32(1.2)); // capped only after the counter · step, inside the shared shape
  });

  it("a fading round shadow shrinks from fadeBase · counter · step, not from the 0.7 size", () => {
    const sh = jackShadow({ ...base, directional: false, scale: 0.8, shadowScale: 0.5 });
    const fade = new PersonShadow(1);
    fade.fadeOut(4);
    const inp = { x: 300, y: 400, lightScale: 1, levelScale: 0.5, maskWidth: 100, maskHeight: 40 };
    const d = fade.draw(true, { ...inp, personScale: sh.fadeBase ?? sh.scale })!;
    const counter = 3; // MINSHADOW n: counter n-1, step 1/n, size uses the counter before it is decremented
    expect(d.scale).toBe(f32(f32(0.4) * counter * f32(1 / 4)));
    expect(d.scale).toBeGreaterThan(f32(f32(sh.scale * counter) * f32(1 / 4)));
  });

  it("standing: directional frame 4 at the still offsets, scale capped at 0.99", () => {
    const s = jackShadow(base);
    expect(s.file).toBe("SH_FR04.PBM");
    expect(s.round).toBe(false);
    expect(s.scale).toBe(f32(0.99));
    expect([s.x, s.y]).toEqual([Math.trunc(300 - 48 * f32(0.99)), Math.trunc(400 - 25 * f32(0.99))]);
    const prof = jackShadow({ ...base, dir: 1, facing: -1, scale: 0.5 });
    expect(prof.file).toBe("SH_PR04.PBM");
    expect(prof.mirrored).toBe(true);
    expect([prof.x, prof.y]).toEqual([270, 392]); // index 6: 60, 15 at 0.5
  });

  it("walking: shadow frame of the walk, walk offsets", () => {
    const s = jackShadow({ ...base, dir: 3, walkFrame: 7, directional: false, scale: 0.5 });
    expect(s.file).toBe("SHSFR08.PBM");
    expect([s.x, s.y]).toEqual([270, 392]); // 3 * 1 -> index 1: [1] = 60, [1] = 15
  });

  it("insertion frames: round CIEN1 at 0.7 alone, full size with two shadows", () => {
    const alone = jackShadow({ ...base, directional: false, scale: 1 });
    expect(alone.file).toBe(ROUND_SHADOW);
    expect(alone.scale).toBe(f32(0.7));
    expect([alone.x, alone.y]).toEqual([Math.trunc(300 - 55 * f32(0.7)), Math.trunc(400 - 14 * f32(0.7))]);
    const two = jackShadow({ ...base, directional: true, twoShadows: true, scale: 0.8 });
    expect(two.file).toBe(ROUND_SHADOW);
    expect(two.scale).toBe(f32(0.8));
  });

  it("shadow scale multiplies, bad directions fall back to SH_FR04", () => {
    expect(jackShadow({ ...base, shadowScale: 0.5, scale: 0.5 }).scale).toBe(f32(0.25));
    expect(jackShadow({ ...base, dir: 7, walkFrame: 2 }).file).toBe("SH_FR04.PBM");
    expect(jackShadow({ ...base, walkFrame: 12 }).file).toBe("SH_FR04.PBM");
    expect(jackShadow({ ...base, dir: 16 }).file).toBe(ROUND_SHADOW);
  });
});

describe("footsteps, idle animations, light", () => {
  it("pans footsteps by x on screen", () => {
    expect(stepVolumes(1, 0, 0)).toEqual([64, 0]);
    expect(stepVolumes(1, 640, 0)).toEqual([0, 64]);
    expect(stepVolumes(0.5, 320, 0)).toEqual([16, 16]);
    expect(stepVolumes(1, 696, 376)).toEqual([Math.trunc((64 * 320) / 1016), Math.trunc((64 * 696) / 1016)]);
  });

  it("chooses the idle insertion by direction", () => {
    expect(idleChoice(0, -1, false, 1, 1)).toEqual({
      section: "KLFR",
      facing: 1,
      scaleMul: f32(0.97),
    });
    expect(idleChoice(0, -1, false, 2, 0)?.section).toBe("KLFR");
    expect(idleChoice(0, -1, false, 2, 1)).toEqual({
      section: "KOLT",
      facing: 1,
      scaleMul: f32(0.985),
    });
    expect(idleChoice(1, -1, false, 0, 0)).toEqual({ section: "KLPRO", facing: -1, scaleMul: 1 });
    expect(idleChoice(2, -1, false, 0, 0)?.facing).toBe(1);
    expect(idleChoice(3, 1, false, 3, 0)?.section).toBe("34PKL");
    expect(idleChoice(3, 1, false, 4, 0)?.section).toBe("MONETA");
    expect(idleChoice(4, -1, false, 0, 0)?.section).toBe("34TKL");
    expect(idleChoice(3, -1, true, 0, 0)?.section).toBe("MOW34");
    expect(idleChoice(1, 1, true, 0, 0)?.stay).toBe("LD");
    expect(idleChoice(1, -1, true, 0, 0)?.stay).toBe("RD");
    expect(idleChoice(2, -1, true, 0, 0)).toBeNull();
  });

  it("brightens near a light, rescales the palette below 1", () => {
    expect(jackBrightness(300, 400, [], 1, 0.6)).toBe(f32(0.6));
    // dx 0, dy (400 - 350) * 3 = 150, range 300: 0.5 + base
    expect(jackBrightness(300, 400, [[300, 350]], 1, 0.6)).toBe(f32(1.1));
    expect(
      jackBrightness(
        300,
        400,
        [
          [0, 0],
          [300, 350],
        ],
        0.5,
        0.25,
      ),
    ).toBe(f32(0.25)); // range 150, not below
    expect(scaleColor(0, 0.5)).toBe(0);
    expect(scaleColor(0xffff, 0.5)).toBe((15 << 11) | (31 << 5) | 15);
    expect(scaleColor(0x0821, 0.1)).toBe(0x0821); // channels never drop to 0
    const pbm = new Uint8Array(4 + 256 + 2);
    new DataView(pbm.buffer).setUint16(4, 0xffff, true);
    const out = brightenPbm(pbm, 0.5);
    expect(new DataView(out.buffer).getUint16(4, true)).toBe(scaleColor(0xffff, 0.5));
    expect(pbm[4]).toBe(0xff); // copy
    expect(brightenPbm(pbm, 1)).toEqual(pbm);
    expect(brightenPbm(new Uint8Array(10), 0.5)).toEqual(new Uint8Array(10));
  });
});

describe("fade of Jack's round shadow over insertion frames (SC032A JZABITY2, SC007 OSCIANE_ZAMACH)", () => {
  const req: ShadowRequest = {
    index: 0,
    dir: 0,
    facing: 1,
    x: 300,
    y: 400,
    walkFrame: null,
    directional: true,
    twoShadows: false,
    scale: 1,
    shadowScale: 1,
  };
  const frameShadow = () => jackShadow({ ...req, directional: false, scale: 0.53, x: 84, y: 415, walkFrame: null });
  it("MINSHADOW 5 draws four shrinking frames with levels 4,3,1,0, then the shadow is off for good", () => {
    const st = new PersonShadow(1);
    st.fadeOut(5);
    const sizes: number[] = [];
    const levels: number[] = [];
    for (let i = 0; i < 6; i++) {
      if (!st.enabled && !st.fadingIn) break; // drawJackShadow: nothing is drawn (and nothing re-enabled) afterwards
      const s = frameShadow();
      const d = st.draw(true, {
        x: s.x + 55 * s.scale,
        y: s.y + 14 * s.scale,
        personScale: s.fadeBase ?? s.scale,
        lightScale: 1,
        levelScale: 1,
        maskWidth: 110,
        maskHeight: 28,
      });
      sizes.push(d!.width);
      levels.push(d!.level);
    }
    expect(levels).toEqual([4, 3, 1, 0]);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    expect(st.enabled).toBe(false);
    expect(st.fadingOut).toBe(false);
  });
  it("the fade size uses the scale without the 0.7 of the lone round shadow", () => {
    const s = frameShadow();
    expect(s.fadeBase).toBe(f32(0.53));
    expect(s.scale).toBe(f32(f32(0.53) * 0.7));
  });
});
