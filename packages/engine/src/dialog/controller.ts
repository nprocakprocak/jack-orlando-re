// State of the conversation layer: faces, the spoken line, the answer menu. Pure logic: the host
// feeds it commands (TALK, DIALOG, SHOWFACE...), logic ticks, frames and the mouse, and draws what
// it exposes (`caption`, `menu`, `faceView`).

import { findDialog, findTalkLine, FIRST_FACE, type Dcn, type DcnEntry, type Face, voiceName } from "../formats/dialog";
import { placeCaption, placePersonCaption, type Caption, type CaptionColors, type Measure } from "./caption";
import { lipWithoutVoice, lipWithVoice, PACE_ANSWER, PACE_TALK, stepInterval, type Lip } from "./lipsync";
import { buildMenu, menuTop, MenuPointer, visibleCount, type MenuRow } from "./menu";
import type { DialogTables } from "./tables";

export type Side = "L" | "R";
/** LEFT / RIGHT = the face windows; a point = a caption above a person or Jack (center x, top y - 10 of its sprite). */
export type Speaker = "LEFT" | "RIGHT" | { x: number; y: number };

export const NO_FACE = -1;
const frames = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}.PBM`);
/**
 * Face slots 0 and 1 are not in the .FCC: Game_Main loads them from RESOURCE.PAK with
 * positions set in code. SHOWFACE finds them by name before the scene's faces (Script_FindFace
 * searches from slot 0).
 */
export const BUILTIN_FACES: readonly Face[] = [
  { name: "JACK", face: "FACEJ.PBM", eyesPos: [0x22, 0x30], eyes: frames("OCJA", 3), mouthPos: [0x23, 0x48], mouth: frames("USJA", 5) },
  { name: "JACKWOJ", face: "FACEJAW.PBM", eyesPos: [0x25, 0x2d], eyes: frames("OJAW", 3), mouthPos: [0x23, 0x47], mouth: frames("UJAW", 5) },
];
/** DIALOG answers are spoken on mixer channel 1 (LEFT) / 2 (everything else), as TALK LEFT / RIGHT. */
export const voiceChannel = (side: Side) => (side === "L" ? 1 : 2);
const CAPTION_Y = 0x8c;
const BLINK_EVERY = { L: 0x96, R: 0xa0 } as const;
const BLINK_LENGTH = 0x19;

export interface DialogHost {
  /** Sound_PlayTalk: plays <name>.S22 of the scene on `channel`; length in seconds, null = no such file. */
  playVoice(channel: number, file: string): number | null;
  /** end of a line: Snd_StopChannel of channels 1..4 that were started by a line */
  stopVoices(): void;
  /** the macro that waits for the line / the answer may go on (macro index given to talk / startDialog) */
  resume(macro: number): void;
}

export interface FaceView {
  /** game face index: 0 JACK, 1 JACKWOJ, else position in the .FCC + 2 */
  slot: number;
  face: Face;
  /** where the face's PBM files are: RESOURCE.PAK (slots 0, 1) or the scene's PHK */
  source: "resource" | "scene";
  /** the left window is drawn mirrored unless SHOWFACE had a '*' */
  mirrored: boolean;
  /**
 * Mouth frame 0..4 drawn over the face, null = none since SHOWFACE. The game never redraws the
 * window at the end of a line, so the last frame stays.
 */
  mouth: number | null;
  /**
 * Eye frames (0..2) drawn over the face since its last redraw, oldest first (keyed blits over
 * each other; a repeated frame covers its earlier copy, so each appears once). An idle blink
 * draws over the window as it is and its last frame stays; a talking step redraws the face.
 */
  eyes: number[];
}

interface SideState {
  slot: number;
  mirrored: boolean;
  mouth: number | null;
  eyes: number[];
  idleCounter: number;
  idleBlink: number; // -1 = none, else frame counter 0..24
}

interface ActiveLine {
  side: Side;
  noFace: boolean;
  lip: Lip;
  interval: number;
  nextStep: number;
  counter: number;
  n: number;
  blink: number; // -1 = none, else step 0..4
  resumeMacro: number | null;
}

export interface MenuState {
  dialog: number;
  rows: MenuRow[];
  /** highlighted row (position in `rows`) or -1 */
  pressed: number;
}

export interface DialogOptions {
  host: DialogHost;
  tables: DialogTables;
  /** width of a text in the caption font (JACK) */
  measure: Measure;
  /** the interpreter's `answers` map (g_dialogAnswers) */
  answers: Map<number, number>;
}

export class DialogController {
  dcn: Dcn | null = null;
  faces: Face[] = [];
  /** option hidden flags (+0x116) by entry index; SETDIALOG */
  private hidden: boolean[] = [];
  scrollX = 0;
  scrollY = 0;
  /**
 * Jack wears the uniform (g_jackUniform - a uniform flag, not a gun; script variable
 * JACKISWOJ): SHOWFACE of JACK shows JACKWOJ. Set by EXTRA 6 (Script_ExecStep case 0x24 ->
 *, SC105 [BRANIE-MUNDUR.PBM]), cleared by EXTRA 8 (unused in scripts) and on load.
 */
  jackUniform = false;
  /** DialogOnOff (g_dialogTextOn): off hides the captions, not the answer menu */
  textOn = true;
  /** [kolor_liter] of the scene (g_textColors) */
  textColors: number[];

  caption: Caption | null = null;
  menu: MenuState | null = null;
  private menuPointer: MenuPointer | null = null;
  private menuMacro = 0;
  private menuSpeaker: Side = "L";

  private sides: Record<Side, SideState | null> = { L: null, R: null };
  private line: ActiveLine | null = null;
  /** HIDEFACEAT (case 0x5e: = side, = 1): the hide waits for the end of the line. */
  private pendingHide: Side | null = null;

  constructor(private readonly o: DialogOptions) {
    this.textColors = [...o.tables.textColors];
  }

  /** Scene_LoadDcn / Scene_LoadFcc: the previous scene's faces and menu are gone, flags cleared. */
  loadScene(dcn: Dcn | null, faces: Face[] | null): void {
    this.dcn = dcn;
    this.faces = faces ?? [];
    this.hidden = (dcn?.entries ?? []).map(() => false);
    this.sides = { L: null, R: null };
    this.line = null;
    this.pendingHide = null;
    this.caption = null;
    this.menu = null;
    this.menuPointer = null;
  }

  get talking(): boolean {
    return this.line !== null;
  }

  // --- faces -------------------------------------------------------------------------------

  /** Face of a slot: BUILTIN_FACES, then the scene's .FCC. */
  private faceAt(slot: number): Face {
    return slot < FIRST_FACE ? BUILTIN_FACES[slot] : this.faces[slot - FIRST_FACE];
  }

  /**
 * SHOWFACE name L|R [*] (Script_ExecStep case 0x17 -> Face_Show). Returns false for an
 * unknown name. In the uniform (jackUniform), JACK becomes JACKWOJ and the star is dropped.
 */
  showFace(name: string, side: Side, star: boolean): boolean {
    let slot = [...BUILTIN_FACES, ...this.faces].findIndex((f) => f.name === name);
    if (slot < 0) return false;
    if (this.jackUniform && slot === 0) [slot, star] = [1, false];
    this.sides[side] = { slot, mirrored: side === "L" && !star, mouth: null, eyes: [], idleCounter: this.sides[side]?.idleCounter ?? 0, idleBlink: -1 };
    return true;
  }

  /** HIDEFACE (not decompiled; hypothesis: the window is cleared and the slot becomes "none"). */
  hideFace(side: Side): void {
    this.sides[side] = null;
  }

  /**
 * HIDEFACEAT (`Script_ExecStep` case 0x5e): only arms a flag; `Talk_FaceStep` (its tail) hides the
 * window once no line is active (`g_talkActive == 0`) — so `TALK LEFT +` followed by `HIDEFACEAT L` lets the
 * line be spoken first. One shared flag: a second HIDEFACEAT before it fires replaces the side.
 */
  hideFaceAt(side: Side): void {
    this.pendingHide = side;
  }

  faceView(side: Side): FaceView | null {
    const s = this.sides[side];
    if (!s) return null;
    const source = s.slot < FIRST_FACE ? "resource" : "scene";
    return { slot: s.slot, face: this.faceAt(s.slot), source, mirrored: s.mirrored, mouth: s.mouth, eyes: [...s.eyes] };
  }

  /** Caption colour of the speaker in a window: slots < 2 and no face use the default (white). */
  private speakerColor(side: Side): CaptionColors {
    const slot = this.sides[side]?.slot ?? NO_FACE;
    const c = this.o.tables.speakerColors;
    return { outline: this.textColors[4], fill: slot < 2 ? c[0] : (c[slot] ?? c[0]) };
  }

  // --- lines -------------------------------------------------------------------------------

  /** TALK speaker line channel wait: false when the line does not exist. `wait` '-' = the macro waits for the end. */
  talk(speaker: Speaker, lineId: number, channel: number, wait: "-" | "+", macro: number): boolean {
    const i = this.dcn ? findTalkLine(this.dcn, lineId) : -1;
    if (!this.dcn || i < 0) return false;
    this.startLine(speaker, this.dcn.entries[i], channel, PACE_TALK, wait === "-" ? macro : null);
    return true;
  }

  /** TALKRANDOM (`index` drawn by the host, 0..count-1) / TALKRANDOMINDEX: option `index` of the block. */
  talkOption(speaker: Speaker, dialogId: number, index: number, channel: number, wait: "-" | "+", macro: number): boolean {
    const d = this.dcn ? findDialog(this.dcn, dialogId) : -1;
    if (!this.dcn || d < 0) return false;
    const dlg = this.dcn.dialogs[d];
    this.startLine(speaker, this.dcn.entries[dlg.first + index], channel, PACE_ANSWER, wait === "-" ? macro : null);
    return true;
  }

  private startLine(speaker: Speaker, e: DcnEntry, channel: number, pace: number, resumeMacro: number | null): void {
    this.caption = null;
    const dur = this.o.host.playVoice(channel, voiceName(e.sound));
    const lip = dur === null ? lipWithoutVoice(e.text, this.o.tables) : lipWithVoice(e.text, dur, this.o.tables);
    const interval = stepInterval(lip, pace);
    const input = { measure: this.o.measure, text: e.text, width: e.width, scrollX: this.scrollX };
    const side: Side = speaker === "RIGHT" ? "R" : "L";
    if (this.textOn) {
      const colors = { leftColor: this.speakerColor("L"), rightColor: this.speakerColor("R") };
      if (speaker === "LEFT") this.caption = placeCaption({ ...input, ...colors }, this.scrollX, CAPTION_Y);
      else if (speaker === "RIGHT") this.caption = placeCaption({ ...input, ...colors }, this.scrollX + 0x280, CAPTION_Y);
      else this.caption = placePersonCaption(input, speaker.x, speaker.y, { outline: this.textColors[4], fill: this.textColors[5] });
    }
    this.line = { side, noFace: typeof speaker !== "string", lip, interval, nextStep: interval, counter: 0, n: 0, blink: -1, resumeMacro };
  }

  /** 15 ms logic tick: the line's clock runs. */
  tick(): void {
    if (this.line) this.line.counter++;
  }

  /**
 * One game frame: a step of the talking face when its clock has reached the next step
 *, and the idle blinking of the faces. `skip` = the player clicked (g_clickArmed),
 * which ends the line at its next step.
 */
  frame(skip = false): void {
    const l = this.line;
    if (l && l.nextStep <= l.counter) {
      this.step(l, skip);
      if (this.line === l) l.nextStep = Math.fround(l.nextStep + l.interval);
    }
    if (!this.line && this.pendingHide) {
      const side = this.pendingHide;
      this.pendingHide = null;
      this.hideFace(side);
    }
    this.idleBlink("L");
    this.idleBlink("R");
  }

  private step(l: ActiveLine, skip: boolean): void {
    const s = this.sides[l.side];
    if (!l.noFace) {
      if (!s) return this.endLine(l); // no face in the speaking window: the line ends at once
      // the window is redrawn: face, mouth, the blink frame
      s.mouth = l.lip.frames[l.n] % 5;
      s.eyes = [];
      if (l.n % 100 === 0) l.blink = 0;
      if (l.blink >= 0) {
        s.eyes = [this.o.tables.blinkOrder[l.blink]];
        if (++l.blink === 5) l.blink = -1;
      }
    }
    l.n = skip ? 10000 : l.n + 1;
    if (l.n >= l.lip.steps) this.endLine(l);
  }

  private endLine(l: ActiveLine): void {
    this.line = null;
    this.caption = null;
    this.o.host.stopVoices();
    if (l.resumeMacro !== null) this.o.host.resume(l.resumeMacro);
  }

  /** Idle blink in Game_Run: every 160 (right) / 150 (left) frames, 25 frames long, not while that window talks; drawn over the window, the last frame stays. */
  private idleBlink(side: Side): void {
    const s = this.sides[side];
    if (!s) return;
    const talking = this.line?.side === side;
    if (++s.idleCounter % BLINK_EVERY[side] === 0) s.idleBlink = 0;
    if (s.idleBlink >= 0 && !talking) {
      const e = this.o.tables.blinkOrder[Math.trunc(s.idleBlink / 5)];
      s.eyes = [...s.eyes.filter((x) => x !== e), e];
      if (++s.idleBlink === BLINK_LENGTH) s.idleBlink = -1;
    }
  }

  // --- answer menu ---------------------------------------------------------------------------

  /** SETDIALOG dialog option state: hidden = (state == 0). */
  setDialogOption(dialogId: number, option: number, state: number): void {
    const d = this.dcn ? findDialog(this.dcn, dialogId) : -1;
    if (!this.dcn || d < 0) return;
    this.hidden[this.dcn.dialogs[d].first + option] = state === 0;
  }

  /** DIALOG speaker dialog: opens the menu; the macro stays stopped until `pointer` chooses an answer and the answer is spoken. */
  startDialog(speaker: string, dialogId: number, macro: number): boolean {
    const d = this.dcn ? findDialog(this.dcn, dialogId) : -1;
    if (!this.dcn || d < 0) return false;
    this.caption = null;
    const dlg = this.dcn.dialogs[d];
    const hidden = this.hidden.slice(dlg.first, dlg.first + dlg.count);
    const top = menuTop(visibleCount(hidden, dlg.count));
    const rows = buildMenu(this.dcn.entries.slice(dlg.first, dlg.first + dlg.count), hidden, this.o.measure, this.scrollX, this.scrollY, top);
    this.menuPointer = new MenuPointer(rows);
    this.menu = { dialog: dialogId, rows, pressed: -1 };
    this.menuMacro = macro;
    this.menuSpeaker = speaker === "LEFT" ? "L" : "R";
    return true;
  }

  /**
 * Click point (g_clickX/Y = mouse + hotspot offset, `Cursor.clickPoint`) over the open menu in world pixels. When a row is chosen the answer is stored
 * (`answers.set(dialog, original index)`) and the answer line is spoken - the macro resumes
 * when it ends. Returns the chosen option index.
 */
  pointer(worldX: number, worldY: number, down: boolean): number | undefined {
    if (!this.menu || !this.menuPointer || !this.dcn) return undefined;
    const r = this.menuPointer.update(worldX, worldY, down);
    this.menu.pressed = r.pressed;
    if (r.chosen === undefined) return undefined;
    const { dialog } = this.menu;
    this.menu = null;
    this.menuPointer = null;
    this.o.answers.set(dialog, r.chosen);
    const dlg = this.dcn.dialogs[findDialog(this.dcn, dialog)];
    this.startLine(this.menuSpeaker === "L" ? "LEFT" : "RIGHT", this.dcn.entries[dlg.first + r.chosen], voiceChannel(this.menuSpeaker), PACE_ANSWER, this.menuMacro);
    return r.chosen;
  }
}
