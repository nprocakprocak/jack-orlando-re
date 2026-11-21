// the drive-off of SC006 (macro POKAZANIE-AUTOJAC.PBM) on stand-ins: no game files. The macro text is the tail of the
// original script (Jack already stands at the car); what is checked is the order the host gives the scene: the old FLX0 frame
// is cleared before the film starts, the car shadow is bound before the animation, Jack and the parked car vanish when the
// animation reaches its frame, and only after the animation ends does the game go to the map with LAST = 6.
import { describe, expect, it } from "vitest";
import { AreaState } from "../areas";
import { compileMcc, Interpreter } from "../script";
import type { ScenePlayer } from "../scene";
import { SceneHost, type HostEnv } from "./host";

const DRIVE = `
[POKAZANIE-AUTOJAC.PBM]
Let LOC3 1
ActiveMacroAnima HIDEJACK FLX0 1 1
ActiveMacroAnima CHDEL FLX0 1 88
ClearAnimaBuffer FLX0
SetPositionE FLX0 376 312
AnimaShadow FLX0 JACK SHAD1 1
Anima FLX0 0 3 5 1 -
HideE FLX0
If CLEARMB1 0
	ClearMenuBar 1
	Let CLEARMB1 1
EndIf
Let LAST 6
GoToScene SC000D

[HIDEJACK]
Hide JACK
HideE AUTOJAC.PBM

[CHDEL]
AnimaDelay FLX0 140
DoNothing 80
AnimaDelay FLX0 3
`;

function setup() {
  const calls: string[] = [];
  const anim = {
    active: true,
    index: 0,
    delay: 0,
    stop() {
      this.active = false;
    },
  };
  // any scene call not listed is a recorded no-op that reports success
  const scene = new Proxy(
    {
      objectAnim: (n: string) => (n === "FLX0" ? anim : null),
      startObjectAnim(n: string, a: unknown) {
        calls.push(`anima ${n} ${JSON.stringify(a)}`);
        return true;
      },
      clearAnimBuffer(n: string) {
        calls.push(`clear ${n}`);
        return true;
      },
      setObjectPosition(n: string, x: number, y: number) {
        calls.push(`pos ${n} ${x},${y}`);
      },
      setObjectVisible(n: string, v: boolean) {
        calls.push(`vis ${n} ${v}`);
      },
      setAnimShadow(a: string, p: number | null, sh: number | null, clear: boolean) {
        calls.push(`animshadow ${a} ${p} ${sh} ${clear}`);
        return true;
      },
      scene: { areas: [] },
      persons: { find: () => -1, get: () => undefined, persons: [] },
    } as Record<string | symbol, unknown>,
    {
      get: (t, k) => (k in t ? t[k] : (...a: unknown[]) => (calls.push(`${String(k)} ${a.join(",")}`), true)),
    },
  );
  const ref: { it?: Interpreter } = {};
  const out = { goto: [] as string[], fade: 0, last: [] as number[] };
  const vars = new Map([
    ["LAST", 8],
    ["LOC3", 0],
    ["CLEARMB1", 0],
  ]);
  const env: HostEnv = {
    scene: scene as unknown as ScenePlayer,
    areas: new AreaState(),
    gotoScene: (n) => out.goto.push(n) && out.last.push(ref.it!.vars.get("LAST")),
    requestFade: () => out.fade++,
    clickX: () => 0,
    answer: () => 0,
    log: () => undefined,
    runFilm: () => undefined,
  };
  const host = new SceneHost(env, 3);
  const it = new Interpreter(compileMcc(new Uint8Array([...DRIVE].map((c) => c.charCodeAt(0)))), host, vars);
  host.interpreter = it;
  ref.it = it;
  const step = () => (it.tick(), it.logicTick(), host.tick());
  return { host, it, anim, calls, out, step };
}

describe("SC006 drive-off macro (stand-ins)", () => {
  it("clears FLX0, binds the shadow, plays the animation and goes to SC000D with LAST 6 only when it ends", () => {
    const s = setup();
    s.it.start("POKAZANIE-AUTOJAC.PBM");
    for (let i = 0; i < 30; i++) s.step();
    const order = s.calls.filter((c) => /^(clear|pos FLX0|animshadow|startFlxAnim)/.test(c));
    expect(order.map((c) => c.split(" ").slice(0, 2).join(" "))).toEqual([
      "clear FLX0",
      "pos FLX0",
      "animshadow FLX0",
      "startFlxAnim FLX0,5,3,1",
    ]); // mode 5, delay 3, record 1
    expect(s.calls.find((c) => c.startsWith("animshadow"))).toBe("animshadow FLX0 null 1 true");
    expect(s.out.goto).toEqual([]); // the animation still runs: the macro waits
    // the frame the script waits for: the registered macros start (HIDEJACK hides Jack and the car)
    s.host.animFrame("FLX0", 1, 1);
    for (let i = 0; i < 4; i++) s.step();
    expect(s.calls).toContain("hideJack ");
    expect(s.calls.filter((c) => c === "vis AUTOJAC.PBM false").length).toBe(1);
    expect(s.out.goto).toEqual([]);
    s.host.finish("anim:FLX0"); // the film's last image
    for (let i = 0; i < 12; i++) s.step();
    expect(s.out.goto).toEqual(["SC000D"]);
    expect(s.out.last).toEqual([6]);
    expect(s.host.skipped.size).toBe(0);
  });
});
