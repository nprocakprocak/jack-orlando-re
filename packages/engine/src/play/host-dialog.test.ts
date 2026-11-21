// Dialog, talk lines and SHOWFACE.
import { describe, expect, it } from "vitest";
import { setup, step } from "./testing";

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
    expect(s.out.answers).toEqual([
      [5, 1],
      [5, 2],
    ]);
    expect(s.it.answers.get(5)).toBe(7);
  });
});

describe("SceneHost: SHOWFACE waits for the end of a scroll (Script_ExecStep case 0x17)", () => {
  function withDialog() {
    const s = setup("[A] ShowFace JACK L Let A 1");
    const shown: string[] = [];
    (s.host as unknown as { env: { dialog: unknown } }).env.dialog = {
      showFace: (n: string, side: string) => {
        shown.push(`${n} ${side}`);
        return true;
      },
    };
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
