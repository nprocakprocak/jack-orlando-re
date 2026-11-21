import { describe, expect, it } from "vitest";
import { Variables } from "../script";
import { walkScrollDirection } from "../scene/scroll";
import { globalFilmTarget, skippedWhenRestoring, syncJackVars } from "./host";
import { setup, step } from "./testing";

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
    expect(s.scene.turning.pointRotate).toBe(true);
    expect(s.scene.turning.pointRotateSaved).toBe(true);
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
