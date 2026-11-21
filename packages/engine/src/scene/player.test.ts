// Scene logic without DOM: stay facings, click hits and window clips on invented state.
import { describe, expect, it } from "vitest";
import { Renderer, createSurface } from "../render";
import { IDLE_AFTER, IDLE_FRAMES_PER_TICK, IDLE_LIMIT, ScenePlayer, spritePixelHit, stayFacing } from "./player";
import { facingForAngle, forcedFacing } from "../walk/walker";
import { jackShadow } from "../anim/jack";

describe("STAY facings (synthetic)", () => {
  it("names map to g_jackDir / g_jackFacing as in (unknown names: D)", () => {
    expect(stayFacing("L")).toEqual({ dir: 1, mirror: 1 });
    expect(stayFacing("R")).toEqual({ dir: 1, mirror: -1 });
    expect(stayFacing("U")).toEqual({ dir: 2, mirror: 1 });
    expect(stayFacing("D")).toEqual({ dir: 0, mirror: 1 });
    expect(stayFacing("LU")).toEqual({ dir: 4, mirror: -1 });
    expect(stayFacing("RU")).toEqual({ dir: 4, mirror: 1 });
    expect(stayFacing("LD")).toEqual({ dir: 3, mirror: 1 });
    expect(stayFacing("RD")).toEqual({ dir: 3, mirror: -1 });
    expect(stayFacing("???")).toEqual({ dir: 0, mirror: 1 });
  });
});

describe("stayJack on a fake player (synthetic: Script_Stay)", () => {
  // only what stayJack touches; standJack is a recorder
  function fake(dir: number, mirror: 1 | -1, opts: { shown?: boolean; moving?: boolean } = {}) {
    const self = {
      walker: { dir, mirror, walking: true },
      jackHidden: opts.shown === false,
      jackShown: opts.shown !== false,
      jackId: 0,
      jack: { mode: "stand", walkFrame: 0, delay: 5 },
      tj: { moving: opts.moving ?? false, turn: null as unknown, uniform: false },
      renderer: { sprite: () => ({ visible: opts.shown !== false }) },
      turnFromScript: false,
      jackFresh: false,
      stood: 0,
      standJack() {
        this.stood++;
        this.walker.walking = false;
      },
    };
    const stay = (name: string): boolean => ScenePlayer.prototype.stayJack.call(self as unknown as ScenePlayer, name);
    return { self, stay };
  }
  const NAMES: [string, number, 1 | -1][] = [
    ["L", 1, 1],
    ["R", 1, -1],
    ["U", 2, 1],
    ["D", 0, 1],
    ["LU", 4, -1],
    ["RU", 4, 1],
    ["LD", 3, 1],
    ["RD", 3, -1],
  ];

  it("every direction code sets g_jackDir / g_jackFacing, also when Jack is not drawn yet (drawn standing)", () => {
    for (const [name, dir, mirror] of NAMES) {
      const f = fake(0, 1, { shown: false });
      expect(f.stay(name)).toBe(false);
      expect([f.self.walker.dir, f.self.walker.mirror]).toEqual([dir, mirror]);
      expect(f.self.stood).toBe(1);
    }
  });

  it("a Jack on screen only from insertions is still g_jackShown = 0: STAY L stands without a turn (SC024 DIALOG_EXIT)", () => {
    // the sprite is visible (insertion JOUT3 ended), but only Jack_Stand / STAY / a restored pose set the flag
    const f = fake(0, 1, { shown: true });
    (f.self as { jackShown: boolean }).jackShown = false;
    expect(f.stay("L")).toBe(false);
    expect(f.self.tj.turn).toBeNull();
    expect(f.self.stood).toBe(1);
    expect([f.self.walker.dir, f.self.walker.mirror]).toEqual([1, 1]);
    expect((f.self as { jackShown: boolean }).jackShown).toBe(true);
    // the next STAY already turns (front -> side)
    const g = fake(0, 1, { shown: true });
    expect(g.stay("L")).toBe(true);
    expect(g.self.tj.turn).not.toBeNull();
  });

  it("SC003 after the ladder: facing inherited equal to `STAY RD`, g_jackShown = 0 → Jack is drawn standing (the WSKOK1 pose does not stay)", () => {
    // an equal facing means no turn; the old test "sprite visible" took the Jack of the insertion for a drawn one and left the arms-out frame
    const f = fake(3, -1, { shown: true });
    (f.self as { jackShown: boolean }).jackShown = false;
    expect(f.stay("RD")).toBe(false);
    expect(f.self.stood).toBe(1);
    // with the flag set and the same facing nothing is redrawn (Script_Stay: no turn, Jack was not moving)
    const g = fake(3, -1, { shown: true });
    expect(g.stay("RD")).toBe(false);
    expect(g.self.stood).toBe(0);
  });

  it("STAY with `*` also sets g_jackShown (sets it on every path)", () => {
    const f = fake(0, 1, { shown: true });
    (f.self as { jackShown: boolean }).jackShown = false;
    f.stay("R*");
    expect((f.self as { jackShown: boolean }).jackShown).toBe(true);
  });

  it("ROTATETO does nothing while g_jackShown = 0 (case 0x76), LOOKTO is not gated", () => {
    const self = { jackShown: false, walker: { x: 100, y: 100 } };
    expect(ScenePlayer.prototype.lookAt.call(self as unknown as ScenePlayer, 50, 100, true)).toBe(false);
  });

  it("STAY after a walk that ended in the same facing: no turn, no wait, Jack is drawn standing (he was moving)", () => {
    for (const [name, dir, mirror] of NAMES) {
      const f = fake(dir, mirror, { moving: true });
      expect(f.stay(name)).toBe(false);
      expect(f.self.tj.turn).toBeNull();
      expect(f.self.stood).toBe(1);
      expect([f.self.walker.dir, f.self.walker.mirror]).toEqual([dir, mirror]);
    }
  });

  it("SC005B after SC011: the walk to (612,385) ends facing 4/-1, `STAY LU` keeps that pose (no turn)", () => {
    const f = fake(4, -1, { moving: true });
    expect(f.stay("LU")).toBe(false);
    expect([f.self.walker.dir, f.self.walker.mirror]).toEqual([4, -1]);
    expect(f.self.tj.turn).toBeNull();
    expect(f.self.stood).toBe(1);
  });

  it("STAY from another facing takes the new facing at once, starts the turn and holds the macro (every pair of codes)", () => {
    for (const [, d0, m0] of NAMES) {
      for (const [name, dir, mirror] of NAMES) {
        if (d0 === dir && m0 === mirror) continue;
        const f = fake(d0, m0);
        const waits = f.stay(name);
        expect([f.self.walker.dir, f.self.walker.mirror]).toEqual([dir, mirror]);
        expect(f.self.walker.walking).toBe(false);
        // some pairs need no frames (a mirrored back view): then nobody waits and nothing is stuck
        expect(waits).toBe(f.self.tj.turn !== null);
        if (waits) {
          expect(f.self.turnFromScript).toBe(true);
          expect(f.self.jack.delay).toBe(0);
        }
      }
    }
  });

  it("`*` only sets the facing: no turn, no drawing, no wait", () => {
    const f = fake(1, 1, { moving: true });
    expect(f.stay("LU*")).toBe(false);
    expect([f.self.walker.dir, f.self.walker.mirror]).toEqual([4, -1]);
    expect(f.self.tj.turn).toBeNull();
    expect(f.self.stood).toBe(0);
  });
});

describe("click on a sprite and on Jack (synthetic)", () => {
  // a 4x2 picture: row 0 = 0 1 0 1, row 1 = 1 1 0 0 (0 = transparent)
  const image = { width: 4, height: 2, pixels: Uint16Array.from([0, 1, 0, 1, 1, 1, 0, 0]) };
  const sprite = (over: Partial<{ x: number; y: number; w: number; h: number; scale: number }> = {}) => ({ x: 10, y: 20, w: 4, h: 2, scale: 1, image, ...over });

  it("the rectangle test is strict on both sides (dx, dy > 0) and the right/bottom edge is outside", () => {
    const sp = sprite({ w: 4, h: 2 });
    expect(spritePixelHit(sp, 10, 21)).toBe(false); // dx = 0
    expect(spritePixelHit(sp, 11, 20)).toBe(false); // dy = 0
    expect(spritePixelHit(sp, 14, 21)).toBe(false); // dx = w
    expect(spritePixelHit(sp, 11, 22)).toBe(false); // dy = h
    expect(spritePixelHit(sp, 11, 21)).toBe(true); // dx = 1, dy = 1 -> row 1, column 1: opaque
    expect(spritePixelHit(sp, 12, 21)).toBe(false); // column 2 of row 1 is transparent
    expect(spritePixelHit(sp, 13, 21)).toBe(false); // column 3 of row 1 is transparent
  });

  it("a point with a fraction is cut like the short g_clickX; without an image nothing is hit", () => {
    expect(spritePixelHit(sprite(), 11.9, 21.9)).toBe(true);
    expect(spritePixelHit({ ...sprite(), image: null }, 11, 21)).toBe(false);
  });

  it("a mirrored sprite (negative scale) is read from the other side; a scaled one at its own resolution", () => {
    expect(spritePixelHit(sprite({ scale: -1 }), 12, 21)).toBe(true); // column 2 -> 4 - 1 - 2 = 1: opaque
    expect(spritePixelHit(sprite({ scale: -1 }), 11, 21)).toBe(false); // column 1 -> 2: transparent
    // twice as wide and high: dx 2..3 is still picture column 1; dy 2..3 is row 1
    const big = sprite({ w: 8, h: 4 });
    expect(spritePixelHit(big, 12, 22)).toBe(true);
    expect(spritePixelHit(big, 13, 23)).toBe(true);
    expect(spritePixelHit(big, 14, 23)).toBe(false); // picture column 2
  });

  /** A ScenePlayer without a scene: only the renderer lookups the click test needs. */
  function stub(sprites: Record<number, ReturnType<typeof sprite> & { visible: boolean }>, order: number[]): ScenePlayer {
    const p = Object.create(ScenePlayer.prototype) as unknown as Record<string, unknown>;
    p.jackId = 7;
    p.objects = [{ id: 3, name: "BOX", flx: false }];
    p.objectByName = new Map();
    p.persons = { persons: [] };
    p.personIds = [];
    p.renderer = { sprite: (id: number) => sprites[id], sprites: { indexOf: (id: number) => order.indexOf(id) } };
    return p as unknown as ScenePlayer;
  }

  it("jackHit: opaque pixel / transparent pixel / hidden Jack", () => {
    const p = stub({ 7: { ...sprite(), visible: true } }, [7]);
    expect(p.jackHit(11, 21)).toBe(true);
    expect(p.jackHit(12, 21)).toBe(false);
    const hidden = stub({ 7: { ...sprite(), visible: false } }, [7]);
    expect(hidden.jackHit(11, 21)).toBe(false);
    expect(stub({}, []).jackHit(11, 21)).toBe(false); // no sprite
  });

  it("spriteCandidates lists Jack as \"JACK\" in the drawing order, with the pixel test of his own sprite", () => {
    const p = stub({ 3: { ...sprite(), visible: true }, 7: { ...sprite({ x: 100 }), visible: true } }, [3, 7]);
    expect(p.spriteCandidates(11, 21)).toEqual([
      { name: "BOX", pixelHit: true, flagged: false },
      { name: "JACK", pixelHit: false, flagged: false },
    ]);
    // Jack drawn under the object: the order is the renderer's
    const under = stub({ 3: { ...sprite(), visible: true }, 7: { ...sprite(), visible: true } }, [7, 3]);
    expect(under.spriteCandidates(11, 21).map((c) => c.name)).toEqual(["JACK", "BOX"]);
  });
});

describe("RELATIVEMULP JACK on a fake player (synthetic)", () => {
  // Jack_DrawShadow multiplies Jack's scale by g_jackShadowScale in every case: the command drives the animator's shadowScale
  it("sets the scale factor of Jack's shadow, the round one shrinks with it (0.7 alone, then the 0.99 cap)", () => {
    const self = Object.create(ScenePlayer.prototype) as ScenePlayer;
    Object.assign(self, { jack: { shadowScale: 1 }, persons: { persons: [] } });
    expect(self.setPersonLightScale(null, 0.4)).toBe(true);
    expect(self.jack.shadowScale).toBe(Math.fround(0.4));
    expect(self.jackShadowScale).toBe(Math.fround(0.4));
    const req = { index: 0, dir: 0, facing: 1, x: 332, y: 276, walkFrame: null, directional: false, twoShadows: false, scale: 0.627 } as const;
    const big = jackShadow({ ...req, shadowScale: 1 });
    const small = jackShadow({ ...req, shadowScale: self.jack.shadowScale });
    expect(big.round && small.round).toBe(true);
    expect(small.scale).toBe(Math.fround(Math.fround(Math.fround(0.627 * Math.fround(0.4))) * 0.7));
    expect(small.scale / big.scale).toBeCloseTo(0.4, 5);
    expect(jackShadow({ ...req, shadowScale: 3 }).scale).toBe(Math.fround(0.99)); // factors above 1 (SC094: 1.3) are capped at 0.99
  });
});

describe("Jack's idle reaction on a fake player (synthetic: Game_Run)", () => {
  // what idleCheck touches; stayJack / startGlobalInsertion are recorders
  function fake(dir: number, mirror: 1 | -1, uniform = false) {
    const calls: string[] = [];
    const self = Object.create(ScenePlayer.prototype) as ScenePlayer;
    Object.assign(self, {
      walker: { dir, mirror, walking: false },
      tj: { moving: false, turn: null, uniform },
      idleFrames: 0,
      idleIns: false,
      stayJack(name: string, macro = true) {
        calls.push(`stay ${name} ${macro}`);
        return false;
      },
      startGlobalInsertion(name: string, facing: number, scaleMul: number) {
        calls.push(`ins ${name} ${facing} ${scaleMul}`);
        return true;
      },
    });
    let rands = 0;
    let guns = 0;
    const check = (rand = 1, gun = 1, noControl = false) =>
      self.idleCheck(noControl, () => (rands++, rand), () => (guns++, gun));
    const idle = (ticks: number) => {
      for (let i = 0; i < ticks; i++) self.idleCount();
    };
    return { self, calls, check, idle, counts: () => ({ rands, guns }) };
  }

  it("1500 frames are 15 s of logic ticks: nothing at 1500, the reaction at the first frame above", () => {
    expect(IDLE_FRAMES_PER_TICK * 1000 * 15).toBe(IDLE_LIMIT * 15); // 1.5 frames per 15 ms = 100 frames/s
    const f = fake(1, 1);
    f.idle(1000);
    expect(f.self.idleFrames).toBe(IDLE_LIMIT);
    expect(f.check()).toBeNull();
    expect(f.calls).toEqual([]);
    f.idle(1);
    expect(f.check()).toEqual({ section: "KLPRO", facing: 1, scaleMul: 1 });
    expect(f.calls).toEqual(["ins KLPRO 1 1"]);
    expect(f.self.idleFrames).toBe(IDLE_AFTER);
    expect(f.self.idleIns).toBe(true);
    // the next one 800 frames later (12 s), not at once
    f.idle(533);
    expect(f.check()).toBeNull();
    f.idle(1);
    expect(f.check()?.section).toBe("KLPRO");
  });

  it("a held button, a moved mouse or a locked player zeroes the counter; a quiet frame does not", () => {
    const f = fake(1, -1);
    f.idle(1001);
    f.self.idleInput(false);
    expect(f.self.idleFrames).toBe(1501.5);
    f.self.idleInput(true);
    expect(f.self.idleFrames).toBe(0);
    expect(f.check()).toBeNull();
  });

  it("no reaction in a scene without control (the map) or while Jack turns; the counter stays", () => {
    const f = fake(1, 1);
    f.idle(1001);
    expect(f.check(1, 1, true)).toBeNull();
    (f.self.tj as { turn: unknown }).turn = {};
    expect(f.check()).toBeNull();
    expect(f.calls).toEqual([]);
    expect(f.self.idleFrames).toBe(1501.5);
  });

  it("civilian: the insertion by direction; rand() only for dir 0 and 3, GUN only after an even rand at dir 0", () => {
    const cases: [number, 1 | -1, number, number, string][] = [
      [0, -1, 1, 1, `ins KLFR 1 ${Math.fround(0.97)}`],
      [0, -1, 2, 1, `ins KOLT 1 ${Math.fround(0.985)}`],
      [0, -1, 2, 0, `ins KLFR 1 ${Math.fround(0.97)}`],
      [1, -1, 0, 0, "ins KLPRO -1 1"],
      [2, -1, 0, 0, `ins KLTYL 1 ${Math.fround(0.975)}`],
      [3, -1, 1, 0, `ins 34PKL -1 ${Math.fround(0.98)}`],
      [3, 1, 2, 0, `ins MONETA 1 ${Math.fround(0.98)}`],
      [4, -1, 0, 0, "ins 34TKL -1 1"],
    ];
    for (const [dir, mirror, rand, gun, want] of cases) {
      const f = fake(dir, mirror);
      f.idle(1001);
      f.check(rand, gun);
      expect(f.calls, `dir ${dir}`).toEqual([want]);
      expect(f.counts().rands).toBe(dir === 0 || dir === 3 ? 1 : 0);
      expect(f.counts().guns).toBe(dir === 0 && rand % 2 === 0 ? 1 : 0);
      expect(f.self.idleFrames).toBe(IDLE_AFTER);
    }
  });

  it("uniform: STAY LD / RD without a waiting macro and without zeroing; after the turn (dir 3) MOW34 in the next check", () => {
    const f = fake(1, 1, true);
    f.idle(1001);
    expect(f.check()).toEqual({ stay: "LD", facing: 1, scaleMul: 1 });
    expect(f.calls).toEqual(["stay LD false"]);
    expect(f.self.idleFrames).toBe(1501.5);
    expect(f.self.idleIns).toBe(false);
    // Script_Stay set the pose LD (dir 3, facing 1)
    Object.assign(f.self.walker, { dir: 3, mirror: 1 });
    expect(f.check()?.section).toBe("MOW34");
    expect(f.calls[1]).toBe("ins MOW34 1 1");
    expect(f.self.idleFrames).toBe(IDLE_AFTER);
    expect(f.counts().rands).toBe(0);
    const r = fake(1, -1, true);
    r.idle(1001);
    r.check();
    expect(r.calls).toEqual(["stay RD false"]);
  });

  it("uniform facing back (STAY U / walking away: dir 2, facing 1): STAY LD, then the coin toss MOW34; again 800 frames later", () => {
    expect(stayFacing("U")).toEqual({ dir: 2, mirror: 1 });
    const f = fake(2, 1, true);
    f.idle(1001);
    expect(f.check()).toEqual({ stay: "LD", facing: 1, scaleMul: 1 });
    // Script_Stay "LD": dir 3, facing 1
    Object.assign(f.self.walker, stayFacing("LD"));
    expect(f.check()).toEqual({ section: "MOW34", facing: 1, scaleMul: 1 });
    expect(f.self.idleFrames).toBe(IDLE_AFTER);
    f.idle(533);
    expect(f.check()).toBeNull();
    f.idle(1);
    expect(f.check()?.section).toBe("MOW34");
    expect(f.calls).toEqual(["stay LD false", "ins MOW34 1 1", "ins MOW34 1 1"]);
  });

  it("walking never gives dir 2 with facing -1 (Jack_FaceTowards set facing 1 first)", () => {
    for (let deg = 0; deg < 360; deg++) {
      const f = facingForAngle(deg);
      if (f.dir === 2) expect(f.mirror).toBe(1);
    }
    for (const v of [-4, -3, 0, 1, 2, 3, 4, 7]) {
      const f = forcedFacing(v);
      if (f.dir === 2) expect(f.mirror).toBe(1);
    }
  });

  it("uniform dir 2 / facing -1 (no writer of g_jackFacing sets it): nothing plays, but g_jackIdleIns is set and the counter is 700", () => {
    const f = fake(2, -1, true);
    f.idle(1001);
    expect(f.check()).toBeNull();
    expect(f.calls).toEqual([]);
    expect(f.self.idleIns).toBe(true);
    expect(f.self.idleFrames).toBe(IDLE_AFTER);
  });

  it("STAY from the idle check (9999) turns Jack, but no macro waits for the turn", () => {
    const self = {
      walker: { dir: 1, mirror: 1 as 1 | -1, walking: false },
      jackHidden: false,
      jackShown: true,
      jackPlaced: true,
      jack: { mode: "stand", walkFrame: 0, delay: 5 },
      tj: { moving: false, turn: null as unknown, uniform: true },
      turnFromScript: false,
      jackFresh: false,
      standJack() {},
    };
    expect(ScenePlayer.prototype.stayJack.call(self as unknown as ScenePlayer, "LD", false)).toBe(false);
    expect(self.tj.turn).not.toBeNull();
    expect(self.turnFromScript).toBe(false);
    expect([self.walker.dir, self.walker.mirror]).toEqual([3, 1]);
    expect(self.jack.delay).toBe(0);
    expect(self.jackFresh).toBe(true);
  });

  it("an idle insertion draws no shadows and the end of a global insertion clears g_jackIdleIns", () => {
    const seen: boolean[] = [];
    const self = Object.create(ScenePlayer.prototype) as ScenePlayer;
    let ended = false;
    Object.assign(self, {
      walker: { x: 300, y: 300, dir: 1, mirror: 1, scale: 1, walking: false },
      tj: { moving: false, turn: null, uniform: false },
      jackHidden: false,
      events: [],
      insReleaseEarly: false,
      idleIns: true,
      jack: {
        mode: "insertion",
        shadowsOn: true,
        tick(pose: unknown) {
          seen.push(this.shadowsOn);
          return { update: ended ? { sounds: [], insertionEnded: "KLPRO", insertionGlobal: true } : { sounds: [] }, pose };
        },
      },
      apply() {},
    });
    const tick = () => (self as unknown as { jackTick(r: { sounds: unknown[] }): void }).jackTick({ sounds: [] });
    tick();
    expect(seen).toEqual([false]);
    expect(self.jack.shadowsOn).toBe(true); // the option itself is untouched
    expect(self.idleIns).toBe(true);
    ended = true;
    tick();
    expect(self.idleIns).toBe(false);
    ended = false;
    tick();
    expect(seen).toEqual([false, false, true]);
  });
});

describe("CHWINDOW clip (synthetic)", () => {
  const clip = { left: 10, top: 20, right: 300, bottom: 400 };

  function shell(over: Record<string, unknown> = {}) {
    const img = createSurface(2, 2);
    const renderer = new Renderer(createSurface(32, 32));
    const jackId = renderer.add(img, 5);
    const shadowIds = [renderer.add(img, 0), renderer.add(img, 0)];
    const p = Object.assign(Object.create(ScenePlayer.prototype), {
      jackId,
      shadowIds,
      renderer,
      ticks: 1,
      objectByName: new Map(),
      persons: { find: () => -1 },
      personIds: [] as number[],
      personShadowIds: [] as number[],
      ...over,
    });
    return { p, renderer, jackId, shadowIds, img };
  }

  it("JACK clips Jack and both shadows; the rectangle is a copy and survives a move in the list", () => {
    const { p, renderer, jackId, shadowIds, img } = shell();
    const other = renderer.add(img, 3);
    expect(p.setClip("JACK", clip)).toBe(true);
    for (const id of [jackId, ...shadowIds]) expect(renderer.sprite(id)!.clip).toEqual(clip);
    expect(renderer.sprite(jackId)!.clip).not.toBe(clip);
    renderer.placeUnder(jackId, other);
    expect(renderer.sprite(jackId)!.clip).toEqual(clip);
    expect(p.setClip("NOPE", clip)).toBe(false);
  });

  it("a person name clips that person and their shadow, not another sprite", () => {
    const { p, renderer, img } = shell();
    const bob = renderer.add(img, 2);
    const bobShadow = renderer.add(img, 0);
    const other = renderer.add(img, 4);
    p.persons = { find: (n: string) => (n === "BOB" ? 0 : -1) };
    p.personIds = [bob];
    p.personShadowIds = [bobShadow];
    expect(p.setClip("BOB", clip)).toBe(true);
    expect(renderer.sprite(bob)!.clip).toEqual(clip);
    expect(renderer.sprite(bobShadow)!.clip).toEqual(clip);
    expect(renderer.sprite(other)!.clip).not.toEqual(clip);
  });
});
