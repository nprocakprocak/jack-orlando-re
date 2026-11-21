// The M1 scene: background, objects, Jack standing at jackStart and walking after a click.
// Glue only - parsing (formats), drawing (render), animation (anim) and path finding (walk)
// are the finished modules. No DOM: the host feeds it clicks and calls tick() every
// 15 ms logic tick of EngineLoop.

import {
  JackAnimator,
  loadWalkFrames,
  ROUND_SHADOW,
  sceneInsertions,
  type AnimaArgs,
  type FrameSprite,
  type IdleChoice,
  type InsertionTable,
  type JackPose,
  type JackUpdate,
  type ObjectAnimation,
} from "../anim";
import { type HitRect, type SpriteCandidate } from "../areas";
import type { Image16 } from "../formats/bm";
import type { HotSpot, Ics } from "../formats/global";
import { jackStart, parseScene, type Scene } from "../formats/scene";
import { personDef, ScenePersons } from "../persons";
import { PersonShadow, type ShadowTables } from "../persons/shadow";
import { Renderer, SCALE_KEEP, Z_UI, type Rect } from "../render";
import { createWalker, walkWorld, type Walker, type WalkPlan, type WalkWorld } from "../walk";
import { turningJack, type TurningJack } from "../walk/turn";
import * as decode from "./decode";
import type {
  ObjectSprite,
  SceneEvent,
  SceneOptions,
  ScenePlayerState,
  SceneSources,
  TickResult,
} from "./player-state";
import * as jackBody from "./player-jack";
import * as objectBody from "./player-objects";
import * as personBody from "./player-persons";
import * as shadowBody from "./player-shadow";
import * as tickBody from "./player-tick";
import { initialScrollMax } from "./scroll";
import { approximateShadowTables, Z_SHADOW } from "./shadow";

export type { SceneEvent, SceneOptions, SceneSources, TickResult } from "./player-state";
export { decodeSceneImage } from "./decode";
export { IDLE_AFTER, IDLE_FRAMES_PER_TICK, IDLE_LIMIT, stayFacing } from "./player-jack";
export { spritePixelHit } from "./player-objects";

/** Sprite order of Jack when he is in front of everything (objects use their index as z). */
export const Z_JACK = 1000;
/**
 * z of a person's sprite when it is added (Game_Run: Sprite_Add(..., 2...)): just above the shadows (0) and
 * the objects 0 and 1, i.e. under every other object. Only the depth test and POVERE / PUNDERE move it.
 */
export const Z_PERSON = 2;

/** Scene without a walk area: nothing to walk on, scale 1. */
function emptyWorld(): WalkWorld {
  return { walk: [], objects: [], perspective: { horizonY: 0, refY: 1, refScale: 1 } };
}

// Prototype wrappers stay one call. Prettier would split them past the 400-line ceiling.
// prettier-ignore
export class ScenePlayer {
  readonly scene: Scene;
  readonly world: WalkWorld;
  readonly hasWalkArea: boolean;
  readonly renderer: Renderer;
  readonly jack: JackAnimator;
  readonly walker: Walker;
  /** Jack's turn state: the running turning animation, POINTROTATE, the uniform */
  readonly turning: TurningJack;
  readonly insertions: InsertionTable;
  readonly persons: ScenePersons;
  readonly bgWidth: number;
  readonly scripted: boolean;
  scrollX = 0;
  /** logic ticks run so far */
  ticks = 0;
  /** SceneEvents of the last tick(), cleared at its start */
  events: SceneEvent[] = [];
  /** Jack's sprites are removed (HIDE JACK) until he is drawn again */
  jackHidden = false;
  /** SETCHKPRIOR JACK (1 at scene start, Game_Run): the three depth checks of Jack in Game_Run run only when it is set */
  jackCheckDepth = true;
  /** g_sceneBrightness (BRIGHTNESS) */
  brightness = 1;
  /**
 * g_jackShadowScale (RELATIVEMULP JACK, 1.0 at scene start, Game_Run): Jack_DrawShadow multiplies Jack's scale by it in every
 * case (fade out, normal, fade in) before the 0.99 limit; it is the animator's `shadowScale`
 */
  get jackShadowScale(): number {
    return this.jack.shadowScale;
  }
  set jackShadowScale(f: number) {
    this.jack.shadowScale = f;
  }
  /**
 * g_jackBrightness: the factor of the last lit frame. Walk and insertion frames recompute it every
 * time; Jack_Stand only inside a light's range, so a standing frame outside it keeps the previous value.
 */
  private jackLight = 1;
  /**
 * Jack is stepping out of a person's way (CHKDISTANCE). Set by the avoid walk, cleared by every walk
 * started otherwise (click, WALKTO) and at the end of the path; while set his steps take 2 ticks.
 */
  jackAvoiding = false;
  /** the script locks the player (macro running): no avoiding then; the game sets it before every tick */
  playerLocked = false;
  /**
 * `g_idleFrames`: frames without input. The game owns the per-frame part
 * (`idleCount`, `idleInput`, `idleCheck`); the walk step zeroes it here. Not zeroed at a scene start.
 */
  idleFrames = 0;
  /**
 * `g_jackIdleIns`: set by the insertion branch of the idle check (also when it would start nothing: the uniform with
 * dir 2 / facing -1, a pose nothing in the game sets), cleared when a global insertion ends and at the scene start; while set, insertion frames
 * draw no shadows (Game_Run, the shadow step) and the shadows of the frame before stay where they are.
 */
  idleIns = false;
  /** the running turn was started by LOOKTO / ROTATETO: its end releases a waiting macro */
  private turnFromScript = false;
  /** a script turn ended between two ticks (cut by STAY / an insertion): reported at the start of the next tick */
  private turnEndedPending = false;
  /**
 * g_insReleaseEarly: set by INITFIRST only, cleared at the scene start. The first insertion
 * step that draws a frame after it (Jack, then persons by index: Game_Run) ends that insertion and clears
 * the flag: the macro of the actor is released without `pending - 1`. Whoever draws first takes it, not necessarily the INITFIRST's own.
 */
  insReleaseEarly = false;
  /**
 * Jack's step counter (g_jackInsDelay) was zeroed by a walk start, WALKTO, RUNINSERTION / INITFIRST or a STAY turn
 * Game_Run step 20 runs before steps 26-31, so the first step falls in the frame of the command.
 */
  private jackFresh = false;
  /** persons whose INITFIRST zeroed `g_personTimer`: the first insertion frame comes in the frame of the command */
  private readonly freshPersons = new Set<number>();
  /** alternates KROK1 / KROK2 for the step sound of a turn (the animator has its own toggle for walk frames) */
  private turnStepToggle = false;
  private readonly hotSpots = new Map<string, HotSpot[]>();
  /** g_jackFixedScale: SETPERSONDATA with f = 3.0 keeps the scale of that moment */
  fixedScale: number | null = null;

  /**
 * `g_jackShown`: 0 from the scene start (Game_Run ~l. 405), 1 after `Jack_Stand`,
 * (every `STAY`, with or without `*`), (restored pose) or a WALKTO that found it 0. An insertion
 * (INITFIRST / RUNINSERTION) does not set it, so a Jack who is on screen only from insertions still counts as "not shown".
 */
  private jackShown = false;

  /**
 * `g_jackPlaced`: 0 from the scene start; 1 only after `Jack_Stand`, a STAY or the
 * restored pose. A walk (Jack_WalkToPoint / the walk step) and SETPOSITION do not set it, so a save made while
 * Jack walks into the scene is the copy of the scene start (`Menu_Save` ;).
 */
  jackPlaced = false;

  // --- camera (Game_Run, Game_Tick14ms), scripted scenes only ---
  /** -1 / 0 / 1 */
  scrollDir = 0;
  /** g_bgWide: the background scrolls at all (SETSCROLL, otherwise the width of the image) */
  bgWide: boolean;
  scrollMin = 0;
  scrollMax = 376;
  /** /: distance from the screen edge at which a walk starts to scroll (120) */
  marginL = 120;
  marginR = 120;

  /** the WalkSpeed option (g_cfgWalkSpeed); the F4 menu changes it while the scene runs */
  private walkSpeedOption: number;

  get walkSpeed(): number {
    return this.walkSpeedOption;
  }

  /** WalkSpeed changed in the options: the original reads g_cfgWalkSpeed at every step, so Jack takes it at once
 * (not while JACKTEMPO DATA holds his speed at 0). */
  set walkSpeed(value: number) {
    const old = this.walkSpeedOption;
    this.walkSpeedOption = value;
    if (this.jack.walkSpeed === old) this.jack.walkSpeed = value;
  }
  private readonly cache = new Map<string, Image16>();
  private readonly objects: ObjectSprite[] = [];
  private readonly objectByName = new Map<string, ObjectSprite>();
  private jackId = 0;
  private shadowIds: [number, number] = [0, 0];
  private personIds: number[] = [];
  /** g_shadowsOn */
  readonly shadowsOn: boolean;
  /**
 * Jack's two shadows: the state of SETSHADOW / MINSHADOW / MAXSHADOW JACK (and, strength);
 * the fade formulas of the persons' shadows are assumed for Jack.
 */
  readonly jackShadows: [PersonShadow, PersonShadow] = [new PersonShadow(1), new PersonShadow(1)];
  private readonly shadowTables: ShadowTables;
  /** the scene background; SHADOWBY / PUTSHADOW paint on it (g_sceneBg), so it is a private copy after the first one */
  private backdrop: Image16;
  private backdropOwned = false;
  /** SHADOWONE object (g_shadowOneObject): persons' shadows are composed with the sprites up to its layer */
  private shadowOne: string | null = null;
  /** the shadow sprite of SHOWSHADOW EXTRA */
  private readonly extraShadowId: number;
  /** ANIMASHADOW: per FLX animation the shadow points to follow */
  private readonly animShadows = new Map<string, { jack: boolean; person: number; points: readonly (readonly number[])[]; step: number; clear: boolean }>();
  private readonly roundMask: Image16;
  private personShadowIds: number[] = [];
  /** SETSPECSHADOW: the image of an object is the person's shadow mask */
  private personMasks: (Image16 | null)[] = [];
  /** object z (= index) of every drawn graphic, for the depth test */
  private readonly drawnObjects = new Set<number>();
  /** sprite id of every drawn object graphic by object index */
  private readonly objectSpriteIds = new Map<number, number>();
  private readonly globalIcs: Ics | null;

  constructor(private readonly src: SceneSources, opts: SceneOptions = {}) {
    this.scripted = opts.scripted ?? false;
    this.shadowsOn = opts.shadows ?? true;
    this.shadowTables = opts.shadowTables ?? approximateShadowTables();
    this.walkSpeedOption = opts.walkSpeed ?? 1;
    this.globalIcs = src.globalIcs ?? null;
    this.scene = parseScene(src.phk, src.name);
    const world = walkWorld(this.scene);
    this.hasWalkArea = !!world && this.scene.ccg.walk.length > 0;
    if (!this.hasWalkArea && !this.scripted) throw new Error(`${src.name}: scene has no walk area`);
    this.world = world ?? emptyWorld();
    this.insertions = sceneInsertions(src.phk, src.name);
    const bg = this.image("phk", this.scene.ccg.background);
    this.bgWidth = bg.width;
    this.bgWide = this.scene.ccg.wide;
    // Scene_LoadCcg: g_bgScrollMax = width - 640 (down to a multiple of 4, at most 0x178) for a wide background
    this.scrollMax = initialScrollMax(this.bgWide, bg.width);
    this.backdrop = bg;
    this.roundMask = this.image("resource", ROUND_SHADOW);
    this.renderer = new Renderer(bg);
    this.renderer.redrawAll();
    objectBody.addObjects.call(this as unknown as ScenePlayerState, opts.animateObjects ?? !this.scripted);
    // Game_Run (bytes): counter = [] - [], min 1; g_insFrameDelay is 5
    // once a scene runs -> a step every 4 logic ticks (is right, 's "4 - WalkSpeed" is not)
    this.jack = new JackAnimator(loadWalkFrames(src.resource), { frameDelay: 5, walkSpeed: opts.walkSpeed ?? 1 });
    // g_jackX/Y are (320, 240) after Game_Run until the scripts place Jack
    const start = this.scripted ? { x: 320, y: 240 } : jackStart(this.scene, opts.lastScene ?? null) ?? tickBody.centroid.call(this as unknown as ScenePlayerState);
    this.walker = createWalker(start.x, start.y, this.world);
    this.turning = turningJack(this.walker);
    // Game_Run: the shadow sprites are added with z = 0 after the scene objects, so they lie under every object and person;
    // the depth code skips them and nothing moves them (only SHADOWONE: Sprite_MoveFront)
    this.shadowIds = [this.renderer.add(decode.BLANK, Z_SHADOW, SCALE_KEEP), this.renderer.add(decode.BLANK, Z_SHADOW, SCALE_KEEP)];
    this.jackId = this.renderer.add(this.image("resource", "SSFR2.PBM"), Z_JACK, 1);
    this.persons = new ScenePersons(this.scene.persons.map(personDef), { horizon: this.scene.ccg.perspective?.horizonY ?? 0 });
    this.persons.persons.forEach((_, i) => {
      this.personShadowIds[i] = this.renderer.add(decode.BLANK, Z_SHADOW, SCALE_KEEP);
      this.personMasks[i] = null;
      this.personIds[i] = this.renderer.add(this.image("resource", "SSFR2.PBM"), Z_PERSON, 1);
    });
    // Render_RedrawRect draws the topmost sprite only when it is a 16-bit image, so a paletted Jack on top would not
    // be redrawn over the shadow set after him. In the game the UI sprites always lie above (Z_UI); this one stays hidden.
    this.renderer.add(decode.BLANK, Z_UI + 1000, SCALE_KEEP);
    this.extraShadowId = this.renderer.add(decode.BLANK, Z_SHADOW, SCALE_KEEP);
    this.scrollX = this.scripted ? tickBody.scriptedStartScroll.call(this as unknown as ScenePlayerState) : tickBody.initialScroll.call(this as unknown as ScenePlayerState, start.x);
    if (!this.scripted) {
      this.jackShown = true; // the demo scene draws Jack standing at once (Jack_Stand)
      this.jackPlaced = true;
      this.apply(this.jack.stand(this.pose()));
      personBody.arrangeJack.call(this as unknown as ScenePlayerState);
    }
    this.retain();
  }

  /**
 * Scene_RefreshBackground: the background is copied again and the visible sprites are drawn over it with their current
 * clip rectangles and positions. CHWINDOW only writes the rectangle, so what a sprite showed at its .CCG position
 * before [PRE] clipped it would otherwise stay on the work surface (SC000 GAZE1.PBM, SC000B CARINSP.PBM); `setClip` calls this
 * while [PRE] runs (before the first tick), which gives the picture the original has when the scene starts.
 */
  refreshBackground(): void {
    this.renderer.redrawAll();
  }

  pose(): JackPose { return jackBody.pose.call(this as unknown as ScenePlayerState); }
  click(x: number, y: number): boolean { return jackBody.click.call(this as unknown as ScenePlayerState, x, y); }
  walkPlan(plan: WalkPlan, forced: number | null = null): boolean { return jackBody.walkPlan.call(this as unknown as ScenePlayerState, plan, forced); }
  walkJackTo(x: number, y: number, forcedDir: number | null = null): boolean { return jackBody.walkJackTo.call(this as unknown as ScenePlayerState, x, y, forcedDir); }
  setJackPosition(x: number, y: number): void { return jackBody.setJackPosition.call(this as unknown as ScenePlayerState, x, y); }
  setJackData(frameDelay: number, f: number, refY: number, speed: number): void { return jackBody.setJackData.call(this as unknown as ScenePlayerState, frameDelay, f, refY, speed); }
  setJackTempoFixed(fixed: boolean): void { return jackBody.setJackTempoFixed.call(this as unknown as ScenePlayerState, fixed); }
  inheritFacing(from: { dir: number; mirror: 1 | -1 }): void { return jackBody.inheritFacing.call(this as unknown as ScenePlayerState, from); }
  standJack(): void { return jackBody.standJack.call(this as unknown as ScenePlayerState); }
  hideJack(): void { return jackBody.hideJack.call(this as unknown as ScenePlayerState); }
  placeAgainstObject(person: number | null, object: string, over: boolean): void { return personBody.placeAgainstObject.call(this as unknown as ScenePlayerState, person, object, over); }
  placeUnderPerson(person: number | null, other: number | null): void { return personBody.placeUnderPerson.call(this as unknown as ScenePlayerState, person, other); }
  placeObjectOver(object: string, other: string): void { return personBody.placeObjectOver.call(this as unknown as ScenePlayerState, object, other); }
  setClip(name: string, clip: Rect): boolean { return objectBody.setClip.call(this as unknown as ScenePlayerState, name, clip); }
  hidePerson(person: number): void { return personBody.hidePerson.call(this as unknown as ScenePlayerState, person); }
  setShadow(person: number | null, n: number): void { return shadowBody.setShadow.call(this as unknown as ScenePlayerState, person, n); }
  fadeShadowOut(person: number | null, n: number, which = 0): void { return shadowBody.fadeShadowOut.call(this as unknown as ScenePlayerState, person, n, which); }
  fadeShadowIn(person: number | null, n: number, which = 0): void { return shadowBody.fadeShadowIn.call(this as unknown as ScenePlayerState, person, n, which); }
  setSpecShadow(person: number, object: string): boolean { return shadowBody.setSpecShadow.call(this as unknown as ScenePlayerState, person, object); }
  showShadow(person: number, x: number, y: number, scale: number): void { return shadowBody.showShadow.call(this as unknown as ScenePlayerState, person, x, y, scale); }
  hideShadow(person: number): void { return shadowBody.hideShadow.call(this as unknown as ScenePlayerState, person); }
  setShadowStatus(person: number, on: boolean): void { return shadowBody.setShadowStatus.call(this as unknown as ScenePlayerState, person, on); }
  setShadowOne(object: string): boolean { return shadowBody.setShadowOne.call(this as unknown as ScenePlayerState, object); }
  shadowBy(object: string, dx: number, dy: number, level: number): boolean { return shadowBody.shadowBy.call(this as unknown as ScenePlayerState, object, dx, dy, level); }
  putShadowOnBackground(x: number, y: number, scale: number): void { return shadowBody.putShadowOnBackground.call(this as unknown as ScenePlayerState, x, y, scale); }
  showExtraShadow(x: number, y: number, scale: number): void { return shadowBody.showExtraShadow.call(this as unknown as ScenePlayerState, x, y, scale); }
  setAnimShadow(anim: string, person: number | null, shadow: number | null, clear: boolean): boolean { return shadowBody.setAnimShadow.call(this as unknown as ScenePlayerState, anim, person, shadow, clear); }
  faceBeforeWalk(x: number, y: number): void { return jackBody.faceBeforeWalk.call(this as unknown as ScenePlayerState, x, y); }
  lookAt(x: number, y: number, wait = true): boolean { return jackBody.lookAt.call(this as unknown as ScenePlayerState, x, y, wait); }
  stayJack(name: string, macro = true): boolean { return jackBody.stayJack.call(this as unknown as ScenePlayerState, name, macro); }
  idleCount(): void { return jackBody.idleCount.call(this as unknown as ScenePlayerState); }
  idleInput(active: boolean): void { return jackBody.idleInput.call(this as unknown as ScenePlayerState, active); }
  idleCheck(noControl: boolean, random: () => number, gun: () => number): IdleChoice | null { return jackBody.idleCheck.call(this as unknown as ScenePlayerState, noControl, random, gun); }
  jackInsertion(name: string, dir: number, count?: number): boolean { return jackBody.jackInsertion.call(this as unknown as ScenePlayerState, name, dir, count); }
  personInsertion(person: number, name: string, dir: 0 | 1 | 2, count?: number, fresh = false): boolean { return personBody.personInsertion.call(this as unknown as ScenePlayerState, person, name, dir, count, fresh); }
  hasObject(name: string): boolean { return objectBody.hasObject.call(this as unknown as ScenePlayerState, name); }
  objectAnim(name: string): ObjectAnimation | null { return objectBody.objectAnim.call(this as unknown as ScenePlayerState, name); }
  objectPosition(name: string): { x: number; y: number } | null { return objectBody.objectPosition.call(this as unknown as ScenePlayerState, name); }
  setObjectPosition(name: string, x: number, y: number, relative = false): void { return objectBody.setObjectPosition.call(this as unknown as ScenePlayerState, name, x, y, relative); }
  setObjectVisible(name: string, visible: boolean): void { return objectBody.setObjectVisible.call(this as unknown as ScenePlayerState, name, visible); }
  startObjectAnim(name: string, a: AnimaArgs): boolean { return objectBody.startObjectAnim.call(this as unknown as ScenePlayerState, name, a); }
  startGlobalInsertion(name: string, facing: 1 | -1, scaleMul = 1): boolean { return jackBody.startGlobalInsertion.call(this as unknown as ScenePlayerState, name, facing, scaleMul); }
  showAnimFrame(name: string, n: number): boolean { return objectBody.showAnimFrame.call(this as unknown as ScenePlayerState, name, n); }
  setAnimDarkness(name: string, f: number): boolean { return objectBody.setAnimDarkness.call(this as unknown as ScenePlayerState, name, f); }
  brightenObject(name: string, f: number): boolean { return objectBody.brightenObject.call(this as unknown as ScenePlayerState, name, f); }
  clearAnimBuffer(name: string): boolean { return objectBody.clearAnimBuffer.call(this as unknown as ScenePlayerState, name); }
  moveObjectPoint(name: string, dx: number, dy: number): boolean { return objectBody.moveObjectPoint.call(this as unknown as ScenePlayerState, name, dx, dy); }
  setPersonLightScale(person: number | null, f: number): boolean { return personBody.setPersonLightScale.call(this as unknown as ScenePlayerState, person, f); }
  spriteCandidates(px: number, py: number, rect: HitRect | null = null): SpriteCandidate[] { return objectBody.spriteCandidates.call(this as unknown as ScenePlayerState, px, py, rect); }
  jackHit(px: number, py: number): boolean { return objectBody.jackHit.call(this as unknown as ScenePlayerState, px, py); }
  tick(): TickResult { return tickBody.tick.call(this as unknown as ScenePlayerState); }
  firstSteps(): TickResult | null { return tickBody.firstSteps.call(this as unknown as ScenePlayerState); }
  speakerPoint(person: number | null): { x: number; y: number } { return personBody.speakerPoint.call(this as unknown as ScenePlayerState, person); }
  setScroll(x: number): void { return tickBody.setScroll.call(this as unknown as ScenePlayerState, x); }
  setScrollLimits(min: number | null, max: number | null): void { return tickBody.setScrollLimits.call(this as unknown as ScenePlayerState, min, max); }
  startFlxAnim(name: string, mode: 5 | 6, delay: number, rec: number): boolean { return objectBody.startFlxAnim.call(this as unknown as ScenePlayerState, name, mode, delay, rec); }

  /** The group files read these. A reference keeps the private names in use. */
  private retain(): void {
    void [
      this.jackLight, this.turnFromScript, this.turnEndedPending, this.jackFresh, this.freshPersons,
      this.turnStepToggle, this.hotSpots, this.cache, this.objects, this.objectByName, this.jackId,
      this.shadowIds, this.personIds, this.shadowTables, this.backdrop, this.backdropOwned, this.shadowOne,
      this.extraShadowId, this.animShadows, this.roundMask, this.personShadowIds, this.personMasks,
      this.drawnObjects, this.objectSpriteIds, this.globalIcs, this.jackShown, this.src,
      this.composeRegion, this.drawObject, this.jackTick, this.image, this.apply,
    ];
  }

  private image(source: FrameSprite["source"] | "phk", file: string, pbm = false): Image16 { return decode.image.call(this as unknown as ScenePlayerState, source, file, pbm); }
  private composeRegion(x: number, y: number, w: number, h: number, maxZ: number, excludeId: number): Image16 { return shadowBody.composeRegion.call(this as unknown as ScenePlayerState, x, y, w, h, maxZ, excludeId); }
  private drawObject(o: ObjectSprite): void { return objectBody.drawObject.call(this as unknown as ScenePlayerState, o); }
  private apply(u: JackUpdate): void { return jackBody.apply.call(this as unknown as ScenePlayerState, u); }
  private jackTick(result: TickResult): void { return tickBody.jackTick.call(this as unknown as ScenePlayerState, result); }

}
