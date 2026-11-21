import { describe, expect, it } from "vitest";
import { type Dcn, type Face } from "../formats/dialog";
import { hotspotOffset } from "../cursor/modes";
import { encodeMazovia, placeCaption, placePersonCaption, wrapCaption, type Measure } from "./caption";
import { DialogController, type DialogHost } from "./controller";
import { lipWithoutVoice, lipWithVoice, PACE_TALK, stepInterval } from "./lipsync";
import { buildMenu, menuTop, MenuPointer, ReleaseGate, rowStyle } from "./menu";
import { DIALOG_TABLES, type DialogTables } from "./tables";

const m6: Measure = (t) => t.length * 6; // every char 6 px
const entry = (id: number, text: string, width = 200, sound = "T001.SND") => ({ id, text, width, sound });

const tables: DialogTables = {
  lipPair: (c) => (c === 0x41 ? [4, 2] : [0, 1]),
  mouthCycle: [0, 2, 4, 3, 1, 2, 4, 3, 1, 3],
  blinkOrder: [0, 1, 2, 1, 0],
  speakerColors: Array.from({ length: 17 }, (_, i) => 1000 + i),
  textColors: [1, 65504, 1, 63480, 7, 9],
  menuFill: 65504,
};

describe("wrapCaption", () => {
  it("keeps a short text on one line", () => expect(wrapCaption(m6, "ala ma kota", 200)).toEqual(["ala ma kota"]));
  it("breaks at spaces, dropping the closed line's last space; a chunk fits only when strictly narrower", () => {
    // "aaa bbb " = 48 px: not strictly narrower than 48
    expect(wrapCaption(m6, "aaa bbb ccc", 48)).toEqual(["aaa", "bbb ccc"]);
    expect(wrapCaption(m6, "aaa bbb ccc", 49)).toEqual(["aaa bbb", "ccc"]);
    expect(wrapCaption(m6, "aaa bbb ccc", 25)).toEqual(["aaa", "bbb", "ccc"]);
  });
  it("stops after 5 lines and drops the rest", () => {
    expect(wrapCaption(m6, "a b c d e f g", 13)).toEqual(["a", "b", "c", "d", "e"]);
  });
  it("a word wider than the box leaves empty lines behind", () => {
    const lines = wrapCaption(m6, "x wwwwwwwwwwwwww y", 40);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe("x");
    expect(lines.slice(1)).toEqual(["", "", "", ""]);
  });
});

describe("encodeMazovia", () => {
  it("turns text back into game bytes", () => {
    expect([...encodeMazovia("Ala ę")]).toEqual([0x41, 0x6c, 0x61, 0x20, 0x91]);
  });

  it("draws é as e, the glyph the Resource.pak fonts actually have", () => {
    expect([...encodeMazovia("é")]).toEqual([0x65]);
  });
});

describe("caption placement", () => {
  const base = { measure: m6, text: "hej", width: 100, scrollX: 100 };
  const colors = { leftColor: { outline: 1, fill: 10 }, rightColor: { outline: 1, fill: 20 } };
  it("LEFT is pushed to the left screen edge and takes the left colour", () => {
    const c = placeCaption({ ...base, ...colors }, 100, 0x8c);
    expect(c.x).toBe(101);
    expect(c.fill).toBe(10);
    expect(c.y).toBe(0x8c);
    expect(c.lines[0].x).toBe(c.x + (100 - 18) / 2);
  });
  it("RIGHT is pushed to the right edge and takes the right colour", () => {
    const c = placeCaption({ ...base, ...colors }, 100 + 0x280, 0x8c);
    expect(c.x).toBe(100 + 0x27f - 100);
    expect(c.fill).toBe(20);
  });
  it("clamps y to the screen", () => {
    expect(placeCaption({ ...base, ...colors }, 400, 470).y).toBe(0x1df - 24);
    expect(placeCaption({ ...base, ...colors }, 400, -5).y).toBe(1);
  });
  it("a person caption sits above the point; a clamped one lands off screen (as in the game)", () => {
    const c = placePersonCaption(base, 400, 200, { outline: 7, fill: 9 });
    expect(c.y).toBe(200 - 24);
    expect(c.fill).toBe(9);
    expect(placePersonCaption(base, 400, 10, { outline: 7, fill: 9 }).y).toBe(1 - 24);
  });
});

describe("menu", () => {
  const opts = [entry(1, "aaaaaaaaaa"), entry(2, "bbb"), entry(3, "cccccc"), entry(4, "dd")];
  it("sorts by width ascending and maps rows back to the original index", () => {
    const rows = buildMenu(opts, [false, false, false, false], m6, 50, 0, menuTop(4));
    expect(rows.map((r) => r.index)).toEqual([3, 1, 2, 0]);
    expect(rows.map((r) => r.y)).toEqual([0x1d3 - 100, 0x1d3 - 76, 0x1d3 - 52, 0x1d3 - 28]);
    expect(rows[0].x).toBe(56);
    expect(rows[0].width).toBe(16); // 12 + 4
  });
  it("rounds odd widths up and keeps equal widths in file order", () => {
    const rows = buildMenu([entry(1, "ab"), entry(2, "cd")], [false, false], (t) => t.length * 3, 0, 0, 0);
    expect(rows.map((r) => [r.index, r.width])).toEqual([[0, 10], [1, 10]]);
    expect(buildMenu([entry(1, "a")], [false], (t) => t.length * 3, 0, 0, 0)[0].width).toBe(8); // 3 + 4 = 7 -> 8
  });
  it("leaves hidden options out", () => {
    const rows = buildMenu(opts, [false, true, false, true], m6, 0, 0, 0);
    expect(rows.map((r) => r.index)).toEqual([2, 0]);
  });
  it("highlights on press, chooses on release over the same row, cancels when leaving", () => {
    const rows = buildMenu(opts, [false, false, false, false], m6, 0, 0, 0);
    const p = new MenuPointer(rows);
    expect(p.update(8, 5, false)).toMatchObject({ hover: 0, pressed: -1 });
    expect(p.update(8, 5, true).pressed).toBe(0);
    expect(p.update(8, 100, true).pressed).toBe(-1); // dragged away, still held
    expect(p.update(8, 100, false).chosen).toBeUndefined();
    p.update(8, 30, true); // row 1 (y 24..49)
    expect(p.update(8, 30, false).chosen).toBe(rows[1].index);
  });
});

describe("menu: the click that interrupted the line", () => {
  const rows = buildMenu([entry(1, "aaaaaaaaaa"), entry(2, "bbb")], [false, false], m6, 0, 0, 0);
  /** one frame as game.ts runs it: the gate feeds the pointer while the menu is open */
  function frames(seq: boolean[]): (number | undefined)[] {
    const gate = new ReleaseGate();
    const p = new MenuPointer(rows);
    return seq.map((down) => p.update(8, 5, gate.update(true, down)).chosen);
  }
  it("a button already down when the menu opens neither highlights nor chooses; the next click does", () => {
    // held through the opening, released, then pressed and released again
    const r = frames([true, true, false, true, false]);
    expect(r.slice(0, 3)).toEqual([undefined, undefined, undefined]);
    expect(r[4]).toBe(rows[0].index);
  });
  it("the pointer alone would take the held click (reads the level); the gate stands for g_clickArmed", () => {
    const p = new MenuPointer(rows);
    expect(p.update(8, 5, true).pressed).toBe(0);
    expect(p.update(8, 5, false).chosen).toBe(rows[0].index);
  });
  it("a menu opened with the button up takes the first click at once", () => {
    expect(frames([false, true, false])[2]).toBe(rows[0].index);
  });
  it("closing the menu resets the gate: the next menu opens with a held button again", () => {
    const gate = new ReleaseGate();
    expect(gate.update(true, false)).toBe(false);
    expect(gate.update(true, true)).toBe(true);
    gate.update(false, true);
    expect(gate.update(true, true)).toBe(false);
    expect(gate.update(true, false)).toBe(false);
    expect(gate.update(true, true)).toBe(true);
  });
});

describe("menu hit box", () => {
  // two visible options, y = 0x1d3 - 25 * 2 = 417, rows 24 px apart
  const rows = buildMenu([entry(1, "Stay"), entry(2, "Ask later")], [false, false], m6, 0, 0, menuTop(2));
  const hit = (x: number, y: number) => new MenuPointer(rows).hit(x, y);
  it("covers 25 px per row, rows 24 px apart; the later row wins on the shared pixel", () => {
    expect(rows.map((r) => r.y)).toEqual([417, 441]);
    expect(hit(10, 416)).toBe(-1);
    expect(hit(10, 417)).toBe(0);
    expect(hit(10, 440)).toBe(0);
    expect(hit(10, 441)).toBe(1);
    expect(hit(10, 465)).toBe(1);
    expect(hit(10, 466)).toBe(-1);
  });
  it("is bounded by the box width (text width + 4, even) starting at x = 6", () => {
    expect(hit(5, 420)).toBe(-1);
    expect(hit(6, 420)).toBe(0);
    expect(hit(6 + rows[0].width - 1, 420)).toBe(0);
    expect(hit(6 + rows[0].width, 420)).toBe(-1);
  });
  it("is tested at the click point (mouse + hotspot offset), not at the mouse position", () => {
    // the arrow tip is 12 px above and 9 px left of the mouse: tip on row 0 (y 437) = mouse y 449 = inside row 1
    const { dx, dy } = hotspotOffset(0);
    expect([dx, dy]).toEqual([-9, -12]);
    const mouse = { x: 40, y: 449 };
    expect(hit(mouse.x, mouse.y)).toBe(1);
    expect(hit(mouse.x + dx, mouse.y + dy)).toBe(0);
  });
});

describe("menu row style", () => {
  it("pressed = white, no shadow, moved by (1,1); normal = yellow with shadow; no hover state", () => {
    expect(rowStyle(true, 65504)).toEqual({ dx: 1, dy: 1, shadow: false, fill: 0xffff });
    expect(rowStyle(false, 65504)).toEqual({ dx: 0, dy: 0, shadow: true, fill: 65504 });
    const rows = buildMenu([entry(1, "abc")], [false], m6, 0, 0, 0);
    const p = new MenuPointer(rows);
    expect(p.update(8, 5, false).pressed).toBe(-1); // hovering only: nothing highlighted
  });
});

describe("lip sync", () => {
  it("without a voice: one step per character through the 10-value cycle, length strlen/10", () => {
    const l = lipWithoutVoice("abcdefghijkl", tables);
    expect(l.steps).toBe(12);
    expect(l.frames.slice(0, 11)).toEqual([0, 2, 4, 3, 1, 2, 4, 3, 1, 3, 0]);
    expect(l.seconds).toBeCloseTo(1.2, 5);
  });
  it("with a voice: two closed steps, the table's runs, ten closed steps; length = the sound's", () => {
    const a = lipWithVoice("A", 1.5, tables);
    expect(a.frames).toEqual([0, 0, 4, 4, ...Array(10).fill(0)]);
    expect(a.steps).toBe(14);
    expect(a.seconds).toBe(1.5);
  });
  it("reads the table with a signed char (high bytes index below it)", () => {
    const seen: number[] = [];
    lipWithVoice("ę", 1, { ...tables, lipPair: (c) => (seen.push(c), [0, 1]) });
    expect(seen).toEqual([0x91 - 256]);
  });
  it("step interval is seconds / (steps * pace) in single precision", () => {
    const l = lipWithoutVoice("x".repeat(40), tables);
    expect(stepInterval(l, PACE_TALK)).toBe(Math.fround(l.seconds / Math.fround(Math.fround(40) * PACE_TALK)));
  });
});

// --- controller -----------------------------------------------------------------------------

const face = (name: string): Face => ({ name, face: "F.PBM", eyesPos: [1, 2], eyes: ["E1", "E2", "E3"], mouthPos: [3, 4], mouth: ["M1", "M2", "M3", "M4", "M5"] });
const dcn = (): Dcn => ({
  entries: [entry(10, "Czesc", 120), entry(900, "pierwsza", 100), entry(901, "druga dluzsza", 100), entry(902, "x", 100)],
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
    expect(c.faceView("R")).toMatchObject({ slot: 0, source: "resource", face: { face: "FACEJ.PBM", eyesPos: [0x22, 0x30], mouthPos: [0x23, 0x48] } });
    expect(c.faceView("R")!.face.mouth[4]).toBe("USJA5.PBM");
    c.showFace("JACKWOJ", "L", true);
    expect(c.faceView("L")).toMatchObject({ slot: 1, mirrored: false, face: { face: "FACEJAW.PBM", eyes: ["OJAW1.PBM", "OJAW2.PBM", "OJAW3.PBM"] } });
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
    const dedupe = <T,>(a: T[]) => a.filter((v, i) => i === 0 || v !== a[i - 1]);
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
