import { describe, expect, it } from "vitest";
import type { InsertionStart } from "../anim/animator";
import type { IcsFrame } from "../formats/global";
import type { Person } from "../formats/scene";
import {
  effectVolumes,
  MAX_PERSONS,
  personBrightness,
  personDef,
  personDirection,
  personSector,
  ScenePerson,
  ScenePersons,
  type PersonEnv,
} from "./persons";

const ENV: PersonEnv = { scrollX: 0, lights: [], brightness: 1, shadows: false };

function pcs(dirs: number[], frames = 4, scale = 1e6): Person {
  return {
    name: "BOB",
    n: 4,
    framesPerDir: frames,
    mode: 0,
    scale,
    flag: 0,
    directions: dirs.map((dir) => ({
      dir,
      frames: Array.from({ length: frames }, (_, i) => [`B${dir}${i}.PBM`, 5, 7, 20]),
    })),
  };
}

function person(dirs: number[], frames = 4): ScenePerson {
  const p = new ScenePerson(personDef(pcs(dirs, frames)), { horizon: 100 });
  p.setPersonData(3, 300, 4, 2); // f = 2.0: scale 1
  return p;
}

describe("direction choice", () => {
  it("maps angle sectors to the 8 directions (right = 6, down = 0, left = 2, up = 4)", () => {
    expect([0, 21, 22, 45, 67, 90, 135, 180, 225, 270, 315, 338, 359].map(personSector)).toEqual([
      6, 6, 7, 7, 7, 0, 1, 2, 3, 4, 5, 5, 6,
    ]);
    expect(personSector(339)).toBe(6);
    // bounds are shared: the first sector that matches wins
    expect(personSector(112)).toBe(0);
    expect(personSector(157)).toBe(1);
  });

  it("uses the wanted direction when present, else the fallback table with mirroring", () => {
    const has = (set: number[]) => (d: number) => set.includes(d);
    expect(personDirection(6, has([6, 2]))).toEqual({ dir: 6, facing: 1 });
    expect(personDirection(6, has([2]))).toEqual({ dir: 2, facing: -1 });
    expect(personDirection(2, has([6]))).toEqual({ dir: 6, facing: -1 });
    expect(personDirection(0, has([7]))).toEqual({ dir: 7, facing: 1 });
    expect(personDirection(1, has([7]))).toEqual({ dir: 7, facing: -1 });
    expect(personDirection(0, has([4]))).toBeNull();
  });

  it("startWalk picks the direction from the angle and sets the velocity", () => {
    const p = person([2]);
    p.setPosition(100, 200);
    p.startWalk(200, 200); // to the right, only a left-facing set exists
    expect(p.dir).toBe(2);
    expect(p.facing).toBe(-1);
    expect(p.vx).toBeCloseTo(4, 5);
    expect(Math.abs(p.vy)).toBeLessThan(1e-4);
    p.startWalk(0, 200);
    expect([p.dir, p.facing]).toEqual([2, 1]);
    expect(p.vx).toBeCloseTo(-4, 5);
    // vertical speed is squashed by 0.3
    p.setPosition(100, 200);
    p.startWalk(100, 300);
    expect(p.vy).toBeCloseTo(4 * Math.fround(0.3), 5);
  });

  it("WALKTODIR forces the wanted direction", () => {
    const p = person([2, 6]);
    p.setPosition(100, 200);
    p.startWalk(200, 200, 2);
    expect([p.dir, p.facing]).toEqual([2, 1]);
  });

  it("keeps the previous direction when no frames fit", () => {
    const p = person([4]);
    p.setPosition(0, 0);
    p.startWalk(10, 0, 0);
    expect([p.dir, p.facing]).toEqual([0, 1]);
  });
});

describe("scale", () => {
  it("SETPERSONDATA f: 3.0 fixed, 2.0 none, else perspective", () => {
    const p = new ScenePerson(personDef(pcs([6])), { horizon: 100 });
    p.setPosition(0, 200);
    p.setPersonData(5, 300, 2, 1);
    expect(p.scale).toBeCloseTo(0.5, 6); // (200-100)*1/(300-100)
    p.setPosition(0, 300);
    expect(p.scale).toBe(1);
    p.setPersonData(5, 300, 2, 3);
    p.setPosition(0, 150);
    expect(p.scale).toBe(1); // fixed: untouched
    p.setPersonData(5, 300, 2, 2);
    p.setPosition(0, 150);
    expect(p.scale).toBe(1);
  });

  it("SETPOSITION clamps to 0.1 but the walk step clamps to 0.01", () => {
    const p = new ScenePerson(personDef(pcs([6])), { horizon: 100 });
    p.setPersonData(1, 300, 1, 1);
    p.setPosition(0, 101);
    expect(p.scale).toBeCloseTo(0.1, 6);
    p.startWalk(50, 101);
    p.counter = 0;
    p.walkStep(ENV);
    expect(p.scale).toBeCloseTo(0.01, 6);
  });
});

describe("walking", () => {
  it("steps every `delay` ticks, draws with hot spots and advances the frame", () => {
    const p = person([6]);
    p.setPosition(100, 200);
    p.startWalk(160, 200);
    const sc = new ScenePersons([personDef(pcs([6]))], { horizon: 100 });
    const q = sc.persons[0];
    q.setPersonData(3, 300, 4, 2);
    q.setPosition(100, 200);
    q.startWalk(160, 200);
    const frames: (string | undefined)[] = [];
    const xs: number[] = [];
    for (let t = 0; t < 9; t++) {
      const u = sc.tick(ENV)[0];
      if (u?.sprite) {
        frames.push(u.sprite.file);
        xs.push(u.sprite.x);
      }
    }
    // first step right away (counter starts at 0), then every 3 ticks
    expect(frames).toEqual(["B60.PBM", "B61.PBM", "B62.PBM"]);
    expect(xs).toEqual([100 + 4 - 5, 100 + 8 - 5, 100 + 12 - 5]);
  });

  it("mirrors with the left hot spot and a negative-facing sprite", () => {
    const p = person([2]);
    p.setPosition(100, 200);
    p.startWalk(200, 200); // right, mirrored
    const u = p.walkStep(ENV);
    expect(u.sprite?.mirrored).toBe(true);
    expect(u.sprite?.x).toBe(Math.trunc(104 - 7));
    expect(u.sprite?.y).toBe(200 - 20);
  });

  it("stops inside the 10 x 5 window, still moves and draws on that step", () => {
    const p = person([6]);
    p.setPosition(100, 200);
    p.startWalk(105, 202);
    const u = p.walkStep(ENV);
    expect(p.moving).toBe(false);
    expect(u.events).toEqual([{ kind: "walkArrived" }]);
    expect(u.sprite).toBeDefined();
    expect(p.x).toBeGreaterThan(100);
  });

  it("does not stop at dx = 10 or dy = 5", () => {
    const p = person([6]);
    p.setPosition(100, 200);
    p.startWalk(110, 200);
    expect(p.walkStep(ENV).events).toEqual([]);
    const q = person([6]);
    q.setPosition(100, 200);
    q.startWalk(100, 205);
    expect(q.walkStep(ENV).events).toEqual([]);
  });

  it("SHOWFRAME draws one frame without moving; reverse runs backwards; frames wrap", () => {
    const p = person([6], 3);
    p.dir = 6;
    p.setPosition(100, 200);
    p.show(2);
    const u = p.walkStep(ENV);
    expect(u.sprite?.file).toBe("B62.PBM");
    expect(p.x).toBe(100);
    expect(p.frame).toBe(0);
    expect(p.showFrame).toBe(false);
    p.reverse = true;
    p.show(0);
    p.walkStep(ENV);
    expect(p.frame).toBe(2);
  });

  it("walk effects play on the drawn frame, panned by x and scroll", () => {
    const p = person([6]);
    p.setPosition(320, 200);
    p.setWalkEffect(0, 3, 40);
    p.startWalk(400, 200);
    const u = p.walkStep({ ...ENV, scrollX: 0 });
    expect(u.sounds).toHaveLength(1);
    expect(u.sounds[0]).toMatchObject({ sound: 3, channels: [1, 2], kind: "walk" });
    // x = 324 after the step
    expect(u.sounds[0].volumes).toEqual(effectVolumes(40, 1, 324, 0));
    p.setWalkEffect(0, 0, 40); // slot 0 is a sound (KROK1.SND in SC001), not "off"
    expect(p.effects[0].sound).toBe(0);
    p.setWalkEffect(0, -1, 40);
    expect(p.effects[0].sound).toBe(-1);
  });

  it("emits a shadow request with the SETSHADOW offset and a growing phase", () => {
    const p = person([6]);
    p.setPosition(100, 200);
    p.shadowDx = 3;
    p.shadowDy = 4;
    p.startWalk(300, 200);
    const a = p.walkStep({ ...ENV, shadows: true });
    p.counter = 0;
    const b = p.walkStep({ ...ENV, shadows: true });
    expect(a.shadow).toMatchObject({ x: 104 + 3, y: 200 + 4, phase: 0 });
    expect(b.shadow?.phase).toBe(1);
  });

  it("a person without frames in the chosen direction draws nothing", () => {
    const p = person([6]);
    p.setPosition(0, 0);
    p.startWalk(-50, 0, 4);
    p.dir = 4;
    expect(p.walkStep(ENV).sprite).toBeUndefined();
  });

  it("walkDue: moving and timer, or SHOWFRAME; not during an insertion", () => {
    const p = person([6]);
    expect(p.walkDue).toBe(false);
    p.moving = true;
    expect(p.walkDue).toBe(true);
    p.counter = 2;
    expect(p.walkDue).toBe(false);
    p.countdown();
    p.countdown();
    p.countdown();
    expect(p.counter).toBe(0);
    expect(p.walkDue).toBe(true);
  });
});

function icsFrame(file: string, extra: Partial<IcsFrame> = {}): IcsFrame {
  return {
    file,
    xRight: 10,
    xLeft: 30,
    y: 50,
    shadow1: [1000, 0],
    shadow2: [1000, 0],
    effect: null,
    ...extra,
  };
}

function ins(frames: IcsFrame[], start = 0, count = frames.length): InsertionStart {
  return { frames, start, count, facing: 1, global: false, name: "ANIM" };
}

describe("insertion start: INITFIRST vs RUNINSERTION (Script_ExecStep case 2 / case 7)", () => {
  const scaled = () => {
    const p = new ScenePerson(personDef(pcs([6])), { horizon: 250 });
    p.setPosition(440, 345);
    p.setPersonData(5, 300, 12, 0.374); // SC116 [INIT]: unclamped (345-250)*0.374/50
    return p;
  };

  it("RUNINSERTION keeps the scale after MOVEP (SC116 [MAJOR]: OBROT_MAJOR, MOVEP 35 17, OBROT_MAJOR1)", () => {
    const p = scaled();
    const s = p.scale;
    expect(s).toBeCloseTo(0.7106, 4);
    p.startInsertion(ins([icsFrame("A.PBM")]), 0);
    expect(p.scale).toBe(s);
    p.movePosition(35, 17);
    p.startInsertion(ins([icsFrame("B.PBM")]), 0);
    expect(p.scale).toBe(s);
    expect(p.insertionStep(ENV).sprite?.scale).toBe(s);
  });

  it("INITFIRST recomputes the scale from y, clamped to 0.1..1, also with f = 3; 1.0 with f = 2", () => {
    const p = scaled();
    p.movePosition(35, 17);
    p.startInsertion(ins([icsFrame("A.PBM")]), 0, true);
    expect(p.scale).toBeCloseTo(((362 - 250) * 0.374) / 50, 5);
    const big = scaled();
    big.setPersonData(5, 300, 12, 0.9); // (345-250)*0.9/50 = 1.71, not clamped by SETPERSONDATA
    expect(big.scale).toBeGreaterThan(1);
    big.startInsertion(ins([icsFrame("A.PBM")]), 0);
    expect(big.scale).toBeGreaterThan(1); // RUNINSERTION leaves it
    big.startInsertion(ins([icsFrame("A.PBM")]), 0, true);
    expect(big.scale).toBe(1);
    const fixed = scaled();
    fixed.setPersonData(5, 300, 12, 3); // f = 3: walking keeps the scale, INITFIRST does not look at the flag
    fixed.movePosition(0, 17);
    fixed.startInsertion(ins([icsFrame("A.PBM")]), 0, true);
    expect(fixed.scale).toBeCloseTo(((362 - 250) * 0.374) / 50, 5);
    const none = scaled();
    none.setPersonData(5, 0, 12, 2);
    none.startInsertion(ins([icsFrame("A.PBM")]), 0);
    expect(none.scale).toBeCloseTo(0.7106, 4);
    none.startInsertion(ins([icsFrame("A.PBM")]), 0, true);
    expect(none.scale).toBe(1);
  });

  it("only INITFIRST zeroes the step timer; RUNINSERTION waits for the one left by the last step", () => {
    const p = scaled();
    p.counter = 4;
    p.startInsertion(ins([icsFrame("A.PBM")]), 0);
    expect(p.insertionDue).toBe(false);
    for (let i = 0; i < 4; i++) p.countdown();
    expect(p.insertionDue).toBe(true);
    p.counter = 4;
    p.startInsertion(ins([icsFrame("A.PBM")]), 0, true);
    expect(p.insertionDue).toBe(true);
  });
});

describe("insertions", () => {
  it("plays the section frame by frame, then ends one step after the last frame", () => {
    const p = person([6]);
    p.setPosition(100, 200);
    p.startInsertion(ins([icsFrame("A.PBM"), icsFrame("B.PBM")]), 0);
    expect(p.insertionDue).toBe(true);
    const a = p.insertionStep(ENV);
    expect(a.sprite).toMatchObject({
      file: "A.PBM",
      x: 90,
      y: 150,
      mirrored: false,
      source: "scene",
    });
    expect(p.counter).toBe(3);
    expect(p.insertionDue).toBe(false);
    p.counter = 0;
    expect(p.insertionStep(ENV).sprite?.file).toBe("B.PBM");
    p.counter = 0;
    const end = p.insertionStep(ENV);
    expect(end.sprite).toBeUndefined();
    expect(end.events).toEqual([{ kind: "insertionEnded", name: "ANIM" }]);
    expect(p.inserting).toBe(false);
  });

  it("direction 1 uses xLeft and mirrors; 2 follows the person's mirror", () => {
    const p = person([2]);
    p.setPosition(100, 200);
    p.startWalk(200, 200); // facing -1
    p.startInsertion(ins([icsFrame("A.PBM")]), 2);
    const u = p.insertionStep(ENV);
    expect(u.sprite).toMatchObject({ x: 70, mirrored: true });
    p.clearInsertion();
    p.startInsertion(ins([icsFrame("A.PBM")]), 1);
    expect(p.insFacing).toBe(-1);
  });

  it("uses the start offset into a shared frame table and rejects ranges outside it", () => {
    const p = person([6]);
    p.setPosition(0, 200);
    p.startInsertion(ins([icsFrame("X.PBM"), icsFrame("Y.PBM"), icsFrame("Z.PBM")], 1, 1), 0);
    expect(p.insertionStep(ENV).sprite?.file).toBe("Y.PBM");
    expect(() => p.startInsertion(ins([icsFrame("X.PBM")], 0, 2), 0)).toThrow(/outside/);
    expect(() => p.startInsertion(ins([icsFrame("X.PBM")], -1, 1), 0)).toThrow(/outside/);
  });

  it("frame effects: channel 0 = both channels; the effect of the frame after the end plays too", () => {
    const p = person([6]);
    p.setPosition(0, 200);
    const eff = { sound: "BANG", channel: 0, unused: 0, volume: 50 };
    p.startInsertion(ins([icsFrame("A.PBM", { effect: eff })]), 0);
    expect(p.insertionStep(ENV).sounds[0]).toMatchObject({
      sound: "BANG",
      channels: [1, 2],
      volumes: [50, 50],
      kind: "insertion",
    });
    p.counter = 0;
    expect(p.insertionStep(ENV).events).toHaveLength(1);
    const q = person([6]);
    const frames = [icsFrame("A.PBM"), icsFrame("NEXT.PBM", { effect: { ...eff, channel: 2 } })];
    q.startInsertion(ins(frames, 0, 1), 0);
    q.insertionStep(ENV);
    q.counter = 0;
    const end = q.insertionStep(ENV);
    expect(end.sounds[0]).toMatchObject({ channels: [2] });
    expect(end.events).toHaveLength(1);
  });

  it("keeps its own scale after drawing (is only a temporary) and draws shadows from d, e", () => {
    const p = person([6]);
    p.setPosition(100, 200);
    p.startInsertion(ins([icsFrame("A.PBM", { shadow1: [8, 3] })]), 1);
    const before = p.scale;
    const u = p.insertionStep({ ...ENV, shadows: true });
    expect(p.scale).toBe(before);
    expect(u.shadow).toMatchObject({ x: 92, y: 203, phase: 0 });
  });

  it("a scale-less (f = 2) INITFIRST draws its shadow with 1.0 (SC083 gangster); RUNINSERTION keeps the earlier scale", () => {
    const sc = new ScenePersons([personDef(pcs([6]))], { horizon: 100 });
    const p = sc.persons[0];
    p.setPersonData(3, 300, 4, 0.5);
    p.setPosition(100, 200); // 0.25
    p.setPersonData(3, 300, 4, 2);
    p.startInsertion(ins([icsFrame("A.PBM", { shadow1: [0, 0] })]), 0, true);
    const u = p.insertionStep({ ...ENV, shadows: true });
    expect(p.scale).toBe(1);
    expect(u.shadow?.scale).toBe(1);
    const q = sc.persons[0];
    q.setPersonData(3, 300, 4, 0.5);
    q.setPosition(100, 200);
    q.setPersonData(3, 300, 4, 2);
    q.counter = 0;
    q.startInsertion(ins([icsFrame("A.PBM", { shadow1: [8, 3] })]), 0);
    const v = q.insertionStep({ ...ENV, shadows: true });
    expect(v.sprite).toMatchObject({ scale: 1, x: 90, y: 150 }); // drawn with 1.0
    expect(q.scale).toBe(0.25); // restored
    expect(v.shadow).toMatchObject({ x: 108, y: 203, scale: 0.25 }); // offset unscaled, shadow from the own scale
  });

  it("a person that was scale-less from the start keeps the full shadow scale in an insertion (SC001 old lady)", () => {
    const sc = new ScenePersons([personDef(pcs([6]))], { horizon: 100 });
    const p = sc.persons[0];
    p.setPersonData(3, 300, 4, 2);
    p.setPosition(100, 200);
    p.startInsertion(ins([icsFrame("A.PBM", { shadow1: [0, 0] })]), 0);
    expect(p.insertionStep({ ...ENV, shadows: true }).shadow?.scale).toBe(1);
  });

  it("SHOWFRAME during an insertion draws and reloads the timer, delaying the insertion", () => {
    const sc = new ScenePersons([personDef(pcs([6]))], { horizon: 100 });
    const p = sc.persons[0];
    p.dir = 6;
    p.setPersonData(3, 300, 4, 2);
    p.setPosition(100, 200);
    p.show(0);
    p.startInsertion(ins([icsFrame("A.PBM")]), 0);
    const u = sc.tick(ENV)[0]!;
    expect(u.sprite?.file).toBe("B60.PBM");
    expect(p.inserting).toBe(true);
    expect(p.counter).toBe(3);
  });
});

describe("ScenePersons", () => {
  it("finds persons by name and limits the count", () => {
    const sc = new ScenePersons([personDef({ ...pcs([6]), name: "ONE" }), personDef({ ...pcs([6]), name: "TWO" })], {
      horizon: 0,
    });
    expect(sc.find("TWO")).toBe(1);
    expect(sc.find("JACK")).toBe(-1);
    expect(sc.get("ONE")?.def.name).toBe("ONE");
    expect(
      () =>
        new ScenePersons(
          Array.from({ length: MAX_PERSONS + 1 }, () => personDef(pcs([6]))),
          { horizon: 0 },
        ),
    ).toThrow(/room/);
  });

  it("a name used twice finds the first person, like Script_FindPerson (SC083: two GANGSTER sections)", () => {
    const big = personDef({ ...pcs([2], 4, 500000), name: "GANG" });
    const small = personDef({ ...pcs([7], 4, 300000), name: "GANG" });
    const sc = new ScenePersons([big, small, personDef({ ...pcs([6]), name: "OTHER" })], {
      horizon: 0,
    });
    expect(sc.find("GANG")).toBe(0);
    expect(sc.get("GANG")?.def.lightScale).toBe(Math.fround(0.5));
    expect(sc.get("GANG")?.hasDir(2)).toBe(true);
    expect(sc.find("OTHER")).toBe(2);
    expect(sc.persons).toHaveLength(3); // the second one still exists (it has its sprites), only no name reaches it
  });

  it("personDef keeps light scale, mask mode and ignores directions beyond 7", () => {
    const d = personDef({ ...pcs([6, 9]), scale: 600000, mode: 2100, flag: 1 });
    expect(d.lightScale).toBeCloseTo(0.6, 6);
    expect(d.mode).toBe(2100);
    expect(d.prescale).toBe(true);
    expect(d.dirs[6]).toHaveLength(4);
    expect(d.dirs.filter((x) => x).length).toBe(1);
  });
});

describe("light", () => {
  it("is the base outside the range and brighter near a light, range scaled by the PCS scale", () => {
    expect(personBrightness(0, 0, [], 1, 1, 0.5)).toBe(0.5);
    expect(personBrightness(100, 100, [[100, 100]], 1, 1, 0.5)).toBe(1.5);
    // 150 away horizontally, range 300 * 0.5 = 150: not inside
    expect(personBrightness(250, 100, [[100, 100]], 1, 0.5, 0.5)).toBe(0.5);
    expect(personBrightness(200, 100, [[100, 100]], 1, 0.5, 0.5)).toBeCloseTo(0.5 + 50 / 150, 6);
    // vertical distance counts three times
    expect(personBrightness(100, 140, [[100, 100]], 1, 1, 0)).toBeCloseTo((300 - 120) / 300, 6);
  });
});
