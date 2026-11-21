// One logic tick, and the order of its phases.

import {
  jackShadow,
  SHADOW_OFFSET_STILL_X,
  SHADOW_OFFSET_STILL_Y,
  SHADOW_SCALE_MAX,
  shadowDirIndex,
  stepVolumes,
  type ShadowSprite,
  type SoundEvent,
} from "../anim";
import { placeTurnFrame, turnFrameTicks, turnSequence, turnShadow, TurnPlayer, type TurnFrame, type TurnTick } from "../anim/turn";
import { parseSfb, type HotSpot } from "../formats/global";
import { alignScroll, scrollLimits, scrollTick } from "../render";
import { stepTicks, walkStep } from "../walk";
import { turningTick } from "../walk/turn";
import { jackImage } from "./decode";
import { animImage, stepFlx } from "./player-objects";
import { applyPerson, arrangeJack, personEnv, tickPersons } from "./player-persons";
import { drawJackShadow } from "./player-shadow";
import type { ScenePlayerState, TickResult } from "./player-state";
import { followScroll, walkScrollDirection } from "./scroll";

// --- the tick -----------------------------------------------------------------------------

/** One 15 ms logic tick: Jack (walk step + frame), persons, object animations, camera. */
export function tick(this: ScenePlayerState): TickResult {
    this.ticks++;
    this.events = [];
    const result: TickResult = { stepped: false, arrived: false, sounds: [], personSounds: [] };
    this.jackFresh = false;
    this.freshPersons.clear();
    jackPhase.call(this, result);
    tickPersons.call(this, result);
    for (const o of this.objects) {
      if (!o.anim) continue;
      const due = o.anim.active && o.anim.counter - 1 <= 0;
      const at = animImage.call(this, o);
      const t = o.anim.tick();
      if (o.flx) {
        if (t.frame) stepFlx.call(this, o);
        continue;
      }
      if (due) this.events.push({ kind: "animFrame", anim: o.name, image: at, rec: o.anim.rec, flx: false });
      if (t.frame && o.pbm16 && !o.visible) this.drawObject(o);
      if (t.frame?.changed) {
        o.frameFile = t.frame.file;
        o.light = 1;
        o.frameDx = t.frame.dx;
        o.frameDy = t.frame.dy;
        if (o.visible) this.drawObject(o);
      }
      if (t.stopped) this.events.push({ kind: "animEnded", anim: o.name, reason: t.stopped });
    }
    if (this.scripted) {
      if (this.bgWide) this.scrollX = scrollTick(this.scrollX, this.scrollDir, this.scrollMin, this.scrollMax);
    } else {
      this.scrollX = followScroll(this.scrollX, this.walker.x, this.bgWidth);
    }
    return result;
}

/** Game_Run steps 26-28: Jack's turn, walk step or insertion frame of this tick. */
function jackPhase(this: ScenePlayerState, result: TickResult): void {
    this.jack.scrollX = this.scrollX;
    if (this.turnEndedPending) {
      this.turnEndedPending = false;
      this.events.push({ kind: "jackTurnEnded" });
    }
    if (this.tj.turn && this.jack.mode !== "insertion") turnTick.call(this, result);
    else this.jackTick(result);
    if (result.arrived) {
      this.walker.forced = null;
      this.apply(this.jack.stand(this.pose()));
      this.events.push({ kind: "jackArrived" });
    }
    if (result.stepped) {
      arrangeJack.call(this);
      if (this.scripted) scrollRule.call(this);
    }
}

/**
 * The first steps of the operations a command (or a click) just started, in the frame of the command: Game_Run runs the
 * interpreter (step 20) before steps 26-31 of the same frame, and WALKTO / RUNINSERTION JACK, INITFIRST and STAY with a turn
 * zero their step counters, so the first walk step or insertion frame needs no timer tick. The
 * counters are not decremented here (that is Game_TimerTick's job). Returns null when nothing was started.
 */
export function firstSteps(this: ScenePlayerState): TickResult | null {
    if (!this.jackFresh && this.freshPersons.size === 0) return null;
    this.events = [];
    const result: TickResult = { stepped: false, arrived: false, sounds: [], personSounds: [] };
    if (this.jackFresh) {
      this.jackFresh = false;
      this.jack.delay++; // the animator decrements first
      jackPhase.call(this, result);
    }
    if (this.freshPersons.size > 0) {
      const env = personEnv.call(this);
      const fresh = [...this.freshPersons].sort((a, b) => a - b);
      this.freshPersons.clear();
      for (const i of fresh) {
        const p = this.persons.persons[i];
        if (!p.insertionDue) continue;
        applyPerson.call(this, i, p.insertionStep(env), result);
      }
    }
    return result;
}

/** Jack's frame or step of this tick when no turn runs (the walk, an insertion, nothing). */
export function jackTick(this: ScenePlayerState, result: TickResult): void {
    const tj = this.tj;
    const inserting = this.jack.mode === "insertion";
    // g_jackIdleIns: an idle insertion draws no shadows (the shadow step of tests it next to g_shadowsOn); the option itself is untouched
    const shadowsOn = this.jack.shadowsOn;
    if (this.idleIns) this.jack.shadowsOn = false;
    const r = this.jack.tick(this.pose(), () => {
      // g_jackInsDelay is the one counter of frames and steps ("Czas"): the step
      // runs exactly when the animator's delay runs out, walkTick's own timer is not used.
      const w = this.walker;
      const old = { dir: w.dir, mirror: w.mirror };
      const walking = (w.walking || tj.moving) && !tj.pointRotate && !tj.uniform;
      const ev = walkStep(w, this.world);
      if (this.fixedScale !== null) w.scale = this.fixedScale;
      result.stepped = true;
      this.idleFrames = 0; // Game_Run: every walk step zeroes g_idleFrames
      if (this.jackAvoiding) this.jack.delay = 2; // Jack_AvoidPerson: the step counter is 2 while he avoids a person
      if (ev.arrived) {
        result.arrived = true;
        this.jackAvoiding = false;
        tj.pointRotate = tj.pointRotateSaved;
        tj.moving = false;
      }
      if (ev.nextPoint) {
        this.jack.delay = 0; // next segment: no movement now, step again at once
        // Game_Run: the new segment may turn Jack (a corner of the path)
        if (w.dir !== old.dir || w.mirror !== old.mirror) {
          tj.moving = true;
          const steps = turnSequence(old.dir, old.mirror, w.dir, w.mirror, walking);
          if (steps.length > 0) {
            tj.turn = new TurnPlayer(steps, tj.uniform);
            this.turnFromScript = false; // Jack_TurnFromTo clears g_turnMacroWaits
          }
        }
      }
      return this.pose();
    });
    this.jack.shadowsOn = shadowsOn;
    if (r.update.insertionEnded !== undefined && r.update.insertionGlobal) this.idleIns = false; // Game_Run: the end of a global insertion
    // a turn begun by this step draws its own frames from the next tick on
    if (!tj.turn && (!this.jackHidden || r.update.sprite)) this.apply(r.update);
    result.sounds = r.update.sounds;
    // Game_Run: after the frame of an insertion Jack is arranged against the sprites it overlaps, but with the two
    // edge tests only (no Depth_QuadAllBelow / Above). SC087: POVERE JACK GZYMS.PBM before the blow is undone by the first frame
    // (Jack stands above every edge of the ledge quad), so the guard's body in the last frame goes under the ledge.
    if (inserting && r.update.sprite && !this.jackHidden) arrangeJack.call(this, true);
    if (r.update.insertionEnded !== undefined) this.events.push({ kind: "jackInsertionEnded", name: r.update.insertionEnded, global: r.update.insertionGlobal === true });
    else if (inserting && r.update.sprite && this.insReleaseEarly) {
      // Game_Run: a frame was drawn while was set (INITFIRST): the insertion stops, the flag is spent
      this.jack.mode = "stand";
      this.insReleaseEarly = false;
      this.events.push({ kind: "jackInsertionReleased" });
    }
}

/**
 * A tick with a turn running: the turn gets Jack's timer and the walk does not step. The frame is
 * drawn with the hot spot of its SFB table at the position Jack had when it fell due, the shadow comes from
 * `turnShadow`, the end of a walking turn shifts Jack.
 */
function turnTick(this: ScenePlayerState, result: TickResult): void {
    const w = this.walker;
    const tj = this.tj;
    const at = { x: w.x, y: w.y, scale: w.scale };
    // turningTick counts walker.timer; the game has one counter (g_jackInsDelay), kept in the animator
    w.timer = this.jack.delay;
    const t = turningTick(tj, this.world, stepTicks(this.walkSpeedOption), turnFrameTicks(this.walkSpeedOption, this.jack.frameDelay));
    this.jack.delay = w.timer;
    const turn: TurnTick | null = t.turn;
    if (turn?.frame && !this.jackHidden) {
      drawTurnFrame.call(this, turn.frame, at);
      arrangeJack.call(this);
    }
    if (turn?.stepSound) result.sounds.push(turnStep.call(this, at));
    if (tj.walkFrame !== null) {
      this.jack.walkFrame = tj.walkFrame;
      tj.walkFrame = null;
    }
    if (turn?.done) {
      if (this.turnFromScript) this.events.push({ kind: "jackTurnEnded" });
      this.turnFromScript = false;
    }
}

/** Jack_PlayStep for the step sound of a turn (frame 2 of its first animation). */
function turnStep(this: ScenePlayerState, at: { x: number; scale: number }): SoundEvent {
    const [v1, v2] = stepVolumes(at.scale, at.x, this.scrollX);
    this.turnStepToggle = !this.turnStepToggle;
    return { sound: this.turnStepToggle ? "KROK1.SND" : "KROK2.SND", channels: [2, 1], volumes: [v2, v1], kind: "step" };
}

function hotSpot(this: ScenePlayerState, ref: { file: string; index: number }): HotSpot {
    let table = this.hotSpots.get(ref.file);
    if (!table) {
      table = parseSfb(this.src.resource.read(ref.file));
      this.hotSpots.set(ref.file, table);
    }
    return table[ref.index];
}

/** the turn frame, and its shadow. */
function drawTurnFrame(this: ScenePlayerState, f: TurnFrame, at: { x: number; y: number; scale: number }): void {
    const [x, y] = placeTurnFrame(at.x, at.y, hotSpot.call(this, f.hotSpot), f.facing, f.scale);
    const img = jackImage.call(this, "resource", f.file);
    this.renderer.set(this.jackId, x, y, img, f.facing < 0 ? -f.scale : f.scale);
    const sh = turnShadow(f.anim, f.frame, f.facing, at.x, at.y, at.scale);
    if (!sh) return;
    let s: ShadowSprite;
    if (sh.kind === "walk") {
      s = jackShadow({
        index: 0, dir: this.walker.dir, facing: this.walker.mirror, x: sh.x, y: sh.y, walkFrame: sh.frame,
        directional: false, twoShadows: false, scale: at.scale, shadowScale: this.jack.shadowScale,
      });
    } else {
      // SHROT mask of the frame: the anchor offsets of Jack_DrawShadow for p7 != -1 are not known, the still ones of dir 0 stand in
      const i8 = shadowDirIndex(0, sh.facing);
      const k = Math.min(at.scale * this.jack.shadowScale, SHADOW_SCALE_MAX);
      s = {
        index: 0, file: sh.file!, round: false, scale: k, mirrored: sh.facing < 0,
        x: Math.trunc(sh.x - SHADOW_OFFSET_STILL_X[i8] * k), y: Math.trunc(sh.y - SHADOW_OFFSET_STILL_Y[i8] * k),
      };
    }
    drawJackShadow.call(this, 0, s);
    this.renderer.hide(this.shadowIds[1]);
}

/** Game_Run: Jack's step starts a scroll when he and his goal are outside the margin. */
function scrollRule(this: ScenePlayerState): void {
    const w = this.walker;
    if (!w.walking) return;
    const goal = w.path.length ? w.path[w.path.length - 1].x : w.target.x;
    this.scrollDir = walkScrollDirection(this.scrollDir, w.x, goal, this.scrollX, this.marginL, this.marginR);
}

/** SETSHIFTX: scroll position (alignScroll: multiple of 4, 0..376). */
export function setScroll(this: ScenePlayerState, x: number): void {
    this.scrollX = alignScroll(x);
}

/** SETSCROLLX1 / SETSCROLLX2 */
export function setScrollLimits(this: ScenePlayerState, min: number | null, max: number | null): void {
    const [lo, hi] = scrollLimits(min ?? this.scrollMin, max ?? this.scrollMax);
    this.scrollMin = lo;
    this.scrollMax = hi;
}

export function initialScroll(this: ScenePlayerState, x: number): number {
    let s = this.scene.ccg.wide ? Math.max(0, Math.min(this.scene.ccg.scroll, this.bgWidth - 640)) : 0;
    for (let i = 0; i < 300; i++) {
      const n = followScroll(s, x, this.bgWidth);
      if (n === s) break;
      s = n;
    }
    return s;
}

export function scriptedStartScroll(this: ScenePlayerState): number {
    return this.scene.ccg.wide ? alignScroll(Math.max(0, Math.min(this.scene.ccg.scroll, this.bgWidth - 640))) : 0;
}

export function centroid(this: ScenePlayerState): { x: number; y: number } {
    const t = this.scene.ccg.walk[0];
    if (!t) return { x: 320, y: 240 };
    return { x: Math.trunc((t[0] + t[2] + t[4]) / 3), y: Math.trunc((t[1] + t[3] + t[5]) / 3) };
}
