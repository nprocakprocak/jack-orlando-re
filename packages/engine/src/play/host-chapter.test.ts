// Commands of chapter 1.
import { describe, expect, it } from "vitest";
import type { HostEnv, ItemPort } from "./host";
import { setup, step } from "./testing";

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
