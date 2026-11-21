import { describe, expect, it } from "vitest";
import { AreaState } from "../areas";
import { compileMcc, Interpreter, Variables, type LogEntry } from "../script";
import type { ScenePlayer } from "../scene";
import { walkScrollDirection } from "../scene/scroll";
import { AUTOINC_PERIOD, AutoIncClock, globalFilmTarget, SceneHost, varIndex, skippedWhenRestoring, syncJackVars, type HostEnv, type ItemPort } from "./host";

const bytes = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const VARS = new Map([["LAST", 0], ["A", 0], ["B", 0], ["SLAP", 0], ["SHOOT", 0], ["PX", 0], ["PY", 0], ["R", 9], ["JACKISWOJ", 0]]);

/** The few things of ScenePlayer the host touches in these tests, recording calls. */
function fakeScene() {
  const calls: string[] = [];
  const anim = { active: true, index: 0, delay: 0, stop() { this.active = false; } };
  const shifty = { shadowDx: 0, shadowDy: 0, checkDistance: false };
  const scene = {
    calls,
    shifty,
    scene: { areas: [{ name: "DYWAN", exit: false, triangles: [[0, 0, 300, 0, 0, 300]] }] },
    world: { walk: [], perspective: {}, objects: [{ x: 100, y: 100, quad: [0, 0, 50, 0, 50, 50, 0, 50], center: [25, 25], valid: true }, { x: 300, y: 100, quad: [0, 0, 50, 0, 50, 50, 0, 50], center: [25, 25], valid: false }] },
    walker: { x: 100, y: 200, dir: 1, mirror: 1 },
    tj: { pointRotate: false, pointRotateSaved: false, uniform: false },
    persons: { find: (n: string) => (n === "BOB" ? 0 : n === "ANN" ? 1 : -1), get: (n: string) => (n === "SHIFTY" ? shifty : undefined), persons: [] },
    jack: { uniform: false },
    pose: () => ({ x: 300.7, y: 420.2 }),
    hasWalkArea: true,
    scrollDir: 0,
    brightness: 1,
    marginL: 120,
    marginR: 120,
    bgWide: true,
    faceBeforeWalk() {}, // not what these tests are about
    walkPlan(plan: { path: { x: number; y: number }[]; direct: boolean }, forced: number | null) {
      calls.push(`plan ${plan.path.map((p) => `${p.x},${p.y}`).join(">")} ${plan.direct} ${forced}`);
      return this.walkStarts;
    },
    walkJackTo(x: number, y: number, forced: number | null) {
      calls.push(`walk ${x},${y},${forced}`);
      return true;
    },
    jackInsertion(name: string, dir: number, count?: number) {
      calls.push(`ins ${name} ${dir} ${count ?? "-"}`);
      return name !== "NOPE";
    },
    personInsertion(p: number, name: string, dir: number, count?: number, fresh?: boolean) {
      calls.push(`pins ${p} ${name} ${dir} ${count ?? "-"} ${fresh ? "fresh" : "-"}`);
      return name !== "NOPE";
    },
    startGlobalInsertion(n: string, f: number, m: number) { calls.push(`gins ${n} ${f} ${m}`); return true; },
    showAnimFrame(n: string, i: number) { calls.push(`frame ${n} ${i}`); return n !== "NOPE"; },
    setAnimDarkness(n: string, f: number) { calls.push(`dark ${n} ${f}`); return false; },
    brightenObject(n: string, f: number) { calls.push(`bright ${n} ${f}`); return true; },
    clearAnimBuffer(n: string) { calls.push(`clear ${n}`); return false; },
    moveObjectPoint(n: string, dx: number, dy: number) { calls.push(`movep ${n} ${dx},${dy}`); return true; },
    setPersonLightScale(p: number | null, f: number) { calls.push(`light ${p} ${f}`); return true; },
    insReleaseEarly: false,
    walkStarts: true,
    standJack() { calls.push("stand"); },
    turnWaits: true,
    lookAt(x: number, y: number, wait = true) { calls.push(`look ${x},${y}${wait ? "" : " nowait"}`); return this.turnWaits; },
    stayJack(name: string) { calls.push(`stay ${name}`); return this.turnWaits; },
    placeAgainstObject(p: number | null, o: string, over: boolean) { calls.push(`depth ${p} ${o} ${over}`); },
    setClip(n: string, c: unknown) { calls.push(`clip ${n} ${JSON.stringify(c)}`); return n !== "NOPE"; },
    placeUnderPerson(p: number | null, o: number | null) { calls.push(`under ${p} ${o}`); },
    placeObjectOver(a: string, b: string) { calls.push(`over ${a} ${b}`); },
    setJackPosition(x: number, y: number) { calls.push(`pos ${x},${y}`); },
    setJackTempoFixed(f: boolean) { calls.push(`tempo ${f}`); },
    setScroll(x: number) { calls.push(`scroll ${x}`); },
    objectAnim: (n: string) => (n === "ANI" ? anim : null),
    startObjectAnim(n: string, a: unknown) { calls.push(`anima ${n} ${JSON.stringify(a)}`); return true; },
    setObjectPosition(n: string, x: number, y: number, rel = false) { calls.push(`obj ${n} ${x},${y} ${rel}`); },
    setObjectVisible(n: string, v: boolean) { calls.push(`vis ${n} ${v}`); },
    setShadow(p: number | null, n: number) { calls.push(`shadow ${p} ${n}`); },
    fadeShadowOut(p: number | null, n: number, w: number) { calls.push(`fadeout ${p} ${n} ${w}`); },
    fadeShadowIn(p: number | null, n: number, w: number) { calls.push(`fadein ${p} ${n} ${w}`); },
    setSpecShadow(p: number, o: string) { calls.push(`spec ${p} ${o}`); return o !== "NOPE"; },
    showShadow(p: number, x: number, y: number, f: number) { calls.push(`show ${p} ${x},${y} ${f}`); },
    hideShadow(p: number) { calls.push(`hide ${p}`); },
    setShadowStatus(p: number, on: boolean) { calls.push(`status ${p} ${on}`); },
    shadowBy(o: string, dx: number, dy: number, n: number) { calls.push(`by ${o} ${dx},${dy} ${n}`); return o !== "NOPE"; },
    putShadowOnBackground(x: number, y: number, f: number) { calls.push(`put ${x},${y} ${f}`); },
    showExtraShadow(x: number, y: number, f: number) { calls.push(`extra ${x},${y} ${f}`); },
    setAnimShadow(a: string, p: number | null, sh: number | null, clear: boolean) { calls.push(`animshadow ${a} ${p} ${sh} ${clear}`); return a !== "NOPE"; },
    setShadowOne(o: string) { calls.push(`one ${o}`); return o !== "NOPE"; },
  };
  return { scene, anim };
}

function setup(text: string, talkTicks = 3, items?: ItemPort, autoInc?: AutoIncClock) {
  const { scene, anim } = fakeScene();
  const log: LogEntry[] = [];
  const out = { goto: [] as string[], fade: 0, answers: [] as [number, number][], films: [] as [string, number, number, number, boolean | undefined][] };
  const env: HostEnv = {
    scene: scene as unknown as ScenePlayer,
    areas: new AreaState(),
    gotoScene: (n) => out.goto.push(n),
    requestFade: () => out.fade++,
    clickX: () => 0,
    answer: (id, asked) => {
      out.answers.push([id, asked]);
      return 7;
    },
    log: (e) => log.push(e),
    runFilm: (film, x, y, mode, global) => out.films.push([film, x, y, mode, global]),
    items,
    autoInc,
  };
  const host = new SceneHost(env, talkTicks);
  const it = new Interpreter(compileMcc(bytes(text)), host, VARS);
  host.interpreter = it;
  return { host, it, scene, anim, log, out };
}

/** One game frame + one logic tick. */
function step(s: ReturnType<typeof setup>): void {
  s.it.tick();
  s.it.logicTick();
  s.host.tick();
}

describe("SceneHost: operations that end later", () => {
  it("ROTATETO is a counted operation: pending until the turn ends; LOOKTO is not", () => {
    const pending = (s: ReturnType<typeof setup>) => s.it.macros.find((m) => m.name === "A")!.pending;
    const s = setup("[A] RotateTo 10 20");
    s.it.start("A");
    step(s);
    expect(s.scene.calls).toEqual(["look 10,20"]);
    expect(pending(s)).toBe(1);
    expect(s.it.macros[0].blocked).toBe(true); // whatever the flag: ROTATETO has none
    s.host.finish("jack:turn");
    expect(pending(s)).toBe(0);
    const l = setup("[A] LookTo 10 20");
    l.it.start("A");
    step(l);
    expect(l.scene.calls).toEqual(["look 10,20 nowait"]);
    expect(pending(l)).toBe(0);
  });

  it("ROTATETO is not pending when no turn is running (Jack already faces that way)", () => {
    const s = setup("[A] RotateTo 10 20");
    s.scene.turnWaits = false;
    s.it.start("A");
    step(s);
    expect(s.it.macros.find((m) => m.name === "A")!.pending).toBe(0);
  });

  it("POINTROTATE sets the on-the-spot turn flag of Jack and its value to restore; CHKDISTANCE switches the check on", () => {
    const s = setup("[A] PointRotate 1 ChkDistance SHIFTY 1");
    s.it.start("A");
    step(s);
    step(s);
    step(s);
    expect(s.scene.tj.pointRotate).toBe(true);
    expect(s.scene.tj.pointRotateSaved).toBe(true);
    expect(s.scene.shifty.checkDistance).toBe(true);
  });

  it("WALKTO JACK with '-' holds the macro until the arrival is reported", () => {
    const s = setup("[A] WalkTo JACK 10 20 - Let A 1");
    s.it.start("A");
    step(s);
    expect(s.scene.calls).toEqual(["walk 10,20,null"]);
    for (let i = 0; i < 5; i++) step(s);
    expect(s.it.vars.get("A")).toBe(0);
    s.host.finish("jack:walk");
    step(s);
    expect(s.it.vars.get("A")).toBe(1);
  });

  it("WALKTO with '+' does not wait", () => {
    const s = setup("[A] WalkTo JACK 10 20 + Let A 1");
    s.it.start("A");
    step(s);
    step(s);
    expect(s.it.vars.get("A")).toBe(1);
  });

  it("WALKTODIR JACK walks straight (no path search) with the forced direction", () => {
    const s = setup("[A] WalkToDir JACK 10 20 3 -");
    s.it.start("A");
    step(s);
    expect(s.scene.calls).toEqual(["plan 100,200>10,20 true 3"]);
  });

  it("WALKTODIR JACK always counts: Jack already at the point means the macro hangs (original bug), WALKTO JACK goes on", () => {
    const hang = setup("[A] WalkToDir JACK 10 20 3 - Inc A");
    hang.scene.walkStarts = false;
    hang.it.start("A");
    for (let i = 0; i < 5; i++) step(hang);
    expect(hang.it.macros[0].pending).toBe(1);
    expect(hang.it.macros[0].blocked).toBe(true);
    expect(hang.it.vars.get("A")).toBe(0);
    const go = setup("[A] WalkTo JACK 10 20 - Inc A");
    go.scene.walkStarts = false;
    go.scene.hasWalkArea = false; // direct plan through walkPlan, which reports "not started"
    go.it.start("A");
    for (let i = 0; i < 3; i++) step(go);
    expect(go.it.macros[0].pending).toBe(0);
    expect(go.it.vars.get("A")).toBe(1);
  });

  it("INITFIRST JACK sets the shared flag, does not count and does not wait; it takes no slot", () => {
    const s = setup("[A] InitFirst JACK STAY 0 Inc A");
    s.it.start("A");
    for (let i = 0; i < 3; i++) step(s);
    expect(s.scene.insReleaseEarly).toBe(true);
    expect(s.it.macros[0].pending).toBe(0);
    expect(s.it.vars.get("A")).toBe(1);
    s.host.release("jack:ins"); // nobody is stored: nothing happens
    s.host.finish("jack:ins");
    expect(s.it.macros[0].pending).toBe(0);
  });

  it("the early release frees the macro of the last RUNINSERTION JACK without touching its counter", () => {
    const s = setup("[A] RunInsertion JACK X 1.0 0 - Inc A");
    s.it.start("A");
    step(s);
    const m = s.it.macros[0];
    expect([m.pending, m.blocked]).toEqual([1, true]);
    s.host.release("jack:ins");
    expect([m.pending, m.blocked]).toEqual([1, false]);
    step(s);
    expect(s.it.vars.get("A")).toBe(1);
    s.host.finish("jack:ins"); // the slot stayed: the later end still counts down
    expect(m.pending).toBe(0);
  });

  it("the flag taken by another person's blocking RUNINSERTION: its next blocking insertion never frees the macro", () => {
    // SC093 LANUCIEKA in 's probe: B's INITFIRST flag spent on A's RUNINSERTION (released, pending stays 1)
    const s = setup("[A] RunInsertion BOB X 1.0 0 - RunInsertion BOB Y 1.0 0 - Inc A\n[B] InitFirst ANN Z 0");
    s.it.start("A");
    step(s);
    const a = s.it.macros.find((m) => m.name === "A")!;
    expect([a.pending, a.blocked]).toEqual([1, true]);
    s.it.start("B");
    step(s);
    expect(s.scene.insReleaseEarly).toBe(true);
    s.host.release("person:0:ins"); // BOB draws first: the flag stops BOB's X, not ANN's Z
    step(s);
    expect(s.scene.calls).toContain("pins 0 Y 0 - -");
    expect([a.pending, a.blocked]).toEqual([2, true]);
    s.host.finish("person:0:ins"); // Y ends: pending 2 -> 1, the macro waits for ever
    for (let i = 0; i < 3; i++) step(s);
    expect([a.pending, a.blocked]).toEqual([1, true]);
    expect(s.it.vars.get("A")).toBe(0);
  });

  it("INITFIRST of a person sets the flag, marks it fresh and stores its macro for the release without a counter", () => {
    const s = setup("[A] InitFirst BOB ST 0 Inc A");
    s.it.start("A");
    for (let i = 0; i < 3; i++) step(s);
    expect(s.scene.calls).toContain("pins 0 ST 0 - fresh");
    expect(s.scene.insReleaseEarly).toBe(true);
    expect(s.it.macros[0].pending).toBe(0);
    expect(s.it.vars.get("A")).toBe(1);
    s.host.release("person:0:ins");
    expect(s.it.macros[0].blocked).toBe(false);
  });

  it("STAY waits for its turn like ROTATETO; without a turn it does not; LOOKTO does not set the wait", () => {
    const s = setup("[A] Stay RU Inc A");
    s.it.start("A");
    step(s);
    expect(s.scene.calls).toEqual(["stay RU"]);
    expect(s.it.macros[0].pending).toBe(1);
    expect(s.it.macros[0].blocked).toBe(true);
    s.host.finish("jack:turn");
    expect(s.it.macros[0].pending).toBe(0);
    const n = setup("[A] Stay L");
    n.scene.turnWaits = false;
    n.it.start("A");
    step(n);
    expect(n.it.macros[0].pending).toBe(0);
    const l = setup("[A] LookTo 1 2");
    l.it.start("A");
    step(l);
    expect(l.scene.calls).toEqual(["look 1,2 nowait"]);
  });

  it("a second start overwrites who is told: the first macro stays pending (as in the game)", () => {
    const s = setup("[A] RunInsertion JACK X 1.0 0 - [B] RunInsertion JACK Y 1.0 0 -");
    s.it.start("A");
    step(s);
    s.it.start("B");
    step(s);
    s.host.finish("jack:ins");
    step(s);
    const [a, b] = s.it.macros;
    expect(a.pending).toBe(1);
    expect(b.pending).toBe(0);
    expect(s.host.executed.get("RUNINSERTION")).toBe(2);
  });

  it("an insertion the scene does not have is skipped and logged", () => {
    const s = setup("[A] RunInsertion JACK NOPE 1.0 0 - Let A 1");
    s.it.start("A");
    step(s);
    step(s);
    expect(s.it.vars.get("A")).toBe(1);
    expect(s.log.some((e) => e.kind === "unhandled")).toBe(true);
    expect(s.host.skipped.get("RUNINSERTION")).toBe(1);
  });

  it("ANIMA of an unknown animation is skipped, WAITWHILEANIMA repeats while it runs", () => {
    const s = setup("[A] WaitWhileAnima ANI Let A 1");
    s.it.start("A");
    for (let i = 0; i < 4; i++) step(s);
    expect(s.it.vars.get("A")).toBe(0);
    s.anim.active = false;
    step(s);
    step(s);
    expect(s.it.vars.get("A")).toBe(1);
  });
});

describe("SceneHost: dialogs and talk lines (M3 stand-ins)", () => {
  it("a TALK with '-' waits the configured number of logic ticks", () => {
    const s = setup("[A] Talk JACK 1 0 - Let A 1", 4);
    s.it.start("A");
    step(s);
    for (let i = 0; i < 3; i++) step(s);
    expect(s.it.vars.get("A")).toBe(0);
    for (let i = 0; i < 3; i++) step(s);
    expect(s.it.vars.get("A")).toBe(1);
    expect(s.host.skipped.get("TALK")).toBe(1);
  });

  it("a TALK with '+' goes on at once", () => {
    const s = setup("[A] Talk JACK 1 0 + Let A 1");
    s.it.start("A");
    step(s);
    step(s);
    expect(s.it.vars.get("A")).toBe(1);
  });

  it("DIALOG stores the chosen answer and counts how often it was asked", () => {
    const s = setup("[A] Dialog JACK 5 [B] Dialog JACK 5");
    s.it.start("A");
    step(s);
    s.it.start("B");
    step(s);
    expect(s.out.answers).toEqual([[5, 1], [5, 2]]);
    expect(s.it.answers.get(5)).toBe(7);
  });
});

describe("SceneHost: scene and Jack commands", () => {
  it("GOTOSCENE cuts the extension, REFRESHSCREEN asks for the fade", () => {
    const s = setup("[A] RefreshScreen GoToScene sc008.cfg");
    s.it.start("A");
    step(s);
    step(s);
    expect(s.out.fade).toBe(1);
    expect(s.out.goto).toEqual(["SC008"]);
  });

  it("JACKTEMPO DATA fixes the step delay, FREE gives the option back", () => {
    const s = setup("[A] JackTempo DATA JackTempo FREE");
    s.it.start("A");
    step(s);
    step(s);
    expect(s.scene.calls).toEqual(["tempo true", "tempo false"]);
  });

  it("WALKTO JACK in a scene without a walk area walks straight to the point (case 6, SC005)", () => {
    const s = setup("[A] WalkTo JACK 712.9 405 -");
    s.scene.hasWalkArea = false;
    s.it.start("A");
    step(s);
    expect(s.scene.calls).toEqual(["plan 100,200>712,405 true null"]);
    s.host.finish("jack:walk");
  });

  it("a macro that ends on WALKTO JACK leaves Jack standing", () => {
    const s = setup("[A] WalkTo JACK 10 20 -");
    s.it.start("A");
    step(s);
    s.host.finish("jack:walk");
    step(s);
    step(s);
    expect(s.scene.calls).toContain("stand");
  });

  it("LOCKWALK / UNLOCKWALK toggle the player's walking", () => {
    const s = setup("[A] LockWalk [B] UnlockWalk");
    s.it.start("A");
    step(s);
    expect(s.host.walkAllowed).toBe(false);
    s.it.start("B");
    step(s);
    expect(s.host.walkAllowed).toBe(true);
  });

  it("commands without an implementation are 'unhandled' and counted", () => {
    const s = setup("[A] Effect FOO 0 0 10 Let A 1");
    s.it.start("A");
    step(s);
    step(s);
    expect(s.it.vars.get("A")).toBe(1);
    expect(s.host.skipped.get("EFFECT")).toBe(1);
  });
});

describe("SceneHost: depth and areas", () => {
  it("PUNDERE / POVERE put Jack under / over an object", () => {
    const s = setup("[A] PUnderE JACK OBJ.001 POverE JACK OBJ.002");
    s.it.start("A");
    step(s);
    step(s);
    expect(s.scene.calls).toEqual(["depth null OBJ.001 false", "depth null OBJ.002 true"]);
  });

  it("PINAREA answers whether the person stands inside the area", () => {
    const s = setup("[A] PinArea JACK DYWAN 0 A");
    s.it.start("A");
    step(s);
    expect(s.it.vars.get("A")).toBe(1); // Jack at (100, 200), inside the triangle
    s.scene.walker.x = -50;
    s.it.start("A");
    step(s);
    expect(s.it.vars.get("A")).toBe(0);
  });
});

describe("SceneHost: CHWINDOW, PUNDERP, EOVERE", () => {
  it("CHWINDOW passes the rectangle as left top right bottom; an unknown name does nothing (SC001 CAR1/CAR2)", () => {
    const s = setup("[A] ChWindow JACK 1 2 3 4 ChWindow NOPE 5 6 7 8");
    s.it.start("A");
    step(s);
    step(s);
    expect(s.scene.calls[0]).toBe('clip JACK {"left":1,"top":2,"right":3,"bottom":4}');
    expect(s.host.skipped.get("CHWINDOW")).toBeUndefined(); // an unknown name is "done" without effect
  });

  it("PUNDERP resolves the persons (Jack as the first one), an unknown person is skipped", () => {
    const s = setup("[A] PUnderP BOB ANN PUnderP JACK ANN PUnderP NOBODY ANN PUnderP BOB JACK");
    s.it.start("A");
    for (let i = 0; i < 4; i++) step(s);
    expect(s.scene.calls).toEqual(["under 0 1", "under null 1", "under 0 null"]);
    expect(s.host.skipped.get("PUNDERP")).toBe(1);
  });

  it("EOVERE moves the first object over the second", () => {
    const s = setup("[A] EOverE OBJ.001 OBJ.002");
    s.it.start("A");
    step(s);
    expect(s.scene.calls).toEqual(["over OBJ.001 OBJ.002"]);
  });
});

describe("SceneHost: shadow commands", () => {
  it("SETSHADOW, MINSHADOW and MAXSHADOW pass n, the person (null = Jack) and Jack's shadow number", () => {
    const s = setup("[A] SetShadow JACK 0 SetShadow BOB 5 MinShadow BOB 0 20 MaxShadow JACK 1 4 MinShadow JACK 0 10");
    s.it.start("A");
    for (let i = 0; i < 5; i++) step(s);
    expect(s.scene.calls).toEqual(["shadow null 0", "shadow 0 5", "fadeout 0 20 0", "fadein null 4 1", "fadeout null 10 0"]);
  });

  it("SHIFTSHADOWP sets the person's offset; SETSPECSHADOW, SHOWSHADOW, SHADOWSTATUS and HIDESHADOW reach the scene", () => {
    const s = setup("[A] ShiftShadowP SHIFTY 40 6 SetSpecShadow BOB OBJ ShowShadow BOB 540 357 1.0 ShadowStatus BOB 1 HideShadow BOB ShadowStatus BOB 0");
    s.it.start("A");
    for (let i = 0; i < 6; i++) step(s);
    expect([s.scene.shifty.shadowDx, s.scene.shifty.shadowDy]).toEqual([40, 6]);
    expect(s.scene.calls).toEqual(["spec 0 OBJ", "show 0 540,357 1", "status 0 true", "hide 0", "status 0 false"]);
  });

  it("an unknown person or object is skipped and logged", () => {
    const s = setup("[A] SetShadow NOBODY 1 SetSpecShadow BOB NOPE ShowShadow NOBODY 1 2 1.0 HideShadow NOBODY ShiftShadowP NOBODY 1 2");
    s.it.start("A");
    for (let i = 0; i < 5; i++) step(s);
    expect(s.scene.calls).toEqual(["spec 0 NOPE"]);
    for (const w of ["SETSHADOW", "SETSPECSHADOW", "SHOWSHADOW", "HIDESHADOW", "SHIFTSHADOWP"]) expect(s.host.skipped.get(w)).toBe(1);
  });
});

describe("SceneHost: shadows of objects", () => {
  it("SHOWSHADOW / HIDESHADOW EXTRA draw the extra sprite's shadow (HIDE = off screen, scale 1)", () => {
    const s = setup("[A] ShowShadow EXTRA 100 200 0.5 HideShadow EXTRA");
    s.it.start("A");
    for (let i = 0; i < 3; i++) step(s);
    expect(s.scene.calls).toEqual(["extra 100,200 0.5", "extra 0,500 1"]);
    expect(s.host.skipped.size).toBe(0);
  });

  it("SHADOWBY passes object, offset and strength; an unknown object is skipped", () => {
    const s = setup("[A] ShadowBy OBJ 490 1430 8 ShadowBy NOPE 1 2 3 ShadowBy OBJ -5 0 0");
    s.it.start("A");
    for (let i = 0; i < 4; i++) step(s);
    expect(s.scene.calls).toEqual(["by OBJ 490,1430 8", "by NOPE 1,2 3", "by OBJ -5,0 0"]);
    expect(s.host.skipped.get("SHADOWBY")).toBe(1);
  });

  it("PUTSHADOW passes the point and the scale", () => {
    const s = setup("[A] PutShadow 317 300 0.2 PutShadow -4 0 1");
    s.it.start("A");
    for (let i = 0; i < 3; i++) step(s);
    expect(s.scene.calls).toEqual([`put 317,300 ${Math.fround(0.2)}`, "put -4,0 1"]);
  });

  it("ANIMASHADOW starts (Jack = null, the clear flag n), stops with NULL, and reads SHADn from the name", () => {
    const s = setup("[A] AnimaShadow ANI JACK SHAD1 0 AnimaShadow ANI JACK SHAD0 1 AnimaShadow ANI JACK NULL 0 AnimaShadow NOPE JACK SHAD0 0 AnimaShadow ANI BOB SHAD2 1");
    s.it.start("A");
    for (let i = 0; i < 6; i++) step(s);
    expect(s.scene.calls).toEqual([
      "animshadow ANI null 1 false", "animshadow ANI null 0 true", "animshadow ANI null null false", "animshadow NOPE null 0 false", "animshadow ANI 0 2 true",
    ]);
    expect(s.host.skipped.get("ANIMASHADOW")).toBe(1);
  });

  it("SHADOWONE names the object of the layered composition; an unknown object is skipped", () => {
    const s = setup("[A] ShadowOne LAMP ShadowOne NOPE");
    s.it.start("A");
    for (let i = 0; i < 3; i++) step(s);
    expect(s.scene.calls).toEqual(["one LAMP", "one NOPE"]);
    expect(s.host.skipped.get("SHADOWONE")).toBe(1);
  });
});

describe("SceneHost: state commands", () => {
  it("SETPOSSCROLL sets the left and the right point, unset points stay at -1000", () => {
    const s = setup("[A] SetPosScroll L 10 20 SetPosScroll R 600 30");
    expect(s.host.scrollPoints).toEqual({ L: { x: -1000, y: -1000 }, R: { x: -1000, y: -1000 } });
    s.it.start("A");
    step(s);
    step(s);
    expect(s.host.scrollPoints).toEqual({ L: { x: 10, y: 20 }, R: { x: 600, y: 30 } });
    expect(s.host.skipped.size).toBe(0);
  });

  it("POINTROTATE and SAVEABLE keep their flag", () => {
    const s = setup("[A] PointRotate 1 Saveable 0");
    expect(s.host.pointRotate).toBe(0);
    expect(s.host.saveable).toBe(true);
    s.it.start("A");
    step(s);
    step(s);
    expect(s.host.pointRotate).toBe(1);
    expect(s.host.saveable).toBe(false);
    expect(s.host.skipped.size).toBe(0);
  });

  it("ACTIVEMACROANIMA registers the macro for a record and an image of the animation", () => {
    const s = setup("[A] ActiveMacroAnima B ANI 2 5");
    s.it.start("A");
    step(s);
    expect(s.host.animaMacros).toEqual([{ macro: "B", anim: "ANI", rec: 2, image: 5 }]);
    expect(s.host.skipped.size).toBe(0);
  });
});

describe("walkScrollDirection", () => {
  // margins 120: the view [0, 640) starts to scroll right when Jack and the goal are right of x = 520
  it("scrolls right only when both Jack and the goal are beyond the right margin", () => {
    expect(walkScrollDirection(0, 530, 600, 0, 120, 120)).toBe(1);
    expect(walkScrollDirection(0, 530, 500, 0, 120, 120)).toBe(0);
    expect(walkScrollDirection(0, 500, 600, 0, 120, 120)).toBe(0);
    expect(walkScrollDirection(0, 520, 600, 0, 120, 120)).toBe(0);
  });

  it("scrolls left only when both are left of the left margin", () => {
    expect(walkScrollDirection(0, 100, 50, 0, 120, 120)).toBe(-1);
    expect(walkScrollDirection(0, 100, 130, 0, 120, 120)).toBe(0);
    expect(walkScrollDirection(0, 120, 50, 0, 120, 120)).toBe(0);
  });

  it("keeps the direction in force in between and follows the scroll position", () => {
    expect(walkScrollDirection(1, 300, 300, 0, 120, 120)).toBe(1);
    expect(walkScrollDirection(-1, 300, 300, 0, 120, 120)).toBe(-1);
    expect(walkScrollDirection(0, 600, 700, 100, 120, 120)).toBe(0);
    expect(walkScrollDirection(0, 700, 700, 100, 60, 200)).toBe(1);
  });
});


describe("SceneHost: RUNFILMP and MOVEP", () => {
  it("RUNFILMP hands film, x, y and mode to the game and the macro goes on with the next command", () => {
    const s = setup("[A] RunFilmP KAJDANKI 510 310 2 SetPosition JACK 1 2");
    s.it.start("A");
    step(s);
    expect(s.out.films).toEqual([["KAJDANKI", 510, 310, 2, undefined]]);
    step(s);
    expect(s.scene.calls).toContain("pos 1,2");
    expect(s.host.skipped.has("RUNFILMP")).toBe(false);
  });

  it("RUNFILMP with a negative position and mirrored mode reaches the game unchanged", () => {
    const s = setup("[A] RunFilmP KAJDBACK -100 -100 3");
    s.it.start("A");
    step(s);
    expect(s.out.films).toEqual([["KAJDBACK", -100, -100, 3, undefined]]);
  });

  it("RUNGLOBALFILMP (0x6e) plays a film of GLOBAL.FCM: the numbers reach the game with the global flag, the macro goes on", () => {
    const s = setup("[A] RunGlobalFilmP PODKOWA 200 150 2 SetPosition JACK 1 2");
    s.it.start("A");
    step(s);
    expect(s.out.films).toEqual([["PODKOWA", 200, 150, 2, true]]);
    step(s);
    expect(s.scene.calls).toContain("pos 1,2");
    expect(s.host.skipped.has("RUNGLOBALFILMP")).toBe(false);
  });

  it("RUNGLOBALFILMP -100 -100 means at Jack: x = ftol(g_jackX), y = ftol(g_jackY - 100)", () => {
    const s = setup("[A] RunGlobalFilmP PODKOWA -100 -100 2");
    s.it.start("A");
    step(s);
    expect(s.out.films).toEqual([["PODKOWA", 300, 320, 2, true]]);
  });

  it("globalFilmTarget: only the pair -100 -100 is replaced; the result is a short", () => {
    expect(globalFilmTarget(-100, 5, { x: 1, y: 2 })).toEqual([-100, 5]);
    expect(globalFilmTarget(5, -100, { x: 1, y: 2 })).toEqual([5, -100]);
    expect(globalFilmTarget(-100, -100, { x: 99.99, y: 100.99 })).toEqual([99, 0]);
    expect(globalFilmTarget(-100, -100, { x: -5.5, y: 20 })).toEqual([-5, -80]);
    expect(globalFilmTarget(-100, -100, { x: 70000, y: 100 })).toEqual([4464, 0]);  });

  it("MOVEP JACK only adds to g_jackX / g_jackY (floats): no scale, no walk state, no variables, no stand-still", () => {
    const s = setup("[A] MoveP JACK 10 -5");
    s.it.start("A");
    step(s);
    expect(s.scene.walker).toMatchObject({ x: 110, y: 195 });
    expect(s.scene.calls.filter((c) => c.startsWith("pos") || c === "stand")).toEqual([]);
    s.scene.walker.x = 0.1;
    s.it.start("A");
    step(s);
    expect(s.scene.walker.x).toBe(Math.fround(Math.fround(0.1) + 10));
  });
});

describe("SceneHost: the inventory commands", () => {
  /** A recording ItemPort; `present` is what ITEMPRESENT finds. */
  function withItems(text: string, present: string[] = []) {
    const calls: string[] = [];
    const items: ItemPort = {
      haveTool: (o) => calls.push(`haveTool ${o}`),
      noHaveTool: (n) => calls.push(`noHaveTool ${n}`),
      noHave: () => calls.push("noHave"),
      take: (o) => {
        calls.push(`take ${o}`);
        return o !== "NOIMAGE";
      },
      mouseToTool: () => calls.push("mouseToTool"),
      itemPresent: (n) => present.includes(n),
      moveBigRegion: () => calls.push("moveBigRegion"),
      setGun: (on) => calls.push(`gun ${on}`),
      setUniform: (on) => calls.push(`uniform ${on}`),
    };
    const s = setup(text, 3, items);
    return { ...s, calls };
  }

  it("TAKE, HAVETOOL, NOHAVETOOL, NOHAVE, MOUSETOTOOL and CLEARMENUBAR reach the game, in order, with the object / item name", () => {
    const s = withItems("[A] Take KEY.011 HaveTool MIOT.BM NoHaveTool KEY.011 NoHave MouseToTool ClearMenuBar 1 Let A 1");
    s.it.start("A");
    for (let i = 0; i < 8; i++) step(s);
    expect(s.calls).toEqual(["take KEY.011", "haveTool MIOT.BM", "noHaveTool KEY.011", "noHave", "mouseToTool"]);
    expect(s.it.vars.get("A")).toBe(1); // CLEARMENUBAR is an empty command, not 'unhandled'
    expect(s.log.some((e) => e.kind === "unhandled")).toBe(false);
  });

  it("TAKE of an object without an image is 'unhandled' (the game logs it and goes on)", () => {
    const s = withItems("[A] Take NOIMAGE Let A 1");
    s.it.start("A");
    step(s);
    step(s);
    expect(s.host.skipped.get("TAKE")).toBe(1);
    expect(s.it.vars.get("A")).toBe(1);
  });

  it("ITEMPRESENT puts 1 / 0 into the variable", () => {
    const yes = withItems("[A] ItemPresent MONEY.BM A", ["MONEY.BM"]);
    yes.it.vars.set("A", 5);
    yes.it.start("A");
    step(yes);
    expect(yes.it.vars.get("A")).toBe(1);
    const no = withItems("[A] ItemPresent MONEY.BM A", ["OTHER.BM"]);
    no.it.vars.set("A", 5);
    no.it.start("A");
    step(no);
    expect(no.it.vars.get("A")).toBe(0);
  });

  it("EXTRA 6 / 8 / 11, HAVEGUN and NOHAVEGUN go to the port (the uniform also without a dialog layer)", () => {
    const s = withItems("[A] Extra 6 Extra 8 Extra 11 HaveGun NoHaveGun");
    s.it.start("A");
    for (let i = 0; i < 8; i++) step(s);
    expect(s.calls).toEqual(["uniform true", "uniform false", "moveBigRegion", "gun true", "gun false"]);
    expect(s.scene.tj.uniform).toBe(false);
    expect(s.scene.jack.uniform).toBe(false);
  });

  it("EXTRA 6 / 8 switch Jack's frame set and JACKISWOJ only when the uniform changes (case 0x24 tests g_jackUniform)", () => {
    const s = withItems("[A] Extra 6 Let JACKISWOJ 7 Extra 6 Extra 8 Extra 8");
    s.it.vars.set("JACKISWOJ", 0);
    s.it.start("A");
    step(s);
    expect(s.scene.jack.uniform).toBe(true);
    expect(s.scene.tj.uniform).toBe(true);
    expect(s.it.vars.get("JACKISWOJ")).toBe(1); // Var_Set("JACKISWOJ", 1) in
    for (let i = 0; i < 2; i++) step(s);
    expect(s.it.vars.get("JACKISWOJ")).toBe(7); // the second EXTRA 6 does nothing
    expect(s.scene.jack.uniform).toBe(true);
    for (let i = 0; i < 3; i++) step(s);
    expect(s.scene.jack.uniform).toBe(false);
    expect(s.it.vars.get("JACKISWOJ")).toBe(0); //
    expect(s.calls).toEqual(["uniform true", "uniform false"]);
  });

  it("HAVEGUN does not change the stand scale (it does not touch g_jackUniform)", () => {
    const s = withItems("[A] HaveGun");
    s.it.start("A");
    step(s);
    expect(s.scene.jack.uniform).toBe(false);
  });

  it("without a port the commands are 'unhandled' (the host of the pre- tests)", () => {
    const s = setup("[A] HaveTool MIOT.BM Extra 11 Let A 1");
    s.it.start("A");
    for (let i = 0; i < 4; i++) step(s);
    expect(s.host.skipped.get("HAVETOOL")).toBe(1);
    expect(s.host.skipped.get("EXTRA")).toBe(1);
    expect(s.it.vars.get("A")).toBe(1);
  });
});

describe("SceneHost: commands of chapter 1", () => {
  it("PICKUP waits for the end of Jack's global insertion; the end event of GLOBAL.ICS moves the macro on", () => {
    const s = setup("[A] Pickup 0 Pickup 1 Let A 1");
    s.it.start("A");
    step(s);
    expect(s.scene.calls).toEqual(["gins PP_L0 1 1"]); // dir 1, facing 1, civilian, n = 0
    step(s);
    step(s);
    expect(s.it.vars.get("A")).toBe(0); // still waiting
    s.host.jackInsertionEnded(true);
    for (let i = 0; i < 4; i++) step(s); // state 2 -> 0, PICKUP 1 starts the second insertion
    expect(s.scene.calls).toEqual(["gins PP_L0 1 1", "gins PP_L1 1 1"]);
    s.host.jackInsertionEnded(true);
    step(s);
    step(s);
    expect(s.it.vars.get("A")).toBe(1);
  });

  it("an idle insertion that ends does not make the next gesture skip its animation (the fixed original bug)", () => {
    const s = setup("[A] Pickup 0 Let A 1");
    s.host.jackInsertionEnded(true); // an idle animation ends before the gesture
    s.it.start("A");
    step(s);
    expect(s.scene.calls).toEqual(["gins PP_L0 1 1"]);
  });

  it("a scene insertion end releases the RUNINSERTION macro and does not touch the gesture state", () => {
    const s = setup("[A] RunInsertion JACK KLAD 0 0 - Let A 1");
    s.it.start("A");
    step(s);
    expect(s.it.vars.get("A")).toBe(0);
    s.host.jackInsertionEnded(false);
    step(s);
    expect(s.it.vars.get("A")).toBe(1);
    expect(s.host.gestures.state).toBe(0);
  });

  it("SLAPF sets SLAP, the guard loops on the end of each global insertion, SLAP and SHOOT are cleared at the end", () => {
    const s = setup("[A] SlapF 0 SlapF 1 Let B 1");
    s.it.start("A");
    step(s);
    expect(s.it.vars.get("SLAP")).toBe(1);
    expect(s.scene.calls).toEqual(["gins BOPRO0 1 1"]);
    s.host.jackInsertionEnded(true);
    expect(s.it.vars.get("SLAP")).toBe(0);
    for (let i = 0; i < 6; i++) step(s);
    expect(s.scene.calls).toEqual(["gins BOPRO0 1 1", "gins BOPRO1 1 1"]);
    expect(s.it.vars.get("B")).toBe(1); // SLAPF 1 does not wait
    s.host.jackInsertionEnded(true); // the guard continues
    expect(s.scene.calls[2]).toBe("gins BOPRO1 1 1");
  });

  it("GIVE and SHOOTF pick a section; SHOOTF facing front does nothing and the macro goes on", () => {
    const g = setup("[A] Give 3");
    g.it.start("A");
    step(g);
    expect(g.scene.calls).toEqual(["gins OPUSZCZA_WYC_DP_L 1 1"]);
    const f = setup("[A] ShootF 0 Let A 1");
    f.scene.walker.dir = 0;
    f.it.start("A");
    for (let i = 0; i < 5; i++) step(f);
    expect(f.scene.calls).toEqual([]);
    expect(f.it.vars.get("A")).toBe(1);
  });

  it("the object commands of reach the scene and are 'done' whatever they return", () => {
    const s = setup("[A] ShowAnimaFrame DRB 13 SetDarknessAnima SZYBY 0.7 BrightnessE D0 0.5 ClearAnimaBuffer FLX0 MoveEP SAS 17 -3 RelativeMulP BOB 0.8 RelativeMulP JACK 0.9 Let A 1");
    s.it.start("A");
    for (let i = 0; i < 9; i++) step(s);
    expect(s.scene.calls).toEqual(["frame DRB 13", "dark SZYBY 0.699999988079071", "bright D0 0.5", "clear FLX0", "movep SAS 17,-3", "light 0 0.800000011920929", "light null 0.8999999761581421"]);
    expect(s.it.vars.get("A")).toBe(1);
    expect(s.host.skipped.size).toBe(0);
  });

  it("EXTRA 1 takes the colt like HAVEGUN (the cursor set); EXTRA 10 stops the music and clears its name", () => {
    const calls: string[] = [];
    const items = { setGun: (on: boolean) => calls.push(`gun ${on}`) } as unknown as ItemPort;
    const s = setup("[A] Extra 1 Extra 10 Let A 1", 3, items);
    const music = { trackName: "TR17.PMS", stop: () => calls.push("stop") };
    (s.host as unknown as { env: HostEnv }).env.audio = { music } as unknown as HostEnv["audio"];
    s.it.start("A");
    for (let i = 0; i < 3; i++) step(s);
    expect(calls).toEqual(["gun true", "stop"]);
    expect(music.trackName).toBe("");
    expect(s.it.vars.get("A")).toBe(1);
  });
});

describe("JACKX / JACKY follow Jack (the pigeons of SC003 wait on IFF JACKX > 320)", () => {
  it("writes the integer part of the position, only into variables that exist", () => {
    const vars = new Variables(new Map([["JACKX", 0], ["JACKY", 0]]));
    syncJackVars(vars, { x: 320.9, y: -4.5 });
    expect(vars.get("JACKX")).toBe(320);
    expect(vars.get("JACKY")).toBe(-4);
    const none = new Variables();
    syncJackVars(none, { x: 5, y: 6 });
    expect(none.has("JACKX")).toBe(false);
  });
});

describe("SceneHost: SHOWFACE waits for the end of a scroll (Script_ExecStep case 0x17)", () => {
  function withDialog() {
    const s = setup("[A] ShowFace JACK L Let A 1");
    const shown: string[] = [];
    (s.host as unknown as { env: { dialog: unknown } }).env.dialog = { showFace: (n: string, side: string) => { shown.push(`${n} ${side}`); return true; } };
    return { s, shown };
  }
  it("does nothing and is tried again while the view scrolled in the last tick, then runs", () => {
    const { s, shown } = withDialog();
    s.host.viewScrolling = true;
    s.it.start("A");
    for (let i = 0; i < 5; i++) step(s);
    expect(shown).toEqual([]);
    expect(s.it.vars.get("A")).toBe(0);
    s.host.viewScrolling = false;
    step(s);
    step(s);
    expect(shown).toEqual(["JACK L"]);
    expect(s.it.vars.get("A")).toBe(1);
  });
  it("runs at once when the view stands still", () => {
    const { s, shown } = withDialog();
    s.it.start("A");
    step(s);
    expect(shown).toEqual(["JACK L"]);
  });
});

describe("SceneHost: restoring a saved pose (g_restoreJackPose)", () => {
  it("INIT skips the commands that place or move Jack (WALKTO, ROTATETO); other macros run them", () => {
    const s = setup("[A] WalkTo JACK 10 20 + RotateTo 5 5 [INIT] WalkTo JACK 30 40 + RotateTo 6 6");
    s.host.restoringPose = true;
    s.it.start("INIT");
    step(s);
    step(s);
    expect(s.scene.calls).toEqual([]);
    s.it.start("A");
    step(s);
    step(s);
    expect(s.scene.calls).toEqual(["walk 10,20,null", "look 5,5"]);
  });
  it("without a restored pose INIT walks Jack as usual", () => {
    const s = setup("[INIT] WalkTo JACK 30 40 + RotateTo 6 6");
    s.it.start("INIT");
    step(s);
    step(s);
    expect(s.scene.calls).toEqual(["walk 30,40,null", "look 6,6"]);
  });
  it("skippedWhenRestoring: Jack placement/movement commands only", () => {
    const c = (code: number, n1: string) => ({ code, n1 }) as never;
    expect(skippedWhenRestoring(c(0x07, "JACK"))).toBe(true);
    expect(skippedWhenRestoring(c(0x07, "BOB"))).toBe(false);
    expect(skippedWhenRestoring(c(0x4a, "LD"))).toBe(true);
    expect(skippedWhenRestoring(c(0x77, ""))).toBe(true);
    expect(skippedWhenRestoring(c(0x1b, "JACK"))).toBe(false);
  });
});

describe("SceneHost: POINTINSECAREA", () => {
  const run = (px: number, py: number) => {
    const s = setup(`[A] Let PX ${px} Let PY ${py} PointInSecArea PX PY R`);
    s.it.start("A");
    for (let i = 0; i < 3; i++) step(s);
    return s;
  };
  it("R = 1 inside a valid object quad, 0 outside", () => {
    expect(run(125, 125).it.vars.get("R")).toBe(1);
    expect(run(20, 20).it.vars.get("R")).toBe(0);
  });
  it("an object with an invalid quad is not found (Object_FindAtPoint skips g_sceneObjQuadValid = 0)", () => {
    expect(run(325, 125).it.vars.get("R")).toBe(0);
  });
});

describe("AUTOINCRANGE clock (Script_ExecStep case 0x5b, Game_TimerTick, Game_Run)", () => {
  /** Runs macro M (frame + tick), then `n - 1` more logic ticks without frames: n clock ticks in all. */
  const clockSetup = (text: string) => {
    const clock = new AutoIncClock();
    const s = setup(text, 3, undefined, clock);
    return { s, clock, ticks: (n: number) => { for (let i = 0; i < n; i++) s.host.tick(); } };
  };

  it("sets the variable to min, takes the range, and raises the variable every 64 logic ticks", () => {
    const { s, clock, ticks } = clockSetup("[M] Let A 9\nAutoIncRange A 2 5");
    s.it.start("M");
    step(s); // LET
    step(s); // AUTOINCRANGE (+ the first clock tick)
    expect(s.it.vars.get("A")).toBe(2);
    expect(clock.state()).toEqual({ min: 2, max: 5, variable: varIndex(s.it.vars, "A") });
    expect(clock.ticks).toBe(1);
    ticks(AUTOINC_PERIOD - 2);
    expect(s.it.vars.get("A")).toBe(2); // 63 ticks: not yet
    ticks(1);
    expect(s.it.vars.get("A")).toBe(3);
    expect(clock.ticks).toBe(0);
  });

  it("wraps from max + 1 to min: the variable runs min..max", () => {
    const { s, ticks } = clockSetup("[M] AutoIncRange A 2 4");
    s.it.start("M");
    s.it.tick(); // AUTOINCRANGE without a clock tick
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      ticks(AUTOINC_PERIOD);
      seen.push(s.it.vars.get("A"));
    }
    expect(seen).toEqual([3, 4, 2, 3, 4]);
  });

  it("a variable set above max by a script wraps to min at the next step (SC082: LET OCHR 21 with max 60 stays)", () => {
    const clock = new AutoIncClock();
    const vars = new Variables(new Map([["X", 0], ["OCHR", 70]]));
    clock.start(1, 0, 60);
    for (let i = 0; i < AUTOINC_PERIOD; i++) clock.tick(vars);
    expect(vars.get("OCHR")).toBe(0);
  });

  it("a second AUTOINCRANGE replaces the range; the old variable stops, the tick counter runs on", () => {
    const { s, clock, ticks } = clockSetup("[M] AutoIncRange A 0 60\n[N] AutoIncRange B 0 200");
    s.it.start("M");
    s.it.tick();
    ticks(AUTOINC_PERIOD + 10);
    expect(s.it.vars.get("A")).toBe(1);
    s.it.start("N");
    s.it.tick();
    expect(clock.variable).toBe(varIndex(s.it.vars, "B"));
    expect(clock.ticks).toBe(10); // AUTOINCRANGE does not zero g_autoIncTicks
    ticks(AUTOINC_PERIOD - 10);
    expect([s.it.vars.get("A"), s.it.vars.get("B")]).toEqual([1, 1]);
  });

  it("off (variable -1): nothing counts, not even the tick counter", () => {
    const clock = new AutoIncClock();
    const vars = new Variables(new Map([["A", 5]]));
    for (let i = 0; i < 200; i++) clock.tick(vars);
    expect([vars.get("A"), clock.ticks]).toEqual([5, 0]);
  });

  it("the variable is a short: 32767 + 1 = -32768, which is not above max, so no wrap", () => {
    const clock = new AutoIncClock();
    const vars = new Variables(new Map([["A", 32767]]));
    clock.start(0, 0, 32767);
    for (let i = 0; i < AUTOINC_PERIOD; i++) clock.tick(vars);
    expect(vars.get("A")).toBe(-32768);
  });

  it("without a clock in the environment the command only sets the variable", () => {
    const s = setup("[M] Let A 9\nAutoIncRange A 3 5");
    s.it.start("M");
    for (let i = 0; i < 3 + AUTOINC_PERIOD; i++) step(s);
    expect(s.it.vars.get("A")).toBe(3);
    expect(s.log.filter((e) => e.kind === "unhandled")).toEqual([]);
  });

  it("a chapter-3 scene start runs the OCHR clock 0..60 and keeps OCHR's value; other chapters leave the clock", () => {
    const vars = new Variables(new Map([["LOC7", 0], ["A", 0], ["OCHR", 17]]));
    const clock = new AutoIncClock();
    clock.start(0, 0, 200); // SC000D [PRE]: AUTOINCRANGE LOC7 0 200
    clock.sceneStart(2, vars);
    expect(clock.state()).toEqual({ min: 0, max: 200, variable: 0 });
    clock.sceneStart(3, vars);
    expect(clock.state()).toEqual({ min: 0, max: 60, variable: 2 });
    expect(vars.get("OCHR")).toBe(17);
    clock.sceneStart(3, new Variables(new Map([["A", 0]]))); // no OCHR: the search's start value, index 0
    expect(clock.variable).toBe(0);
  });

  it("a [PRE] AUTOINCRANGE after the chapter-3 start wins (Game_Run l. 382 runs before [PRE])", () => {
    const { s, clock } = clockSetup("[PRE] AutoIncRange A 1 2");
    clock.sceneStart(3, s.it.vars); // no OCHR in VARS -> index 0
    s.it.runSynchronous("PRE");
    expect(clock.state()).toEqual({ min: 1, max: 2, variable: varIndex(s.it.vars, "A") });
  });

  it("save tail: state() -> restore() keeps the range; the tick counter is not part of it and runs on", () => {
    const a = new AutoIncClock();
    a.start(158, 0, 60);
    a.ticks = 40;
    const b = new AutoIncClock();
    b.ticks = 7;
    b.restore(JSON.parse(JSON.stringify(a.state())));
    expect(b.state()).toEqual({ min: 0, max: 60, variable: 158 });
    expect(b.ticks).toBe(7);
  });
});
