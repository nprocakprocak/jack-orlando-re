// Script commands of the effect player, on a scene bank built in the test.
import { describe, expect, it } from "vitest";
import { JACK, type Command, type Ref } from "../script/compiler";
import { SFX_COMMANDS, type SfxEnv } from "./sfx";
import { setup } from "./testing";

const refs = (...r: Ref[]): Ref[] => r;
function cmd(code: number, o: Partial<Command> = {}): Command {
  return {
    code,
    word: "",
    line: 1,
    n1: "",
    n2: "",
    a: [0, 0, 0, 0, 0, 0, 0],
    f: null,
    c: null,
    refs: [],
    ...o,
  };
}
const env = (a: number[], over: Partial<SfxEnv> = {}): SfxEnv => ({
  person: (n) => ({ POL: 3 })[n as "POL"] ?? -1,
  anim: (n) => ({ DOOR: 7 })[n as "DOOR"] ?? -1,
  arg: (i) => a[i] ?? 0,
  ...over,
});

describe("script commands", () => {
  const sound = (n: string) => refs([1, "sound", n]);

  it("EFFECT", () => {
    const { sfx, mixer } = setup();
    const c = cmd(SFX_COMMANDS.EFFECT, {
      n1: "B.SND",
      a: [4, 1, 20, 20, 0, 0, 0],
      refs: sound("B.SND"),
    });
    expect(sfx.command(c, env([4, 1, 20]))).toBe("done");
    expect(mixer.isPlaying(2)).toBe(true);
    expect(mixer.level(2)).toBe(40);
  });

  it("EFFECT with an unknown sound is a no-op", () => {
    const { sfx, mixer } = setup();
    const c = cmd(SFX_COMMANDS.EFFECT, { refs: sound("NOPE.SND") });
    expect(sfx.command(c, env([1, 1, 20]))).toBe("done");
    expect(mixer.isPlaying(1)).toBe(false);
  });

  it("EFFECTVOLUME and WAITWHILEEFFECT", () => {
    const { sfx, mixer, backend } = setup();
    sfx.command(cmd(SFX_COMMANDS.EFFECT, { refs: sound("A.SND") }), env([1, 0, 10]));
    sfx.command(cmd(SFX_COMMANDS.EFFECTVOLUME, { refs: sound("A.SND") }), env([45]));
    expect(mixer.level(1)).toBe(90);
    const wait = cmd(SFX_COMMANDS.WAITWHILEEFFECT, { refs: sound("A.SND") });
    expect(sfx.command(wait, env([]))).toBe("repeat");
    backend.voices[0].finish();
    expect(sfx.command(wait, env([]))).toBe("done");
  });

  it("WAITWHILEEFFECT of an unknown sound does not wait", () => {
    const { sfx } = setup();
    expect(sfx.command(cmd(SFX_COMMANDS.WAITWHILEEFFECT, { refs: sound("NOPE.SND") }), env([]))).toBe("done");
  });

  it("UNLOCKCANAL", () => {
    const { sfx } = setup();
    sfx.playIndexed(11, 0, 20);
    expect(sfx.isReserved(1)).toBe(true);
    sfx.command(cmd(SFX_COMMANDS.UNLOCKCANAL), env([1]));
    expect(sfx.isReserved(1)).toBe(false);
  });

  it("WALKEFFECT of a person and of Jack", () => {
    const { sfx } = setup();
    const person = cmd(SFX_COMMANDS.WALKEFFECT, {
      n1: "POL",
      a: [4, 2, 64, 3, 0, 40, 0],
      refs: [[4, "sound", "A.SND"]],
    });
    sfx.command(person, env([4, 2, 64, 3, 0, 40]));
    expect(sfx.walkEffectOf(3, 4)).toEqual({ sound: 0, volume: 40 });
    const off = cmd(SFX_COMMANDS.WALKEFFECT, {
      n1: "POL",
      a: [4, 2, 0, 3, 0, 0, 0],
      refs: [[4, "sound", "A.SND"]],
    });
    sfx.command(off, env([4, 2, 0, 3, 0, 0]));
    expect(sfx.walkEffectOf(3, 4).sound).toBe(-1);
    const jack = (slot: number, n: string) =>
      cmd(SFX_COMMANDS.WALKEFFECT, {
        n1: "JACK",
        a: [slot, 0, 0, JACK, 0, 0, 0],
        refs: [[4, "sound", n]],
      });
    sfx.command(jack(0, "B.SND"), env([0]));
    sfx.command(jack(1, "A.SND"), env([1]));
    expect([sfx.step1, sfx.step2]).toEqual([1, 0]);
  });

  it("ANIMAEFFECT", () => {
    const { sfx } = setup();
    const c = cmd(SFX_COMMANDS.ANIMAEFFECT, { n1: "DOOR", refs: [[4, "sound", "B.SND"]] });
    sfx.command(c, env([4, 1, 12, 7, 0, 1, 12]));
    expect(sfx.animaEffects(7)).toEqual([{ image: 4, rec: 1, channel: 1, sound: 1, volume: 12 }]);
    sfx.command(cmd(SFX_COMMANDS.ANIMAEFFECT, { n1: "NO_SUCH" }), env([]));
    expect(sfx.animaEffects(-1)).toEqual([]);
  });

  it("other codes are not ours", () => {
    const { sfx } = setup();
    expect(sfx.command(cmd(0x3f), env([]))).toBeUndefined();
  });
});
