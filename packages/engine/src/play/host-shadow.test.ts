// Shadow commands.
import { describe, expect, it } from "vitest";
import { setup, step } from "./testing";

describe("SceneHost: shadow commands", () => {
  it("SETSHADOW, MINSHADOW and MAXSHADOW pass n, the person (null = Jack) and Jack's shadow number", () => {
    const s = setup("[A] SetShadow JACK 0 SetShadow BOB 5 MinShadow BOB 0 20 MaxShadow JACK 1 4 MinShadow JACK 0 10");
    s.it.start("A");
    for (let i = 0; i < 5; i++) step(s);
    expect(s.scene.calls).toEqual([
      "shadow null 0",
      "shadow 0 5",
      "fadeout 0 20 0",
      "fadein null 4 1",
      "fadeout null 10 0",
    ]);
  });

  it("SHIFTSHADOWP sets the person's offset; SETSPECSHADOW, SHOWSHADOW, SHADOWSTATUS and HIDESHADOW reach the scene", () => {
    const s = setup(
      "[A] ShiftShadowP SHIFTY 40 6 SetSpecShadow BOB OBJ ShowShadow BOB 540 357 1.0 ShadowStatus BOB 1 HideShadow BOB ShadowStatus BOB 0",
    );
    s.it.start("A");
    for (let i = 0; i < 6; i++) step(s);
    expect([s.scene.shifty.shadowDx, s.scene.shifty.shadowDy]).toEqual([40, 6]);
    expect(s.scene.calls).toEqual(["spec 0 OBJ", "show 0 540,357 1", "status 0 true", "hide 0", "status 0 false"]);
  });

  it("an unknown person or object is skipped and logged", () => {
    const s = setup(
      "[A] SetShadow NOBODY 1 SetSpecShadow BOB NOPE ShowShadow NOBODY 1 2 1.0 HideShadow NOBODY ShiftShadowP NOBODY 1 2",
    );
    s.it.start("A");
    for (let i = 0; i < 5; i++) step(s);
    expect(s.scene.calls).toEqual(["spec 0 NOPE"]);
    for (const w of ["SETSHADOW", "SETSPECSHADOW", "SHOWSHADOW", "HIDESHADOW", "SHIFTSHADOWP"])
      expect(s.host.skipped.get(w)).toBe(1);
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
    const s = setup(
      "[A] AnimaShadow ANI JACK SHAD1 0 AnimaShadow ANI JACK SHAD0 1 AnimaShadow ANI JACK NULL 0 AnimaShadow NOPE JACK SHAD0 0 AnimaShadow ANI BOB SHAD2 1",
    );
    s.it.start("A");
    for (let i = 0; i < 6; i++) step(s);
    expect(s.scene.calls).toEqual([
      "animshadow ANI null 1 false",
      "animshadow ANI null 0 true",
      "animshadow ANI null null false",
      "animshadow NOPE null 0 false",
      "animshadow ANI 0 2 true",
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
