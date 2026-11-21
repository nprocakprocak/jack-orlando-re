import { describe, expect, it } from "vitest";
import { type Dcn, type Face } from "../formats/dialog";
import { type Measure } from "./caption";
import { DialogController, type DialogHost } from "./controller";
import { menuTop } from "./menu";
import { DIALOG_TABLES, type DialogTables } from "./tables";

const m6: Measure = (t) => t.length * 6; // every char 6 px
const entry = (id: number, text: string, width = 200, sound = "T001.SND") => ({
  id,
  text,
  width,
  sound,
});

const tables: DialogTables = {
  lipPair: (c) => (c === 0x41 ? [4, 2] : [0, 1]),
  mouthCycle: [0, 2, 4, 3, 1, 2, 4, 3, 1, 3],
  blinkOrder: [0, 1, 2, 1, 0],
  speakerColors: Array.from({ length: 17 }, (_, i) => 1000 + i),
  textColors: [1, 65504, 1, 63480, 7, 9],
  menuFill: 65504,
};

const face = (name: string): Face => ({
  name,
  face: "F.PBM",
  eyesPos: [1, 2],
  eyes: ["E1", "E2", "E3"],
  mouthPos: [3, 4],
  mouth: ["M1", "M2", "M3", "M4", "M5"],
});
const dcn = (): Dcn => ({
  entries: [
    entry(10, "Czesc", 120),
    entry(900, "pierwsza", 100),
    entry(901, "druga dluzsza", 100),
    entry(902, "x", 100),
  ],
  dialogs: [{ id: 900, kind: "Q", first: 1, count: 3 }],
});

function setup(voiceSeconds: number | null = null) {
  const resumed: number[] = [];
  const voices: [number, string][] = [];
  let stops = 0;
  const host: DialogHost = {
    playVoice: (c, f) => (voices.push([c, f]), voiceSeconds),
    stopVoices: () => void stops++,
    resume: (mac) => void resumed.push(mac),
  };
  const answers = new Map<number, number>();
  const c = new DialogController({ host, tables, measure: m6, answers });
  c.loadScene(dcn(), [face("BOY"), face("LOLA")]);
  return { c, resumed, voices, answers, stops: () => stops };
}
const run = (c: DialogController, maxTicks = 5000) => {
  let t = 0;
  while (c.talking && t++ < maxTicks) {
    c.tick();
    c.frame();
  }
  return t;
};

describe("DialogController", () => {
  it("face index is position + 2 and the left window is mirrored unless starred", () => {
    const { c } = setup();
    expect(c.showFace("LOLA", "L", false)).toBe(true);
    expect(c.faceView("L")).toMatchObject({ slot: 3, mirrored: true });
    c.showFace("LOLA", "L", true);
    expect(c.faceView("L")?.mirrored).toBe(false);
    c.showFace("BOY", "R", false);
    expect(c.faceView("R")).toMatchObject({ slot: 2, mirrored: false });
    expect(c.showFace("NIKT", "R", false)).toBe(false);
    c.hideFace("R");
    expect(c.faceView("R")).toBeNull();
  });

  // SC025 `TALK LEFT 10 1 -10 +` then `HIDEFACEAT L` — the face stays until the line has been spoken.
  for (const voice of [null, 0.2, 6]) {
    it(`HIDEFACEAT lets a '+' line finish before the window is hidden (voice ${voice})`, () => {
      const { c, stops } = setup(voice);
      c.showFace("LOLA", "L", false);
      expect(c.talk("LEFT", 10, 1, "+", 7)).toBe(true);
      c.hideFaceAt("L");
      let ticks = 0;
      while (c.talking && ticks++ < 5000) {
        c.tick();
        c.frame();
        if (c.talking) expect(c.faceView("L")).not.toBeNull(); // face present for the whole line
      }
      expect(ticks).toBeGreaterThan(1); // the line did not end at its first step
      expect(stops()).toBe(1); // the voice is stopped only at the end
      c.frame();
      expect(c.faceView("L")).toBeNull();
    });
  }

  it("HIDEFACEAT without a line hides at the next frame; a scene change drops a pending hide", () => {
    const { c } = setup();
    c.showFace("BOY", "R", false);
    c.hideFaceAt("R");
    expect(c.faceView("R")).not.toBeNull();
    c.frame();
    expect(c.faceView("R")).toBeNull();
    c.showFace("BOY", "R", false);
    c.hideFaceAt("R");
    c.loadScene(dcn(), [face("BOY")]);
    c.showFace("BOY", "R", false);
    c.frame();
    expect(c.faceView("R")).not.toBeNull();
  });

  it("JACK and JACKWOJ are slots 0 and 1 from RESOURCE.PAK; with jackUniform JACK shows JACKWOJ unstarred", () => {
    const { c } = setup();
    c.showFace("JACK", "R", false);
    expect(c.faceView("R")).toMatchObject({
      slot: 0,
      source: "resource",
      face: { face: "FACEJ.PBM", eyesPos: [0x22, 0x30], mouthPos: [0x23, 0x48] },
    });
    expect(c.faceView("R")!.face.mouth[4]).toBe("USJA5.PBM");
    c.showFace("JACKWOJ", "L", true);
    expect(c.faceView("L")).toMatchObject({
      slot: 1,
      mirrored: false,
      face: { face: "FACEJAW.PBM", eyes: ["OJAW1.PBM", "OJAW2.PBM", "OJAW3.PBM"] },
    });
    c.jackUniform = true;
    c.showFace("JACK", "L", true);
    expect(c.faceView("L")).toMatchObject({ slot: 1, mirrored: true });
    c.showFace("BOY", "R", false);
    expect(c.faceView("R")).toMatchObject({ slot: 2, source: "scene" });
  });

  it("TALK shows a caption in the speaker's colour, plays the voice and resumes the macro at the end", () => {
    const { c, resumed, voices, stops } = setup();
    c.showFace("LOLA", "L", false);
    expect(c.talk("LEFT", 10, 1, "-", 7)).toBe(true);
    expect(voices).toEqual([[1, "T001.S22"]]);
    expect(c.caption?.lines[0].text).toBe("Czesc");
    expect(c.caption?.fill).toBe(1003); // slot 3
    expect(run(c)).toBeGreaterThan(20);
    expect(c.caption).toBeNull();
    expect(resumed).toEqual([7]);
    expect(stops()).toBe(1);
    // the window is not redrawn at the end: the last mouth frame stays
    expect(c.faceView("L")?.mouth).not.toBeNull();
    c.showFace("LOLA", "L", false);
    expect(c.faceView("L")).toMatchObject({ mouth: null, eyes: [] });
  });

  it("'+' does not resume the macro; a click ends the line at its next step", () => {
    const { c, resumed } = setup();
    c.showFace("LOLA", "L", false);
    c.talk("LEFT", 10, 1, "+", 7);
    for (let i = 0; i < 40 && c.talking; i++) {
      c.tick();
      c.frame(true);
    }
    expect(c.talking).toBe(false);
    expect(resumed).toEqual([]);
  });

  it("mouth animates while talking, a blink runs 0,1,2,1,0 from step 0", () => {
    const { c } = setup();
    c.showFace("LOLA", "L", false);
    c.talk("LEFT", 900, 1, "-", 1);
    const eyes: string[] = [];
    const mouths: (number | null)[] = [];
    while (c.talking) {
      c.tick();
      c.frame();
      const v = c.faceView("L");
      if (c.talking) {
        eyes.push(v!.eyes.join());
        mouths.push(v!.mouth);
      }
    }
    const dedupe = <T>(a: T[]) => a.filter((v, i) => i === 0 || v !== a[i - 1]);
    expect(dedupe(eyes)).toEqual(["", "0", "1", "2", "1", "0", ""]);
    expect(dedupe(mouths).slice(1, 6)).toEqual([0, 2, 4, 3, 1]);
  });

  it("a line whose window has no face ends at its first step", () => {
    const { c, resumed } = setup();
    c.talk("RIGHT", 10, 2, "-", 3);
    expect(run(c)).toBeLessThan(20);
    expect(resumed).toEqual([3]);
  });

  it("DialogOnOff hides the caption but not the menu, and the line still takes its time", () => {
    const { c } = setup();
    c.textOn = false;
    c.showFace("LOLA", "L", false);
    c.talk("LEFT", 10, 1, "-", 1);
    expect(c.caption).toBeNull();
    expect(c.talking).toBe(true);
    c.startDialog("LEFT", 900, 1);
    expect(c.menu?.rows).toHaveLength(3);
  });

  it("a person caption has no face animation and needs no face", () => {
    const { c, resumed } = setup();
    c.talk({ x: 300, y: 200 }, 10, 1, "-", 5);
    expect(c.caption?.fill).toBe(9);
    run(c);
    expect(resumed).toEqual([5]);
  });

  it("DIALOG: sorted menu, answer stored under the dialog id, answer spoken on channel 1 (LEFT), macro resumes after it", () => {
    const { c, answers, voices, resumed } = setup();
    c.showFace("LOLA", "L", false);
    expect(c.startDialog("LEFT", 900, 4)).toBe(true);
    const rows = c.menu!.rows;
    // "x" (option 2) is the narrowest, then "pierwsza", then "druga dluzsza"
    expect(rows.map((r) => r.index)).toEqual([2, 0, 1]);
    const r = rows[1];
    expect(c.pointer(r.x + 2, r.y + 2, true)).toBeUndefined();
    expect(c.menu?.pressed).toBe(1);
    expect(c.pointer(r.x + 2, r.y + 2, false)).toBe(0);
    expect(answers.get(900)).toBe(0);
    expect(c.menu).toBeNull();
    expect(voices.at(-1)).toEqual([1, "T001.S22"]);
    expect(c.caption?.lines[0].text).toBe("pierwsza");
    expect(resumed).toEqual([]);
    run(c);
    expect(resumed).toEqual([4]);
  });

  it("DIALOG with RIGHT speaks the answer on channel 2; SETDIALOG hides and shows options", () => {
    const { c, voices } = setup();
    c.showFace("BOY", "R", false);
    c.setDialogOption(900, 0, 0);
    c.startDialog("RIGHT", 900, 4);
    expect(c.menu?.rows.map((r) => r.index)).toEqual([2, 1]);
    expect(c.menu?.rows[0].y).toBe(menuTop(2));
    const r = c.menu!.rows[0];
    c.pointer(r.x + 1, r.y + 1, true);
    expect(c.pointer(r.x + 1, r.y + 1, false)).toBe(2);
    expect(voices.at(-1)![0]).toBe(2);
    c.setDialogOption(900, 0, 1);
    c.startDialog("RIGHT", 900, 4);
    expect(c.menu?.rows).toHaveLength(3);
  });

  it("an answer of a RIGHT dialog is captioned at the right edge, under the right window", () => {
    const { c } = setup();
    c.showFace("BOY", "R", false);
    c.startDialog("RIGHT", 900, 4);
    const r = c.menu!.rows[0];
    c.pointer(r.x + 1, r.y + 1, true);
    c.pointer(r.x + 1, r.y + 1, false);
    expect(c.caption!.x + c.caption!.width).toBe(0x27f);
    expect(c.caption!.fill).toBe(1002);
  });

  it("the answer is stored under the dialog id only", () => {
    const { c, answers } = setup();
    c.startDialog("LEFT", 900, 0);
    const r = c.menu!.rows[2];
    c.pointer(r.x, r.y, true);
    c.pointer(r.x, r.y, false);
    expect(answers.get(900)).toBe(r.index);
    expect(answers.get(901)).toBeUndefined();
  });

  it("unknown ids are reported", () => {
    const { c } = setup();
    expect(c.talk("LEFT", 12345, 1, "-", 1)).toBe(false);
    expect(c.startDialog("LEFT", 12345, 1)).toBe(false);
    expect(c.talkOption("LEFT", 12345, 0, 1, "-", 1)).toBe(false);
    c.loadScene(null, null);
    expect(c.talk("LEFT", 10, 1, "-", 1)).toBe(false);
  });

  it("idle blink: every 150 frames on the left window, 25 frames long", () => {
    const { c } = setup();
    c.showFace("LOLA", "L", false);
    const seen: string[] = [];
    for (let i = 1; i <= 180; i++) {
      c.frame();
      seen.push(c.faceView("L")!.eyes.join());
    }
    expect(seen.slice(0, 149).every((e) => e === "")).toBe(true);
    expect(seen.slice(149, 154)).toEqual(["0", "0", "0", "0", "0"]);
    // drawn over the window: frames pile up, a repeated one moves to the top; the last stays
    expect(seen[154]).toBe("0,1");
    expect(seen[159]).toBe("0,1,2");
    expect(seen[164]).toBe("0,2,1");
    expect(seen[169]).toBe("2,1,0");
    expect(seen[179]).toBe("2,1,0");
  });
});

describe("dialog tables", () => {
  const t = DIALOG_TABLES;

  it("matches the tables: mouth, blink, colours, and the lip pair for A", () => {
    expect(t.mouthCycle).toEqual([0, 2, 4, 3, 1, 2, 4, 3, 1, 3]);
    expect(t.blinkOrder).toEqual([0, 1, 2, 1, 0]);
    expect(t.speakerColors).toHaveLength(17);
    expect(t.speakerColors[0]).toBe(0xffff);
    expect(t.textColors).toEqual([1, 65504, 1, 63480, 1, 63480]);
    expect(t.menuFill).toBe(65504);
    expect(t.lipPair(0x41)).toEqual([4, 2]);
    expect(t.lipPair(0x91 - 256)).toHaveLength(2);
  });
});
