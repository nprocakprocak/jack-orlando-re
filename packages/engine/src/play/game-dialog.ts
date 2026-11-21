// The scene dialog, the caption timer, and Jack's refusal.

import { DialogController, encodeMazovia, type DialogHost } from "../dialog";
import { parseSceneDialogs, type Dcn } from "../formats/dialog";
import { textWidth } from "../formats/fnt";
import type { Pak } from "../formats/pak";
import type { Interpreter } from "../script";
import type { SceneHost } from "./host";
import { jackRefusal } from "./predicates";
import type { GameState } from "./game-state";

/** A DialogController for the scene: its faces and lines (.DCN.FCC), the options, the uniform of Jack that outlives scenes. */
export function makeDialog(
  this: GameState,
  name: string,
  phk: Pak,
  it: Interpreter,
  host: SceneHost,
): DialogController {
  const assets = this.dialogAssets!;
  if (this.dialog) this.jackUniform = this.dialog.jackUniform;
  const dhost: DialogHost = {
    playVoice: (channel, file) => this.audio.playVoice(channel, file),
    stopVoices: () => {
      this.audio.stopVoices();
      this.audio.duckMusic(false);
    },
    resume: (macro) => host.talkEnded(macro),
  };
  const d = new DialogController({
    host: dhost,
    tables: assets.tables,
    measure: (t) => textWidth(assets.font, encodeMazovia(t)),
    answers: it.answers,
  });
  const { dcn, fcc } = parseSceneDialogs(phk, name);
  d.loadScene(dcn, fcc);
  d.textOn = this.audio.config.dialogText;
  d.jackUniform = this.jackUniform;
  this.faceWindows.L = this.faceWindows.R = null;
  this.faceImages.clear();
  return d;
}

/**
 * A caption stays at most `strlen * 3 + 200` logic ticks (Script_ExecStep case 10 sets, Game_TimerTick
 * counts it down, Game_Run calls Caption_Hide at 0): a long voice outlasts it, the line goes on without text.
 */
export function captionTimer(this: GameState): void {
  const cap = this.dialog?.caption ?? null;
  if (cap !== this.captionSeen) {
    this.captionSeen = cap;
    this.captionHidden = false;
    this.captionScroll = this.scene?.scrollX ?? 0;
    if (cap) this.captionTicks = cap.lines.map((l) => l.text).join(" ").length * 3 + 200;
  }
  if (cap && this.captionTicks > 0 && --this.captionTicks === 0) this.captionHidden = true;
}

/**
 * Jack_RefuseAction (Game_Run tail): the item was used on a target that has neither `<item>-X` nor `PIERDOLA-X`.
 * Not while a refusal is still spoken. The click is spent; Jack's face opens in the window on the side
 * away from the click (the click to the right of the middle of the screen: the left window, voice channel 1), the next
 * of three lines (the counter + 1 mod 3: the first refusal of a game is the second line) is said with
 * the voice `N0n0.S22` and the width of the caption from the table. The item stays in hand.
 */
export function jackRefuses(this: GameState, clickX: number): void {
  const d = this.dialog;
  const sc = this.scene;
  if (!d || !sc || !this.refusals) return this.addLog("Jack: odmowa (bez warstwy dialogów)");
  if (this.refusal && d.talking) return;
  if (this.bar?.isOpen) return; // Jack_RefuseAction: only with the bar closed (g_topBarOpen == 0)
  this.armed = false;
  const r = jackRefusal(this.refusalCounter, clickX, sc.scrollX);
  this.refusalCounter = r.index;
  const line = this.refusals[r.index];
  d.showFace("JACK", r.side, false);
  // the line is not in the scene's .DCN: a one-entry table stands in for it while the controller starts the line
  const saved = d.dcn;
  const dcn: Dcn = {
    entries: [{ id: 0, text: line.text, width: line.width, sound: line.voice }],
    dialogs: [{ id: 0, kind: "R", first: 0, count: 1 }],
  };
  d.dcn = dcn;
  d.talkOption(r.side === "L" ? "LEFT" : "RIGHT", 0, 0, r.channel, "+", 0);
  d.dcn = saved;
  this.refusal = { side: r.side };
}

/** Talk_FaceStep: when the refusal ends, Jack's window closes. */
export function refusalFrame(this: GameState): void {
  if (!this.refusal || this.dialog?.talking) return;
  this.dialog?.hideFace(this.refusal.side);
  this.refusal = null;
}
