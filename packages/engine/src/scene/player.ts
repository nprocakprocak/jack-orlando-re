// The M1 scene: background, objects, Jack standing at jackStart and walking after a click.
// Glue only - parsing (formats), drawing (render), animation (anim) and path finding (walk)
// are the finished modules. No DOM: the host feeds it clicks and calls tick() every
// 15 ms logic tick of EngineLoop.
import {
  brightenPbm,
  findInsertion,
  jackBrightness,
  globalInsertion,
  idleChoice,
  JackAnimator,
  loadWalkFrames,
  ObjectAnimation,
  ROUND_SHADOW,
  SHADOW_OFFSET_ROUND,
  SHADOW_OFFSET_STILL_X,
  SHADOW_OFFSET_STILL_Y,
  SHADOW_OFFSET_WALK_X,
  SHADOW_OFFSET_WALK_Y,
  shadowDirIndex,
  sceneInsertions,
  jackShadow,
  SHADOW_SCALE_MAX,
  stepVolumes,
  WALK_FRAME_AFTER_STAND,
  type AnimaArgs,
  type Facing,
  type IdleChoice,
  type FrameSprite,
  type InsertionTable,
  type JackDir,
  type JackPose,
  type JackUpdate,
  type ShadowSprite,
  type SoundEvent,
} from "../anim";
import { placeTurnFrame, turnFrameTicks, turnSequence, turnShadow, TurnPlayer, type TurnFrame, type TurnTick } from "../anim/turn";
import { decodeBm, PALETTE_SIZE, type Image16 } from "../formats/bm";
import { Flx } from "../formats/media";
import { parseSfb, type HotSpot, type Ics } from "../formats/global";
import type { Pak } from "../formats/pak";
import { decodePbm } from "../formats/pbm";
import { jackStart, parseScene, type ObjectAnim, type Scene, type SceneObject } from "../formats/scene";
import { applyStand, avoidPerson } from "../persons/avoid";
import { behindByY, personDef, personObjectDepth, personObjectDepthInsertion, ScenePersons, type PersonSound, type PersonUpdate, type ShadowCall } from "../persons";
import { PersonShadow, type ShadowDraw, type ShadowTables } from "../persons/shadow";
import { spriteFlagged, type HitRect, type SpriteCandidate } from "../areas";
import { alignScroll, blitKeyed, blitScaled, Renderer, type Rect, type Sprite, type Surface16, SCALE_KEEP, Z_UI, strideOf, scrollLimits, scrollTick } from "../render";
import {
  createWalker,
  f32,
  facingForAngle,
  jackScale,
  objectDepth,
  personDepth,
  planWalk,
  stepTicks,
  walkStep,
  walkWorld,
  type DepthRelation,
  type Walker,
  type WalkPlan,
  type WalkWorld,
} from "../walk";
import { followPlanTurning, turnTo, turningJack, turningTick, type TurningJack } from "../walk/turn";
import { FlxAnimation } from "../video/flx";
import { followScroll, initialScrollMax, walkScrollDirection } from "./scroll";
import { ftol } from "../walk/geometry";
import { moveObjectQuad } from "./objquad";
import { blendOverBackdrop, brightenImage, GLASS_WHITE, mixColour } from "./objfx";
import { approximateShadowTables, composeShadow, drawAt, flipped, shownAtSceneStart, TYPE_PBM_ANIMATED, Z_SHADOW } from "./shadow";

/** Sprite order of Jack when he is in front of everything (objects use their index as z). */
/** Game_Run: the idle check fires when `g_idleFrames > 1500` (`0x5dc`) */
export const IDLE_LIMIT = 1500;
/** Game_Run: the counter after an idle insertion; the next one comes 800 frames later */
export const IDLE_AFTER = 700;
/**
 * [engine; browser limit] `g_idleFrames` counts Game_Run frames, which the original caps at one per 2 timer ticks of 5 ms
 * (`Timer_WaitSinceFrameStart`) - 100 frames/s, so 1500 frames = 15 s. The browser runs one frame per
 * display refresh (60 Hz would make it 25 s), so the engine counts the frames of the capped original per 15 ms logic tick.
 */
export const IDLE_FRAMES_PER_TICK = 1.5;

export const Z_JACK = 1000;
/**
 * z of a person's sprite when it is added (Game_Run: Sprite_Add(..., 2...)): just above the shadows (0) and
 * the objects 0 and 1, i.e. under every other object. Only the depth test and POVERE / PUNDERE move it.
 */
export const Z_PERSON = 2;

/**
 * Image of a scene archive file. The game never looks at the extension: the format comes from the
 * CCG object type or from the loader that names the file. Here that is told from the content: a `.BM`-style file has
 * exactly `4 + 2*w*h` (16-bit) or `4 + 256 + w*h` (8-bit palette) bytes, anything else is a PBM (`DL0.011`, `DRZWI.114`, `GAZ.000`).
 */
export function decodeSceneImage(data: Uint8Array, file: string, pbm = false): Image16 {
  // `pbm`: the CCG object type says PBM (8 / -8); an all-literal PBM has the size of an 8-bit BM, so the size alone cannot tell them apart
  if (pbm || file.toUpperCase().endsWith(".PBM")) return decodePbm(data, file);
  if (data.length >= 4) {
    const n = (data[0] | (data[1] << 8)) * (data[2] | (data[3] << 8));
    if (data.length === 4 + 2 * n || data.length === 4 + PALETTE_SIZE + n) return decodeBm(data);
  }
  return decodePbm(data, file);
}

export interface SceneSources {
  name: string;
  /** Resource/RESOURCE.PAK: Jack's frames and shadows */
  resource: Pak;
  /** Action/<name>.PHK.CCG/.ACE/.MCC and the object images */
  phk: Pak;
  /** Data/<name>.PH2: scene insertion frames (not needed for walking) */
  ph2?: Pak | null;
  /** GLOBAL.PAK: frames of global insertions (Jack's KLPRO, PP_D0 ...) */
  global?: Pak | null;
  /** GLOBAL.ICS of that archive, parsed (insertions Jack plays by name) */
  globalIcs?: Ics | null;
}

export interface SceneOptions {
  /** g_lastScene for the start position (jackStart); null = unconditional start */
  lastScene?: number | null;
  /** WalkSpeed from the registry, default 1 (g_cfgWalkSpeed) */
  walkSpeed?: number;
  /** start the .ACI animations of the objects (the demo does what the preview does) */
  animateObjects?: boolean;
  /**
 * The scene is driven by its scripts: the camera moves as Game_Run does (walk margins,
 * scroll commands) instead of following Jack, objects are controlled by commands, scenes
 * without a walk area are allowed and Jack starts where the scripts put him.
 */
  scripted?: boolean;
  /**
 * The colour tables that darken the background under a shadow (the same tables as the dialog window).
 * Without them (the M1 demo, tests that do not pass tables) an approximation with the same shape is used.
 */
  shadowTables?: ShadowTables;
  /** g_shadowsOn: shadows are drawn at all (default true) */
  shadows?: boolean;
}

export interface TickResult {
  /** a walk step happened (Jack moved or changed segment) */
  stepped: boolean;
  /** Jack reached the clicked point and stands again */
  arrived: boolean;
  sounds: SoundEvent[];
  /** sounds of the persons (scene sound slots, insertion effect names) */
  personSounds: PersonSound[];
}

/** The facing a STAY name stands for (g_jackDir / g_jackFacing; an unknown name is D). */
export function stayFacing(name: string): { dir: number; mirror: 1 | -1 } {
  switch (name) {
    case "L":
      return { dir: 1, mirror: 1 };
    case "R":
      return { dir: 1, mirror: -1 };
    case "U":
      return { dir: 2, mirror: 1 };
    case "LU":
      return { dir: 4, mirror: -1 };
    case "RU":
      return { dir: 4, mirror: 1 };
    case "LD":
      return { dir: 3, mirror: 1 };
    case "RD":
      return { dir: 3, mirror: -1 };
    default:
      return { dir: 0, mirror: 1 };
  }
}

/** What happened during a tick that a script may be waiting for (the host calls complete()). */
export type SceneEvent =
  | { kind: "jackArrived" }
  /** CHKDISTANCE sent Jack aside: Jack_AvoidPerson -> Jack_WalkTo -> Script_InterruptOutMacros(-1), like a click's walk */
  | { kind: "jackAvoidWalk" }
  | { kind: "jackInsertionEnded"; name: string; global: boolean }
  /** a turn started by LOOKTO / ROTATETO ended (or was cut short): ROTATETO waits for it */
  | { kind: "jackTurnEnded" }
  | { kind: "personArrived"; person: number }
  | { kind: "personInsertionEnded"; person: number; name: string }
  /** INITFIRST: the first drawn frame of Jack's insertion took the shared flag and stopped it ; no end event */
  | { kind: "jackInsertionReleased" }
  /** the same for a person's insertion */
  | { kind: "personInsertionReleased"; person: number }
  | { kind: "animEnded"; anim: string; reason: "end" | "stop" }
  /**
 * An object animation is due and shows `image` of REC sequence `rec` (Game_Run: the REC
 * position in modes 3/4, the image index in modes 1/2, the FLX frame counter in modes 5/6): ANIMAEFFECT sounds
 * and ACTIVEMACROANIMA macros fire on it.
 */
  | { kind: "animFrame"; anim: string; image: number; rec: number; flx: boolean };

interface ObjectSprite {
  id: number;
  name: string;
  /** object index = z */
  z: number;
  anim: ObjectAnimation | null;
  x: number;
  y: number;
  scale: number;
  base: Image16;
  visible: boolean;
  /** CCG type -8 (g_sceneObjWasPbm16): neither Scene_RefreshBackground nor SETPOSITIONE puts the sprite on screen, only the animation step does */
  pbm16?: boolean;
  /** file of the frame shown now (null = the object's own image) */
  frameFile: string | null;
  frameDx: number;
  frameDy: number;
  /** FLX slot (.ACI `FLXn`): the playing animation (modes 5/6) and the sprite its last frame left */
  flx?: { play: FlxAnimation | null; rec: number };
  /** the sprite image is an unpacked buffer (g_sceneObjType 8 / -8, FLX): CLEARANIMABUFFER empties it */
  buffered: boolean;
  /** BRIGHTNESSE factor of the picture shown; a new frame is unpacked afresh and resets it */
  light: number;
  /** SETDARKNESSANIMA colour (type -8 pictures are blended toward it) */
  darkness: number;
}

/** An empty sprite image: the shadow sprites exist from the start (Sprite_Add at scene start) and get their image when drawn. */
const BLANK: Image16 = { width: 1, height: 1, kind: "rgb565", pixels: new Uint16Array(1) };

/** Scene without a walk area: nothing to walk on, scale 1. */
function emptyWorld(): WalkWorld {
  return { walk: [], objects: [], perspective: { horizonY: 0, refY: 1, refScale: 1 } };
}

export class ScenePlayer {
  readonly scene: Scene;
  readonly world: WalkWorld;
  readonly hasWalkArea: boolean;
  readonly renderer: Renderer;
  readonly jack: JackAnimator;
  readonly walker: Walker;
  /** Jack's turn state: the running turning animation, POINTROTATE, the uniform */
  readonly tj: TurningJack;
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
    this.addObjects(opts.animateObjects ?? !this.scripted);
    // Game_Run (bytes): counter = [] - [], min 1; g_insFrameDelay is 5
    // once a scene runs -> a step every 4 logic ticks (is right, 's "4 - WalkSpeed" is not)
    this.jack = new JackAnimator(loadWalkFrames(src.resource), { frameDelay: 5, walkSpeed: opts.walkSpeed ?? 1 });
    // g_jackX/Y are (320, 240) after Game_Run until the scripts place Jack
    const start = this.scripted ? { x: 320, y: 240 } : jackStart(this.scene, opts.lastScene ?? null) ?? this.centroid();
    this.walker = createWalker(start.x, start.y, this.world);
    this.tj = turningJack(this.walker);
    // Game_Run: the shadow sprites are added with z = 0 after the scene objects, so they lie under every object and person;
    // the depth code skips them and nothing moves them (only SHADOWONE: Sprite_MoveFront)
    this.shadowIds = [this.renderer.add(BLANK, Z_SHADOW, SCALE_KEEP), this.renderer.add(BLANK, Z_SHADOW, SCALE_KEEP)];
    this.jackId = this.renderer.add(this.image("resource", "SSFR2.PBM"), Z_JACK, 1);
    this.persons = new ScenePersons(this.scene.persons.map(personDef), { horizon: this.scene.ccg.perspective?.horizonY ?? 0 });
    this.persons.persons.forEach((_, i) => {
      this.personShadowIds[i] = this.renderer.add(BLANK, Z_SHADOW, SCALE_KEEP);
      this.personMasks[i] = null;
      this.personIds[i] = this.renderer.add(this.image("resource", "SSFR2.PBM"), Z_PERSON, 1);
    });
    // Render_RedrawRect draws the topmost sprite only when it is a 16-bit image, so a paletted Jack on top would not
    // be redrawn over the shadow set after him. In the game the UI sprites always lie above (Z_UI); this one stays hidden.
    this.renderer.add(BLANK, Z_UI + 1000, SCALE_KEEP);
    this.extraShadowId = this.renderer.add(BLANK, Z_SHADOW, SCALE_KEEP);
    this.scrollX = this.scripted ? this.scriptedStartScroll() : this.initialScroll(start.x);
    if (!this.scripted) {
      this.jackShown = true; // the demo scene draws Jack standing at once (Jack_Stand)
      this.jackPlaced = true;
      this.apply(this.jack.stand(this.pose()));
      this.arrangeJack();
    }
  }

  /** Jack's pose from the walker (the walker owns position, direction and scale). */
  pose(): JackPose {
    const w = this.walker;
    return { x: w.x, y: w.y, dir: w.dir as JackDir, facing: w.mirror, scale: w.scale };
  }

  // --- the demo's click (M1) --------------------------------------------------------------------

  /**
 * Left click at world coordinates (screen + scroll). Returns true when Jack starts walking;
 * clicks outside the walk area, inside an object quad, or next to Jack are ignored
 * (planWalk / startSegment).
 */
  click(x: number, y: number): boolean {
    const plan = planWalk(this.world, this.walker, { x: Math.trunc(x), y: Math.trunc(y) });
    if (!plan) return false;
    return this.walkPlan(plan);
  }

  /** Starts following a plan; false when Jack is where he wants to be already. */
  walkPlan(plan: WalkPlan, forced: number | null = null): boolean {
    const wasWalking = this.walker.walking;
    this.walker.forced = forced;
    this.jackAvoiding = false;
    followPlanTurning(this.tj, plan);
    if (!this.walker.walking) return false;
    // Jack_WalkToPoint: a new walk clears g_turnMacroWaits, the macro of a running ROTATETO / STAY is never released
    this.turnFromScript = false;
    this.jackHidden = false;
    this.jack.walk();
    // the step timer is 0 after a click: the first step comes in the frame of the command (firstSteps)
    if (!wasWalking) {
      this.jack.delay = 0;
      this.jackFresh = true;
    }
    return true;
  }

  /**
 * WALKTO JACK x y: a goal outside the walk area gives no path; Jack walks straight to it. Returns false when there is
 * nothing to walk (already there, or the scene has no walk area).
 */
  walkJackTo(x: number, y: number, forcedDir: number | null = null): boolean {
    if (!this.hasWalkArea) return false;
    const t = { x: Math.trunc(x), y: Math.trunc(y) };
    // the goal is NOT moved into the area (Script_ExecStep case 6, Jack_WalkTo): Walk_FindPath
    // finds no path to a goal outside, Walk_NearestWalkable moves only the START, and the walk ends as a straight
    // line to the goal itself (Jack_WalkToPoint) - SC009 TO_IN walks on past the area's edge to the street
    const plan =
      planWalk(this.world, this.walker, t, { anyGoal: true }) ??
      ({ path: [{ x: Math.trunc(this.walker.x), y: Math.trunc(this.walker.y) }, t], direct: true, fromOutside: false } as WalkPlan);
    return this.walkPlan(plan, forcedDir);
  }

  // --- Jack: commands of the scripts ---------------------------------------------------------

  /**
 * SETPOSITION JACK x y / MOVEP JACK dx dy (Script_ExecStep, cases 1 and 0x37): only g_jackX, g_jackY and the
 * scale change, nothing is drawn. Jack's sprite stays where it was until the next frame (insertion, walk step, STAY),
 * so between two insertions no standing frame - at the new scale, with the old noScale - shows up.
 */
  setJackPosition(x: number, y: number): void {
    const w = this.walker;
    w.x = f32(x);
    w.y = f32(y);
    w.walking = false;
    w.scale = this.fixedScale ?? jackScale(this.world.perspective, w.y);
  }

  /** SETPERSONDATA JACK n1 f n2 n3 */
  setJackData(frameDelay: number, f: number, refY: number, speed: number): void {
    this.jack.frameDelay = frameDelay;
    this.world.perspective.refY = refY;
    this.walker.speed = speed;
    if (f === 3) {
      this.fixedScale = this.walker.scale;
    } else {
      this.fixedScale = null;
      this.jack.noScale = f === 2;
      // Script_ExecStep case 3: f = 2 only sets g_jackNoScale; g_perspRefScale and g_jackScale stay as they were
      // (the shadows of the BOJKA insertions use g_jackScale, so it must not jump to 1)
      if (f !== 2) {
        this.world.perspective.refScale = f32(f);
        this.walker.scale = jackScale(this.world.perspective, this.walker.y);
      }
    }
  }

  /**
 * JACKTEMPO DATA / FREE (0x84, Game_Run): with DATA (= 1) Jack's step
 * delay is g_insFrameDelay alone, the WalkSpeed option is not subtracted - SC083 and SC084
 * (the gangster's route) use it, so Jack does not outrun the gangster. A new scene resets it.
 */
  setJackTempoFixed(fixed: boolean): void {
    this.jack.walkSpeed = fixed ? 0 : this.walkSpeedOption;
  }

  /**
 * `g_jackDir` / `g_jackFacing` are globals: only loading a save resets them, a scene change does not.
 * The next scene's first WALKTO therefore turns from the pose Jack left the previous scene in, not from the front.
 */
  inheritFacing(from: { dir: number; mirror: 1 | -1 }): void {
    this.walker.dir = from.dir;
    this.walker.mirror = from.mirror;
  }

  /** STAY / STAYDEF: Jack stands in his current direction. */
  standJack(): void {
    this.jackShown = true;
    this.jackPlaced = true;
    this.cancelTurn();
    this.jackHidden = false;
    this.walker.walking = false;
    this.tj.moving = false;
    this.apply(this.jack.stand(this.pose()));
    this.arrangeJack();
  }

  /** HIDE JACK: Sprite_Remove of Jack and his shadows. */
  hideJack(): void {
    this.cancelTurn();
    this.jackHidden = true;
    this.renderer.hide(this.jackId);
    for (const id of this.shadowIds) this.renderer.hide(id);
  }

  /**
 * PUNDERE / POVERE (Script_ExecStep 0x15 / 0x1c): Sprite_MoveBack / Sprite_MoveFront of the person's sprite
 * (null = Jack) repeated by the distance, only when it lies on the wrong side: it ends directly under / over
 * the object's sprite. The place holds until a depth test of a step finds the sprites overlapping.
 */
  placeAgainstObject(person: number | null, object: string, over: boolean): void {
    const o = this.objectByName.get(object);
    if (!o) return;
    this.placeSprite(person === null ? this.jackId : this.personIds[person], o.id, over);
  }

  /**
 * PUNDERP (Script_ExecStep 0x14): Sprite_MoveBack of the person's sprite until it lies directly under the
 * other person's (null = Jack); nothing happens when it is under already.
 */
  placeUnderPerson(person: number | null, other: number | null): void {
    const to = other === null ? this.jackId : this.personIds[other];
    if (to === undefined) return;
    this.placeSprite(person === null ? this.jackId : this.personIds[person], to, false);
  }

  /** EOVERE (0x3d): Sprite_MoveFront of an object's sprite until it lies directly over another object's. */
  placeObjectOver(object: string, other: string): void {
    const a = this.objectByName.get(object);
    const b = this.objectByName.get(other);
    if (a && b) this.renderer.placeOver(a.id, b.id);
  }

  /** PUNDERE / POVERE / depth test move only the sprite of the person (Sprite_MoveBack / MoveFront); the shadows stay at the bottom. */
  private placeSprite(id: number, other: number, over: boolean): void {
    if (over) this.renderer.placeOver(id, other);
    else this.renderer.placeUnder(id, other);
  }

  /**
 * CHWINDOW (->): the clip rectangle (+0x14..+0x1a) of the sprite of Jack (and his two
 * shadows), of an object or of a person, looked up in this order. Returns false when the name is unknown.
 */
  setClip(name: string, clip: Rect): boolean {
    const ids: number[] = [];
    if (name === "JACK") ids.push(this.jackId, ...this.shadowIds);
    else if (this.objectByName.has(name)) ids.push(this.objectByName.get(name)!.id);
    else {
      const i = this.persons.find(name);
      if (i < 0) return false;
      ids.push(this.personIds[i], this.personShadowIds[i]);
    }
    for (const id of ids) {
      const sp = this.renderer.sprite(id);
      if (sp) sp.clip = { ...clip };
    }
    // [PRE] (before the first tick): the scene is composed after it, so what the sprite showed outside its new window must not stay
    if (this.ticks === 0) this.refreshBackground();
    return true;
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

  /** HIDE person: Sprite_Remove (the next walk or insertion step draws it again). */
  hidePerson(person: number): void {
    const id = this.personIds[person];
    if (id === undefined) return;
    this.renderer.hide(id);
    // Script_ExecStep case 9: the shadow goes too unless SHOWSHADOW / SHADOWSTATUS placed it by hand
    if (this.shadowsOn && !this.persons.persons[person].shadowStatus) this.renderer.hide(this.personShadowIds[person]);
  }

  // --- shadows: the commands of the scripts and the drawing ----------------------------------

  /** The shadow state of a person (null = Jack's first shadow, which the commands treat as one with the second). */
  private shadowOf(person: number): PersonShadow | undefined {
    return this.persons.persons[person]?.shadow;
  }

  /**
 * SETSHADOW p n (case 0x12): cancels the fades; n = 0 switches the shadow off and removes its sprite (for Jack only the
 * first one - the game leaves the second), otherwise on with strength n (for Jack both, one strength).
 */
  setShadow(person: number | null, n: number): void {
    if (person === null) {
      for (const st of this.jackShadows) st.setShadow(n);
      if (n === 0 && this.shadowsOn) this.renderer.hide(this.shadowIds[0]);
      return;
    }
    const st = this.shadowOf(person);
    if (!st) return;
    if (st.setShadow(n) === "removed" && this.shadowsOn) this.renderer.hide(this.personShadowIds[person]);
  }

  /** MINSHADOW n p [which] (case 0x8a): fade out over n draws; `which` (0 / 1) picks Jack's shadow. */
  fadeShadowOut(person: number | null, n: number, which = 0): void {
    if (person === null) this.jackShadows[which === 0 ? 0 : 1].fadeOut(n);
    else this.shadowOf(person)?.fadeOut(n);
  }

  /** MAXSHADOW n p [which] (case 0x8b): fade in over n draws. */
  fadeShadowIn(person: number | null, n: number, which = 0): void {
    if (person === null) this.jackShadows[which === 0 ? 0 : 1].fadeIn(n);
    else this.shadowOf(person)?.fadeIn(n);
  }

  /** SETSPECSHADOW p object (case 0x99): the image the object's sprite shows now is the mask of the person's shadow. */
  setSpecShadow(person: number, object: string): boolean {
    const o = this.objectByName.get(object);
    const st = this.shadowOf(person);
    const image = o ? this.renderer.sprite(o.id)?.image : undefined;
    if (!st || !image) return false;
    st.useObjectMask();
    this.personMasks[person] = image as Image16;
    return true;
  }

  /**
 * SHOWSHADOW p x y scale (case 0x9a): the shadow at the point with the given scale, whether the person's shadow
 * is switched on or not; the point is remembered. `x`, `y` are shorts.
 */
  showShadow(person: number, x: number, y: number, scale: number): void {
    const p = this.persons.persons[person];
    if (!p) return;
    p.shadowStatus = true;
    this.placeShadowAt(person, x, y, scale);
  }

  /** HIDESHADOW p (case 0x9c): the flag goes off and the shadow is drawn at (0, 500), below the screen. */
  hideShadow(person: number): void {
    const p = this.persons.persons[person];
    if (!p) return;
    p.shadowStatus = false;
    this.placeShadowAt(person, 0, 500, 1);
  }

  /** SHADOWSTATUS p 0|1 (case 0x9b): only the flag. */
  setShadowStatus(person: number, on: boolean): void {
    const p = this.persons.persons[person];
    if (p) p.shadowStatus = on;
  }

  private placeShadowAt(person: number, x: number, y: number, scale: number): void {
    if (!this.shadowsOn) return;
    const p = this.persons.persons[person];
    p.shadowPoint = { x, y };
    const mask = this.personMasks[person] ?? this.roundMask;
    const d = p.shadow.show({ x, y, personScale: p.scale, lightScale: p.def.lightScale, maskWidth: mask.width, maskHeight: mask.height }, scale);
    this.putShadow(this.personShadowIds[person], d, mask, true);
  }

  /** Person_DrawShadow for one call of a person's step (the state decides whether and how it is drawn). */
  private drawPersonShadow(person: number, call: ShadowCall): void {
    const p = this.persons.persons[person];
    const mask = this.personMasks[person] ?? this.roundMask;
    const d = p.shadow.draw(this.shadowsOn, {
      x: call.x, y: call.y, personScale: call.scale, lightScale: p.def.lightScale, maskWidth: mask.width, maskHeight: mask.height,
    });
    if (d) this.putShadow(this.personShadowIds[person], d, mask, true);
  }

  /**
 * Jack_DrawShadow: the animator has chosen image, scale and corner; this applies the shadow's state (off,
 * fading in / out) and draws. Mirrored shadows are drawn from the flipped mask (the game passes a negative column step).
 */
  private drawJackShadow(index: 0 | 1, s: ShadowSprite): void {
    const st = this.jackShadows[index];
    if (!this.shadowsOn || (!st.enabled && !st.fadingIn)) return;
    const base = s.round ? this.roundMask : this.image("resource", s.file);
    const mask = s.mirrored ? flipped(base) : base;
    const fading = st.fadingOut || st.fadingIn;
    let d: ShadowDraw | null;
    if (fading) {
      // the scale changes, so the corner has to move round the anchor the animator used
      const [dx, dy] = this.jackShadowAnchor(s);
      d = st.draw(true, {
        x: s.x + dx * s.scale, y: s.y + dy * s.scale, personScale: s.fadeBase ?? s.scale, lightScale: 1, levelScale: this.jack.shadowScale,
        maskWidth: mask.width, maskHeight: mask.height,
      });
    } else d = drawAt(s.x, s.y, s.scale, mask.width, mask.height, st.strength);
    this.putShadow(this.shadowIds[index], d, mask, true);
  }

  /** The anchor offsets Jack_DrawShadow subtracted (animator `jackShadow`): the round shadow's, or the tables by mode. */
  private jackShadowAnchor(s: ShadowSprite): readonly [number, number] {
    if (s.round || this.jack.mode === "insertion") return SHADOW_OFFSET_ROUND;
    const i8 = shadowDirIndex(this.walker.dir, this.walker.mirror);
    return this.jack.mode === "stand" ? [SHADOW_OFFSET_STILL_X[i8], SHADOW_OFFSET_STILL_Y[i8]] : [SHADOW_OFFSET_WALK_X[i8], SHADOW_OFFSET_WALK_Y[i8]];
  }

  /** Render_ComposeRegionNoFlag + Blit_ShadowDarken + Sprite_Set of a shadow sprite. */
  private putShadow(id: number, d: ShadowDraw | null, mask: Image16, layered = false): void {
    const one = layered && this.shadowOne ? this.objectByName.get(this.shadowOne) : undefined;
    const img = d && composeShadow(one ? this.backdropWithSprites(id, d, one.id) : this.backdrop, d, mask, this.shadowTables);
    if (!d || !img) {
      this.renderer.hide(id);
      return;
    }
    // / Person_DrawShadow with SHADOWONE: the shadow sprite goes up to lie over the object's
    if (one) this.renderer.placeOver(id, one.id);
    this.renderer.set(id, d.x, d.y, img, SCALE_KEEP);
  }

  /**
 * Render_ComposeRegionNoFlag with a layer limit (SHADOWONE): the background under the shadow with every visible sprite up to the
 * object's (not the shadow's own, not those with the flag +0x1e) drawn over it; a copy of the whole background, which the
 * shadow code indexes by scene coordinates.
 */
  private backdropWithSprites(shadowId: number, d: ShadowDraw, objectId: number): Image16 {
    const bg = this.backdrop;
    const out: Image16 = { ...bg, pixels: bg.pixels.slice() };
    const items = this.renderer.sprites.items;
    const last = this.renderer.sprites.indexOf(objectId);
    for (let i = 0; i <= last; i++) {
      const sp = items[i];
      if (!sp.visible || !sp.image || sp.kind === "raw" || sp.id === shadowId || sp.flag !== 0) continue;
      const x0 = Math.max(sp.x, sp.clip.left, d.x, 0);
      const x1 = Math.min(sp.x + sp.w, sp.clip.right, d.x + d.width, bg.width);
      const y0 = Math.max(sp.y, sp.clip.top, d.y, 0);
      const y1 = Math.min(sp.y + sp.h, sp.clip.bottom, d.y + d.height, bg.height);
      if (x0 >= x1 || y0 >= y1) continue;
      if (sp.kind === "pal8") {
        const sx = sp.step.int < 0 ? sp.x + sp.w - x1 : x0 - sp.x;
        blitScaled(sp.image, sp.step, sx, y0 - sp.y, x1 - x0, y1 - y0, out, x0, y0);
      } else blitKeyed(sp.image, x0 - sp.x, y0 - sp.y, x1 - x0, y1 - y0, out, x0, y0);
    }
    return out;
  }

  /**
 * Render_ComposeRegion for the picture of a type -8 object: the part of the scene at (x, y, w, h) as a `w` x `h` picture,
 * the background with every visible sprite whose `z` is at most `maxZ` (the object's own z, not its own sprite) drawn over it. The
 * car windows of SC005 (SZYBY.PBM) thus tint the car body under them, not just the street: the picture is an opaque rectangle
 * (before it showed the bare background and covered SAM_INS.PBM). Persons and Jack (z above the objects) are not in it.
 */
  private composeRegion(x: number, y: number, w: number, h: number, maxZ: number, excludeId: number): Image16 {
    const bg = this.backdrop;
    const out: Image16 = { ...bg, width: w, height: h, pixels: new Uint16Array(w * h) };
    for (let r = 0; r < h; r++) {
      const sy = y + r;
      if (sy < 0 || sy >= bg.height) continue;
      for (let c = Math.max(0, -x); c < w && x + c < bg.width; c++) out.pixels[r * w + c] = bg.pixels[sy * bg.width + x + c];
    }
    // "Under the object" is the sprite list as it is now: inserting a person's sprite (Biff's clinch, MWCI) pushes the car and the
    // windows one `z` up, so the static z of the object would drop the car from the picture. Before the object has a sprite
    // (first draw) its static z is the limit.
    const sprites = this.renderer.sprites.items;
    const own = sprites.findIndex((q) => q.id === excludeId);
    for (let i = 0; i < sprites.length; i++) {
      const sp = sprites[i];
      if (own >= 0 ? i >= own : sp.z > maxZ) continue;
      if (!sp.visible || !sp.image || sp.kind === "raw" || sp.id === excludeId) continue;
      const x0 = Math.max(sp.x, sp.clip.left, x);
      const x1 = Math.min(sp.x + sp.w, sp.clip.right, x + w);
      const y0 = Math.max(sp.y, sp.clip.top, y);
      const y1 = Math.min(sp.y + sp.h, sp.clip.bottom, y + h);
      if (x0 >= x1 || y0 >= y1) continue;
      if (sp.kind === "pal8") {
        const sx = sp.step.int < 0 ? sp.x + sp.w - x1 : x0 - sp.x;
        blitScaled(sp.image, sp.step, sx, y0 - sp.y, x1 - x0, y1 - y0, out, x0 - x, y0 - y);
      } else blitKeyed(sp.image, x0 - sp.x, y0 - sp.y, x1 - x0, y1 - y0, out, x0 - x, y0 - y);
    }
    return out;
  }

  /** SHADOWONE object (case 0x9d): switches the layered composition on for the rest of the scene. */
  setShadowOne(object: string): boolean {
    if (!this.objectByName.has(object)) return false;
    this.shadowOne = object;
    return true;
  }

  /** The background becomes the player's own before the first shadow is painted on it. */
  private ownBackdrop(): Image16 {
    if (!this.backdropOwned) {
      this.backdrop = { ...this.backdrop, pixels: this.backdrop.pixels.slice() };
      this.renderer.setBackground(this.backdrop);
      this.backdropOwned = true;
    }
    return this.backdrop;
  }

  /** What / end with: the composed, darkened rectangle is copied back into the background. */
  private bakeShadow(d: ShadowDraw, mask: Image16): void {
    const bg = this.ownBackdrop();
    const img = composeShadow(bg, d, mask, this.shadowTables);
    if (!img) return;
    const x0 = Math.max(d.x, 0);
    const x1 = Math.min(d.x + img.width, bg.width);
    for (let r = 0; r < img.height; r++) {
      const y = d.y + r;
      if (y < 0 || y >= bg.height) continue;
      for (let x = x0; x < x1; x++) bg.pixels[y * bg.width + x] = img.pixels[r * img.width + x - d.x];
    }
    this.renderer.redrawAll();
  }

  /**
 * SHADOWBY object dx dy level (case 0x11, +): the object's image (a mask) is a shadow baked
 * into the background at the object's position + (dx, dy), 1:1, with the given strength. Not switched off by `shadows`.
 */
  shadowBy(object: string, dx: number, dy: number, level: number): boolean {
    const o = this.objectByName.get(object);
    const mask = o ? (this.renderer.sprite(o.id)?.image as Image16 | null | undefined) : undefined;
    if (!o || !mask) return false;
    const x = o.x + dx;
    const y = o.y + dy;
    const width = mask.width;
    const d: ShadowDraw = {
      scale: 1, x, y, width, height: mask.height, level, stepInt: 1, stepFrac: 0,
      backdrop: { srcX: Math.max(x, 0), srcWidth: Math.min(x + width, this.backdrop.width) - Math.max(x, 0), dstX: Math.max(-x, 0) },
    };
    this.bakeShadow(d, mask);
    return true;
  }

  /** PUTSHADOW x y f (case 0x8c): the round shadow baked into the background, strength of Jack's shadows. */
  putShadowOnBackground(x: number, y: number, scale: number): void {
    const s = Math.fround(scale);
    const [ax, ay] = SHADOW_OFFSET_ROUND;
    const d = drawAt(ftol(x - ax * s), ftol(y - ay * s), s, this.roundMask.width, this.roundMask.height, this.jackShadows[0].strength);
    this.bakeShadow(d, this.roundMask);
  }

  /** SHOWSHADOW / HIDESHADOW EXTRA: a round shadow in a sprite of its own, anchor (60, 15), strength of Jack's. */
  showExtraShadow(x: number, y: number, scale: number): void {
    const s = Math.fround(scale);
    const d = drawAt(ftol(x - 60 * s), ftol(y - 15 * s), s, this.roundMask.width, this.roundMask.height, this.jackShadows[0].strength);
    this.putShadow(this.extraShadowId, d, this.roundMask);
  }

  /**
 * ANIMASHADOW anim person shadow n (case 0x8d): while the FLX animation runs, Jack's shadow (a round one, the standing mode)
 * follows the points of the .ACI section SHADn at the object's position. `shadow` null stops it.
 * `person` null = Jack; for a person only the flag of its shadow changes (nothing draws it).
 */
  setAnimShadow(anim: string, person: number | null, shadow: number | null, clear: boolean): boolean {
    if (!this.objectByName.get(anim)?.flx) return false;
    const p = person === null ? undefined : this.persons.persons[person];
    if (person !== null && !p) return false;
    if (shadow === null) {
      this.animShadows.delete(anim);
      if (p) p.shadowStatus = false;
      return true;
    }
    const points = this.scene.shadows.find((s) => s.index === shadow)?.points;
    if (!points) return false;
    this.animShadows.set(anim, { jack: person === null, person: person ?? -1, points, step: 0, clear });
    if (p) p.shadowStatus = true;
    return true;
  }

  /** One FLX step of an animation with a shadow: draw Jack's shadow at the point, count; at the end maybe remove it. */
  private stepAnimShadow(o: ObjectSprite, drewPixels: boolean, rect: readonly number[], mode: number): void {
    const a = this.animShadows.get(o.name);
    if (!a) return;
    const pt = a.points[a.step];
    if (a.jack && drewPixels && pt) {
      const s = jackShadow({
        index: 0, dir: this.walker.dir, facing: this.walker.mirror,
        x: o.x + pt[0] + (mode === 2 ? rect[0] : 0), y: o.y + pt[1] + (mode === 2 ? rect[1] : 0), walkFrame: null,
        directional: false, twoShadows: false, scale: this.walker.scale, shadowScale: this.jack.shadowScale,
      });
      this.drawJackShadow(0, s);
    }
    if (++a.step >= a.points.length) {
      this.animShadows.delete(o.name);
      if (a.clear && a.jack) this.renderer.hide(this.shadowIds[0]);
    }
  }

  /** Jack_FaceTowards (noLift = 1): the facing for the walk angle from Jack to the point. */
  private facingToward(x: number, y: number): { dir: number; mirror: 1 | -1 } {
    const w = this.walker;
    const dx = x - w.x;
    const dy = (y - w.y) / 0.3;
    let deg = Math.trunc((Math.atan(dx === 0 ? (dy < 0 ? -1e9 : 1e9) : dy / dx) * 180) / Math.PI);
    if (dx < 0) deg += 180;
    deg = ((deg % 360) + 360) % 360;
    return facingForAngle(deg);
  }

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

  /**
 * WALKTO / WALKTODIR JACK (Script_ExecStep cases 6 and 0x16): while `g_jackShown` is still 0 the command first calls
 * `Jack_FaceTowards(target)` and sets the flag, so `Jack_WalkToPoint` finds the facing unchanged and plays no turn (* SC005B entered from SC011, SC005B INIT `WALKTO JACK 612 385`;).
 */
  faceBeforeWalk(x: number, y: number): void {
    if (this.jackShown) return;
    this.jackShown = true;
    const f = this.facingToward(x, y);
    this.walker.dir = f.dir;
    this.walker.mirror = f.mirror;
  }

  /**
 * LOOKTO / ROTATETO (Script_ExecStep cases 0x61 / 0x77): Jack_FaceTowards works out the facing from the point;
 * a walking Jack who keeps it just stands (Jack_Stand), otherwise Jack_TurnFromTo plays the on-the-spot turn from the old
 * facing to the new one. Returns true when a turn is running that ROTATETO waits for (its end is a `jackTurnEnded`
 * event); LOOKTO ignores it. A Jack who is not on the scene yet only takes the new facing.
 */
  lookAt(x: number, y: number, wait = true): boolean {
    // ROTATETO (case 0x76) does nothing while g_jackShown == 0; LOOKTO (case 0x60) is not gated
    if (wait && !this.jackShown) return false;
    const w = this.walker;
    const f = this.facingToward(x, y);
    if (this.jackHidden || !this.renderer.sprite(this.jackId)?.visible || this.jack.mode === "insertion") {
      w.dir = f.dir;
      w.mirror = f.mirror;
      return false;
    }
    const r = turnTo(this.tj, f);
    if (r.stand) {
      this.standJack();
      return false;
    }
    if (r.steps.length === 0) {
      if (this.jack.mode === "stand" && !this.tj.turn) this.standJack();
      return false;
    }
    // the walk is over: Jack keeps the pose of the last turn frame until something draws him again
    this.jack.mode = "stand";
    this.jack.walkFrame = WALK_FRAME_AFTER_STAND;
    // Jack_TurnFromTo clears g_turnMacroWaits; only ROTATETO sets it again
    this.turnFromScript = r.waits && wait;
    this.jack.delay = 0;
    this.jackFresh = true;
    return r.waits;
  }

  /**
 * STAY `name` (Script_Stay): `name` is a facing (L R U D LU RU LD RD). With `*` only the facing is set.
 * A Jack not on the scene yet is drawn standing. Otherwise the facing is taken without drawing and Jack_TurnFromTo plays the
 * turn from the old facing; a macro (not the call with 9999) waits for its end like for ROTATETO, the step
 * counter is zeroed. Without a turn Jack is drawn standing only if he was moving. Returns true when the macro waits.
 */
  stayJack(name: string, macro = true): boolean {
    const star = name.endsWith("*");
    const f = stayFacing(star ? name.slice(0, -1) : name);
    const w = this.walker;
    const old = { dir: w.dir, mirror: w.mirror };
    const shown = this.jackShown; // Script_Stay tests g_jackShown before sets it
    this.jackPlaced = true; // sets g_jackPlaced first, also for `*`
    w.dir = f.dir;
    w.mirror = f.mirror;
    this.jackShown = true;
    if (star) return false;
    if (!shown) {
      this.standJack();
      return false;
    }
    const moving = this.tj.moving;
    if (old.dir !== f.dir || old.mirror !== f.mirror) {
      w.walking = false;
      const steps = turnSequence(old.dir, old.mirror, f.dir, f.mirror, false);
      if (steps.length > 0) this.tj.turn = new TurnPlayer(steps, this.tj.uniform);
    }
    if (!this.tj.turn) {
      if (moving) this.standJack();
      return false;
    }
    this.turnFromScript = macro; // the idle check calls Script_Stay with 9999 (push 0x270f): no macro waits
    this.jack.mode = "stand";
    this.jack.walkFrame = WALK_FRAME_AFTER_STAND;
    this.jack.delay = 0;
    this.jackFresh = true;
    return macro;
  }

  /** One logic tick of the game counted for `g_idleFrames` (only while `g_logicFrozen == 0`; see `IDLE_FRAMES_PER_TICK`). */
  idleCount(): void {
    this.idleFrames += IDLE_FRAMES_PER_TICK;
  }

  /**
 * Game_Run (just before): a mouse button held (`g_mouseLeftDown`, `g_mouseRight`), the mouse moved (`g_mouseX` = screen x + scroll,
 * so a scroll counts too) or a macro holding the player (`g_macroPlayerLocked`) zeroes the counter. Once per frame.
 */
  idleInput(active: boolean): void {
    if (active) this.idleFrames = 0;
  }

  /**
 * The idle check of Game_Run, once per frame after `idleInput`: past `IDLE_LIMIT` frames, outside a scene
 * without control (`g_sceneNoControl`) and while Jack is not turning, Jack gets the reaction of `idleChoice`. An insertion
 * (or nothing, in the uniform with dir 2 / facing -1 - unreachable) sets `g_jackIdleIns` and the counter to `IDLE_AFTER`;
 * `STAY LD`/`RD` (uniform) leaves the counter, so after the turn the next check sees the new pose (`dir 3` -> `MOW34`, the coin
 * toss in the uniform). Facing back (dir 2) is always facing 1 (all writers of `g_jackFacing`), so in the uniform it is `STAY LD`. Nothing looks at Jack being hidden, walking or in
 * an insertion. `random` is the C library's rand(), called only where the game calls it (civilian, dir 0 / 3); `gun` is `GUN`.
 */
  idleCheck(noControl: boolean, random: () => number, gun: () => number): IdleChoice | null {
    if (this.idleFrames <= IDLE_LIMIT || noControl || this.tj.turn) return null;
    const w = this.walker;
    const dir = w.dir as JackDir;
    const uniform = this.tj.uniform;
    const rand = !uniform && (dir === 0 || dir === 3) ? random() : 0;
    const c = idleChoice(dir, w.mirror, uniform, rand, !uniform && dir === 0 && rand % 2 === 0 ? gun() : 0);
    if (c?.stay) {
      this.stayJack(c.stay, false);
      return c;
    }
    this.idleIns = true;
    if (c?.section) this.startGlobalInsertion(c.section, c.facing as Facing, c.scaleMul);
    this.idleFrames = IDLE_AFTER;
    return c;
  }

  /** The running turn stops (STAY, HIDE, an insertion): a macro waiting for it is released at the next tick. */
  private cancelTurn(): void {
    if (this.tj.turn && this.turnFromScript) this.turnEndedPending = true;
    this.tj.turn = null;
    this.turnFromScript = false;
  }

  /** RUNINSERTION JACK / INITFIRST JACK: scene insertion first, else GLOBAL.ICS. dir 0 right, 1 left, else as he looks. */
  jackInsertion(name: string, dir: number, count?: number): boolean {
    const facing = dir === 0 ? 1 : dir === 1 ? -1 : this.walker.mirror;
    const ins =
      findInsertion(this.insertions, name, facing) ??
      (this.globalIcs ? globalInsertion(this.globalIcs, name, facing) : null);
    if (!ins) return false;
    this.cancelTurn();
    this.tj.moving = false;
    this.jackHidden = false;
    this.walker.walking = false;
    this.jack.startInsertion(count === undefined ? ins : { ...ins, count: Math.min(count, ins.count) });
    // Script_ExecStep INITFIRST / RUNINSERTION: g_jackInsDelay = 0, so the first frame comes on the next
    // tick (Ins_StartGlobal alone waits a full delay) - no gap after a HIDE of the previous sprite
    if (!ins.global) {
      this.jack.delay = 0;
      this.jackFresh = true;
    }
    return true;
  }

  /** Scene insertion for a person (RUNINSERTION p name ...). */
  personInsertion(person: number, name: string, dir: 0 | 1 | 2, count?: number, fresh = false): boolean {
    const p = this.persons.persons[person];
    const ins = p ? findInsertion(this.insertions, name, 1) : null;
    if (!p || !ins) return false;
    p.startInsertion(count === undefined ? ins : { ...ins, count: Math.min(count, ins.count) }, dir, fresh);
    if (fresh) this.freshPersons.add(person);
    return true;
  }

  // --- objects ------------------------------------------------------------------------------

  hasObject(name: string): boolean {
    return this.objectByName.has(name);
  }

  objectAnim(name: string): ObjectAnimation | null {
    return this.objectByName.get(name)?.anim ?? null;
  }

  objectPosition(name: string): { x: number; y: number } | null {
    const o = this.objectByName.get(name);
    return o ? { x: o.x, y: o.y } : null;
  }

  /** SETPOSITIONE / SETPOSITIONEV (and MOVEE with relative = true). y >= 480 puts it below the screen. */
  setObjectPosition(name: string, x: number, y: number, relative = false): void {
    const o = this.objectByName.get(name);
    if (!o) return;
    o.x = relative ? o.x + x : x;
    o.y = relative ? o.y + y : y;
    // g_sceneObjX/Y feed the quad tests too (Depth_AboveQuadEdge, Object_QuadContains): the floor quad moves with the object
    moveObjectQuad(this.world.objects, o.z, o.x, o.y);
    // Script_ExecStep case 0x2b: a type -8 object's sprite is moved only to (0, 500); the animation step places it otherwise
    if (o.pbm16 && !(o.x === 0 && o.y === 500)) return;
    if (o.flx) {
      // an FLX slot's sprite follows too (Sprite_Set at the object's x, y with the picture it holds, no frame-rectangle offset):
      // SC006 / SC038 park a finished animation at (0, 500) this way, otherwise its last frame stays on the screen
      const sp = this.renderer.sprite(o.id);
      if (sp?.image && sp.image.width > 1) this.renderer.set(o.id, o.x, o.y, sp.image, SCALE_KEEP);
      return;
    }
    this.drawObject(o);
  }

  setObjectVisible(name: string, visible: boolean): void {
    const o = this.objectByName.get(name);
    if (!o || o.visible === visible) return;
    o.visible = visible;
    if (!visible) this.renderer.hide(o.id);
    else if (!o.flx) this.drawObject(o);
    else {
      const sp = this.renderer.sprite(o.id);
      if (sp?.image && sp.image.width > 1) this.renderer.set(o.id, sp.x, sp.y, sp.image, SCALE_KEEP);
    }
  }

  /** ANIMA: start the animation of an object. */
  startObjectAnim(name: string, a: AnimaArgs): boolean {
    const o = this.objectByName.get(name);
    if (!o?.anim) return false;
    o.anim.start(a);
    return true;
  }

  /**
 * A gesture of Jack (`Ins_StartGlobal`): a GLOBAL.ICS section with a full first delay. Unlike RUNINSERTION it
 * never looks at the scene's insertions. False when GLOBAL.ICS has no such section.
 */
  startGlobalInsertion(name: string, facing: 1 | -1, scaleMul = 1): boolean {
    const ins = this.globalIcs ? globalInsertion(this.globalIcs, name, facing, scaleMul) : null;
    if (!ins) return false;
    this.cancelTurn();
    this.tj.moving = false;
    this.jackHidden = false;
    this.walker.walking = false;
    this.jack.startInsertion(ins);
    return true;
  }

  /**
 * SHOWANIMAFRAME anim n (Script_ExecStep case 0x1b): the sprite of the animation's object shows ACI image `n` at the
 * object's place + the image's offset, at once, and the current image index becomes `n` (0 = the object's own picture).
 * Whether the animation runs is not looked: a running one overwrites the picture with its next frame. False when
 * the object or the image does not exist.
 */
  showAnimFrame(name: string, n: number): boolean {
    const o = this.objectByName.get(name);
    if (!o?.anim || o.flx || n < 0 || n >= o.anim.imageCount) return false;
    const f = o.anim.image(n);
    o.frameFile = f.file;
    o.frameDx = f.dx;
    o.frameDy = f.dy;
    o.light = 1;
    o.anim.index = n;
    this.drawObject(o);
    return true;
  }

  /**
 * SETDARKNESSANIMA anim f (case 0x67): the colour a type -8 picture is blended toward, `(0xffff, 0, f)`
 * (white at f = 0, darker as f grows). Drawn at the next frame change; a picture already shown is redrawn.
 */
  setAnimDarkness(name: string, f: number): boolean {
    const o = this.objectByName.get(name);
    if (!o) return false;
    o.darkness = mixColour(0xffff, 0, f);
    if (o.pbm16 && o.visible && !o.flx) this.drawObject(o);
    return true;
  }

  /**
 * BRIGHTNESSE object f (case 0x40): the channels of the colours of the object's picture are multiplied by `f` (the original
 * rewrites the palette of the sprite image, so repeated calls compound and the next unpacked frame is bright again).
 * Applies to the picture shown now; 16-bit pictures are left alone. False when there is no such object.
 */
  brightenObject(name: string, f: number): boolean {
    const o = this.objectByName.get(name);
    if (!o) return false;
    o.light = f32(o.light * f);
    if (o.visible && !o.flx) this.drawObject(o);
    return true;
  }

  /**
 * CLEARANIMABUFFER anim (case 0x81): `memset` of the animation's picture buffer (also its width and height): the sprite is empty
 * until the next frame is drawn. Only animations with a buffer (type 8 / -8 pictures, FLX slots) have one; for the rest nothing happens.
 */
  clearAnimBuffer(name: string): boolean {
    const o = this.objectByName.get(name);
    if (!o?.anim || !o.buffered) return false;
    this.renderer.set(o.id, o.x + o.frameDx, o.y + o.frameDy, BLANK, SCALE_KEEP);
    this.renderer.hide(o.id);
    o.visible = false;
    return true;
  }

  /**
 * MOVEEP object dx dy (case 0x4b): g_sceneObjX/Y += (dx, dy) and nothing else (MOVEE, case 0x3f, then moves the sprite).
 * The animation steps place their pictures at the object's coordinates, so the sprite follows with the next frame
 * (SC013 `ZMIATAJ`: Alice sweeping moves between the `ANIMA SASS1.PBM` phases).
 */
  moveObjectPoint(name: string, dx: number, dy: number): boolean {
    const o = this.objectByName.get(name);
    if (!o) return false;
    o.x += dx;
    o.y += dy;
    moveObjectQuad(this.world.objects, o.z, o.x, o.y);
    return true;
  }

  /**
 * RELATIVEMULP person f (case 0x89): g_personLightScale[person] = f, the factor of the person's light range and shadow size
 * (PCS field 4). Jack (`person` null): g_jackShadowScale, the factor of Jack's shadow size.
 */
  setPersonLightScale(person: number | null, f: number): boolean {
    if (person === null) {
      this.jackShadowScale = f32(f);
      return true;
    }
    const p = this.persons.persons[person];
    if (!p) return false;
    p.def.lightScale = f32(f);
    return true;
  }

  /**
 * The visible sprites of objects, persons and Jack in drawing order (last = on top) as the click code
 * sees them: `pixelHit` = an opaque pixel under the point (world
 * coordinates); `flagged` = an opaque pixel inside `rect` (the cursor's redraw rectangle, areas/rect.ts; pass 1 of the hit tests). Jack is a target like the others, under the name "JACK" (`<verb>-JACK`, and the click that opens the coat).
 */
  spriteCandidates(px: number, py: number, rect: HitRect | null = null): SpriteCandidate[] {
    const named: { id: number; name: string }[] = [
      ...this.objects.filter((o) => !o.flx).map((o) => ({ id: o.id, name: o.name })),
      ...[...this.objectByName.values()].filter((o) => !o.anim).map((o) => ({ id: o.id, name: o.name })),
      ...this.persons.persons.map((p, i) => ({ id: this.personIds[i], name: p.def.name })),
      { id: this.jackId, name: "JACK" },
    ];
    const out: { z: number; c: SpriteCandidate }[] = [];
    for (const { id, name } of named) {
      const sp = this.renderer.sprite(id);
      if (!sp?.visible || !sp.image || sp.w <= 0 || sp.h <= 0) continue;
      out.push({ z: this.renderer.sprites.indexOf(id), c: { name, pixelHit: spritePixelHit(sp, px, py), flagged: !!rect && spriteFlagged({ x: sp.x, y: sp.y, w: sp.w, h: sp.h, opaque: (dx, dy) => spritePixelHit(sp, sp.x + dx, sp.y + dy) }, rect) } });
    }
    return out.sort((a, b) => a.z - b.z).map((x) => x.c);
  }

  /** Is an opaque pixel of Jack's sprite under the point (world coordinates)? The test of for Jack's sprite `g_jackSprite`. */
  jackHit(px: number, py: number): boolean {
    const sp = this.renderer.sprite(this.jackId);
    return !!sp?.visible && !!sp.image && sp.w > 0 && sp.h > 0 && spritePixelHit(sp, px, py);
  }

  // --- the tick -----------------------------------------------------------------------------

  /** One 15 ms logic tick: Jack (walk step + frame), persons, object animations, camera. */
  tick(): TickResult {
    this.ticks++;
    this.events = [];
    const result: TickResult = { stepped: false, arrived: false, sounds: [], personSounds: [] };
    this.jackFresh = false;
    this.freshPersons.clear();
    this.jackPhase(result);
    this.tickPersons(result);
    for (const o of this.objects) {
      if (!o.anim) continue;
      const due = o.anim.active && o.anim.counter - 1 <= 0;
      const at = this.animImage(o);
      const t = o.anim.tick();
      if (o.flx) {
        if (t.frame) this.stepFlx(o);
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
  private jackPhase(result: TickResult): void {
    this.jack.scrollX = this.scrollX;
    if (this.turnEndedPending) {
      this.turnEndedPending = false;
      this.events.push({ kind: "jackTurnEnded" });
    }
    if (this.tj.turn && this.jack.mode !== "insertion") this.turnTick(result);
    else this.jackTick(result);
    if (result.arrived) {
      this.walker.forced = null;
      this.apply(this.jack.stand(this.pose()));
      this.events.push({ kind: "jackArrived" });
    }
    if (result.stepped) {
      this.arrangeJack();
      if (this.scripted) this.scrollRule();
    }
  }

  /**
 * The first steps of the operations a command (or a click) just started, in the frame of the command: Game_Run runs the
 * interpreter (step 20) before steps 26-31 of the same frame, and WALKTO / RUNINSERTION JACK, INITFIRST and STAY with a turn
 * zero their step counters, so the first walk step or insertion frame needs no timer tick. The
 * counters are not decremented here (that is Game_TimerTick's job). Returns null when nothing was started.
 */
  firstSteps(): TickResult | null {
    if (!this.jackFresh && this.freshPersons.size === 0) return null;
    this.events = [];
    const result: TickResult = { stepped: false, arrived: false, sounds: [], personSounds: [] };
    if (this.jackFresh) {
      this.jackFresh = false;
      this.jack.delay++; // the animator decrements first
      this.jackPhase(result);
    }
    if (this.freshPersons.size > 0) {
      const env = this.personEnv();
      const fresh = [...this.freshPersons].sort((a, b) => a - b);
      this.freshPersons.clear();
      for (const i of fresh) {
        const p = this.persons.persons[i];
        if (!p.insertionDue) continue;
        this.applyPerson(i, p.insertionStep(env), result);
      }
    }
    return result;
  }

  /** Jack's frame or step of this tick when no turn runs (the walk, an insertion, nothing). */
  private jackTick(result: TickResult): void {
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
    if (inserting && r.update.sprite && !this.jackHidden) this.arrangeJack(true);
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
  private turnTick(result: TickResult): void {
    const w = this.walker;
    const tj = this.tj;
    const at = { x: w.x, y: w.y, scale: w.scale };
    // turningTick counts walker.timer; the game has one counter (g_jackInsDelay), kept in the animator
    w.timer = this.jack.delay;
    const t = turningTick(tj, this.world, stepTicks(this.walkSpeedOption), turnFrameTicks(this.walkSpeedOption, this.jack.frameDelay));
    this.jack.delay = w.timer;
    const turn: TurnTick | null = t.turn;
    if (turn?.frame && !this.jackHidden) {
      this.drawTurnFrame(turn.frame, at);
      this.arrangeJack();
    }
    if (turn?.stepSound) result.sounds.push(this.turnStep(at));
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
  private turnStep(at: { x: number; scale: number }): SoundEvent {
    const [v1, v2] = stepVolumes(at.scale, at.x, this.scrollX);
    this.turnStepToggle = !this.turnStepToggle;
    return { sound: this.turnStepToggle ? "KROK1.SND" : "KROK2.SND", channels: [2, 1], volumes: [v2, v1], kind: "step" };
  }

  private hotSpot(ref: { file: string; index: number }): HotSpot {
    let table = this.hotSpots.get(ref.file);
    if (!table) {
      table = parseSfb(this.src.resource.read(ref.file));
      this.hotSpots.set(ref.file, table);
    }
    return table[ref.index];
  }

  /** the turn frame, and its shadow. */
  private drawTurnFrame(f: TurnFrame, at: { x: number; y: number; scale: number }): void {
    const [x, y] = placeTurnFrame(at.x, at.y, this.hotSpot(f.hotSpot), f.facing, f.scale);
    const img = this.jackImage("resource", f.file);
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
    this.drawJackShadow(0, s);
    this.renderer.hide(this.shadowIds[1]);
  }

  /**
 * CHKDISTANCE (Jack_AvoidPerson), after every step of a person and every frame of its insertion: a person
 * walking at Jack makes him stop (when it goes away from him) or step aside. The walk is a click's (planWalk +
 * Jack_WalkTo); the flag is set whether or not a path was found.
 */
  private checkAvoid(i: number): void {
    const p = this.persons.persons[i];
    if (this.playerLocked || !p.checkDistance || this.jackHidden || this.jack.mode === "insertion") return;
    const w = this.walker;
    const r = avoidPerson(
      { x: w.x, y: w.y, scale: w.scale },
      { x: p.x, y: p.y, scale: p.scale, shadowDx: p.shadowDx, shadowDy: p.shadowDy, velX: p.vx, velY: p.vy },
      this.world,
      this.jackAvoiding,
    );
    if (r.kind === "stand") {
      if (this.tj.turn || !w.walking) return;
      applyStand(w);
      this.standJack();
    } else if (r.kind === "walk") {
      // Jack_WalkTo runs whether or not a path is found: it ends the running OUTMACRO macros first (Script_InterruptOutMacros(-1))
      this.events.push({ kind: "jackAvoidWalk" });
      const plan = planWalk(this.world, w, r.target);
      if (plan) this.walkPlan(plan);
      this.jackAvoiding = true;
    }
  }

  /** of Game_Run: what an ANIMAEFFECT entry / a macro of the animation compares with. */
  private animImage(o: ObjectSprite): number {
    const a = o.anim!;
    if (a.mode === 3 || a.mode === 4) return a.pos[a.rec] ?? 0;
    return a.index;
  }

  /**
 * Where a caption above a person goes (Script_ExecStep case 10): center x of the sprite, top - 10.
 * `person` is an index of `persons`, null = Jack. Without a drawn sprite the feet position stands in.
 */
  speakerPoint(person: number | null): { x: number; y: number } {
    const id = person === null ? this.jackId : this.personIds[person];
    const sp = id === undefined ? undefined : this.renderer.sprite(id);
    if (sp?.visible && sp.w > 0) return { x: sp.x + Math.trunc(sp.w / 2), y: sp.y - 10 };
    const p = person === null ? this.walker : this.persons.persons[person];
    return { x: Math.trunc(p?.x ?? 320), y: Math.trunc((p?.y ?? 240) - 10) };
  }

  /** Game_Run: Jack's step starts a scroll when he and his goal are outside the margin. */
  private scrollRule(): void {
    const w = this.walker;
    if (!w.walking) return;
    const goal = w.path.length ? w.path[w.path.length - 1].x : w.target.x;
    this.scrollDir = walkScrollDirection(this.scrollDir, w.x, goal, this.scrollX, this.marginL, this.marginR);
  }

  /** SETSHIFTX: scroll position (alignScroll: multiple of 4, 0..376). */
  setScroll(x: number): void {
    this.scrollX = alignScroll(x);
  }

  /** SETSCROLLX1 / SETSCROLLX2 */
  setScrollLimits(min: number | null, max: number | null): void {
    const [lo, hi] = scrollLimits(min ?? this.scrollMin, max ?? this.scrollMax);
    this.scrollMin = lo;
    this.scrollMax = hi;
  }

  private personEnv(): { scrollX: number; lights: Scene["ccg"]["lights"]; brightness: number; shadows: boolean } {
    return { scrollX: this.scrollX, lights: this.scene.ccg.lights, brightness: this.brightness, shadows: this.shadowsOn };
  }

  private tickPersons(result: TickResult): void {
    const env = this.personEnv();
    this.persons.tick(env).forEach((u, i) => {
      if (u) this.applyPerson(i, u, result);
    });
  }

  private applyPerson(i: number, u: PersonUpdate, result: TickResult): void {
    const s = u.sprite;
    if (s) {
      const img = this.personImage(s.file, s.source, s.brightness);
      this.renderer.set(this.personIds[i], s.x, s.y, img, s.mirrored ? -s.scale : s.scale);
    }
    result.personSounds.push(...u.sounds);
    if (u.shadow) this.drawPersonShadow(i, u.shadow);
    for (const e of u.events) {
      if (e.kind === "walkArrived") this.events.push({ kind: "personArrived", person: i });
      else this.events.push({ kind: "personInsertionEnded", person: i, name: e.name });
    }
    const p = this.persons.persons[i];
    if (this.insReleaseEarly && u.sprite && p.inserting) {
      // Game_Run: the insertion drew a frame while was set: it stops and the flag is spent
      p.clearInsertion();
      this.insReleaseEarly = false;
      this.events.push({ kind: "personInsertionReleased", person: i });
    }
    if (u.sprite) {
      this.arrangePerson(i, !!u.insertion);
      this.checkAvoid(i);
    }
  }

  /**
 * Drawing order of a person after a step: for every other sprite the person's
 * rectangle overlaps - Jack and other persons by the y of the feet, objects by their floor quads - the sprite
 * moves under / over it when it lies on the wrong side; otherwise the order stays (scripts set it: PUNDERE...).
 */
  private arrangePerson(i: number, insertion = false): void {
    const p = this.persons.persons[i];
    if (!p.checkDepth) return;
    const id = this.personIds[i];
    const self = this.renderer.sprite(id);
    if (!self?.visible) return;
    for (const other of this.depthPartners(self)) {
      let rel: DepthRelation = null;
      let target = other.id;
      if (other.kind === "object" && insertion) {
        if (!this.world.objects[other.index]) continue;
        // after an insertion frame: plain y comparisons with quad corners 0 / 2, not the edge tests of the walking step
        const d = personObjectDepthInsertion(this.world.objects[other.index], p.y);
        const items = this.renderer.sprites.items;
        const me = items.findIndex((s) => s.id === id);
        const them = items.findIndex((s) => s.id === other.id);
        if (d.behind && them < me) this.placeSprite(id, other.id, false);
        else if (d.front && them > me) this.placeSprite(id, other.id, true);
        continue;
      }
      if (other.kind === "object") rel = personObjectDepth(this.world.objects[other.index], p.x, p.y);
      else if (other.kind === "person") {
        if (other.index === i) continue;
        rel = behindByY(p.y, this.persons.persons[other.index].y);
      } else {
        if (this.jackHidden) continue;
        rel = behindByY(p.y, this.walker.y);
        target = this.jackId;
      }
      if (rel === "behind") this.placeSprite(id, target, false);
      else if (rel === "front") this.placeSprite(id, target, true);
    }
  }

  /** Jack and the persons / objects the depth test knows, among the visible sprites overlapping `self`, in list order. */
  private depthPartners(self: Sprite): { kind: "object" | "person" | "jack"; index: number; id: number }[] {
    const known = new Map<number, { kind: "object" | "person" | "jack"; index: number; id: number }>();
    for (const [k, id] of this.objectSpriteIds) known.set(id, { kind: "object", index: k, id });
    this.personIds.forEach((id, k) => known.set(id, { kind: "person", index: k, id }));
    known.set(this.jackId, { kind: "jack", index: 0, id: this.jackId });
    const out: { kind: "object" | "person" | "jack"; index: number; id: number }[] = [];
    for (const sp of [...this.renderer.sprites.items]) {
      const k = known.get(sp.id);
      if (!k || sp.id === self.id || !sp.visible || !sp.image) continue;
      if (sp.x < self.x + self.w && self.x < sp.x + sp.w && sp.y < self.y + self.h && self.y < sp.y + sp.h) out.push(k);
    }
    return out;
  }

  private personImage(file: string, source: string, brightness: number): Image16 {
    const pak = source === "scene" ? (this.src.phk.find(file) ? this.src.phk : this.src.ph2) : source === "global" ? this.src.global : this.src.resource;
    if (!pak) throw new Error(`${this.src.name}: no archive for ${source}:${file}`);
    if (brightness < 1) return decodePbm(brightenPbm(pak.read(file), brightness), file);
    const key = `${source}:${file}`;
    let img = this.cache.get(key);
    if (!img) {
      const data = pak.read(file);
      img = decodeSceneImage(data, file);
      this.cache.set(key, img);
    }
    return img;
  }

  private initialScroll(x: number): number {
    let s = this.scene.ccg.wide ? Math.max(0, Math.min(this.scene.ccg.scroll, this.bgWidth - 640)) : 0;
    for (let i = 0; i < 300; i++) {
      const n = followScroll(s, x, this.bgWidth);
      if (n === s) break;
      s = n;
    }
    return s;
  }

  private scriptedStartScroll(): number {
    return this.scene.ccg.wide ? alignScroll(Math.max(0, Math.min(this.scene.ccg.scroll, this.bgWidth - 640))) : 0;
  }

  private centroid(): { x: number; y: number } {
    const t = this.scene.ccg.walk[0];
    if (!t) return { x: 320, y: 240 };
    return { x: Math.trunc((t[0] + t[2] + t[4]) / 3), y: Math.trunc((t[1] + t[3] + t[5]) / 3) };
  }

  private image(source: FrameSprite["source"] | "phk", file: string, pbm = false): Image16 {
    const key = `${source}:${file}`;
    let img = this.cache.get(key);
    if (!img) {
      const pak =
        source === "resource" ? this.src.resource : source === "scene" ? this.src.ph2 : source === "global" ? this.src.global : this.src.phk;
      if (!pak) throw new Error(`${this.src.name}: no archive for ${key}`);
      const data = pak.read(file);
      img = decodeSceneImage(data, file, pbm);
      this.cache.set(key, img);
    }
    return img;
  }

  /**
 * Jack's frame under the scene lights (Game_Run walk, insertion, Jack_Stand): the palette
 * is scaled when the brightness is < 1, like the persons' frames.
 */
  private jackImage(source: FrameSprite["source"], file: string): Image16 {
    const pose = this.pose();
    const lit = jackBrightness(pose.x, pose.y, this.scene.ccg.lights, pose.scale, this.brightness);
    // outside every light's range Jack_Stand leaves g_jackBrightness as it was
    const inRange = lit > this.brightness;
    if (this.jack.mode !== "stand" || inRange) this.jackLight = lit;
    if (this.jackLight >= 1 || !file.toUpperCase().endsWith(".PBM")) return this.image(source, file);
    const pak = source === "resource" ? this.src.resource : source === "scene" ? this.src.ph2 : source === "global" ? this.src.global : this.src.phk;
    if (!pak) throw new Error(`${this.src.name}: no archive for ${source}:${file}`);
    return decodePbm(brightenPbm(pak.read(file), this.jackLight), file);
  }

  private addObjects(animate: boolean): void {
    const { ccg, objectAnims } = this.scene;
    const anims = new Map(objectAnims.map((a) => [a.name, a]));
    ccg.objects.slice(0, ccg.count).forEach((o, z) => {
      if (o.flx) {
        this.addFlxObject(o, z, anims.get(o.name));
        return;
      }
      if (o.kind !== "graphic" || !this.src.phk.find(o.name)) return;
      const offscreen = o.y >= 480 || o.y < -400;
      // Scene_RefreshBackground skips type -8 objects (their sprite stays invisible until an animation step shows it)
      const pbm16 = o.type === TYPE_PBM_ANIMATED;
      const shown = shownAtSceneStart(o.type, o.y);
      // the demo (M1) leaves out what sits outside the screen; in the game the scripts move it in later
      if (offscreen && !this.scripted) return;
      let img: Image16;
      try {
        img = this.image("phk", o.name, o.type === 8 || o.type === TYPE_PBM_ANIMATED);
      } catch {
        return;
      }
      const scale = o.type === 8 ? o.scale / 1e6 : SCALE_KEEP;
      const id = this.renderer.add(img, z, scale);
      const a = anims.get(o.name);
      const anim = a ? new ObjectAnimation(a) : null;
      const sprite: ObjectSprite = {
        id, name: o.name, z, anim, x: o.x, y: o.y, scale, base: img, visible: shown, pbm16, frameFile: null, frameDx: 0, frameDy: 0,
        buffered: o.type === 8 || pbm16, light: 1, darkness: GLASS_WHITE,
      };
      if (shown) this.renderer.set(id, o.x, o.y, img, scale);
      this.drawnObjects.add(z);
      this.objectSpriteIds.set(z, id);
      if (!this.objectByName.has(o.name)) this.objectByName.set(o.name, sprite);
      if (anim) {
        if (animate && a) anim.start(a.recs.length ? { mode: 4, delay: 6, rec: 0 } : { mode: 2, delay: 6 });
        this.objects.push(sprite);
      }
    });
  }

  /**
 * `FLXn` object: no image of its own; ANIMA mode 5/6 plays a .FLX file of its .ACI section on a sprite at the
 * object's position + the frame rectangle's (x, y) (Game_Run, Sprite_Set(g_objAnimSprite[anim]...)).
 * The sprite exists from the start, invisible, so that CHWINDOW can clip it.
 */
  private addFlxObject(o: SceneObject, z: number, aci: ObjectAnim | undefined): void {
    if (!aci || this.objectByName.has(o.name)) return;
    const blank: Image16 = { width: 1, height: 1, kind: "rgb565", pixels: new Uint16Array(1) };
    const id = this.renderer.add(blank, z, SCALE_KEEP);
    const anim = new ObjectAnimation(aci);
    const sprite: ObjectSprite = {
      id, name: o.name, z, anim, x: o.x, y: o.y, scale: SCALE_KEEP, base: blank, visible: false, frameFile: null, frameDx: 0, frameDy: 0,
      flx: { play: null, rec: 0 }, buffered: true, light: 1, darkness: GLASS_WHITE,
    };
    this.objectByName.set(o.name, sprite);
    this.objects.push(sprite);
  }

  /**
 * ANIMA mode 5 (once) / 6 (loop) on an FLX slot: record `rec` of its section names the file (Script_ExecStep case 4:
 * `[anim * 300 + rec]`); mode 6 restarts with record 0 whatever `rec` was. The sprite buffer is cleared.
 */
  startFlxAnim(name: string, mode: 5 | 6, delay: number, rec: number): boolean {
    const o = this.objectByName.get(name);
    if (!o?.flx || !o.anim) return false;
    const files = o.anim.anim.images;
    const file = files[rec]?.[0];
    const first = files[0]?.[0];
    if (typeof file !== "string" || typeof first !== "string") return false;
    const load = (f: string) => new Flx(this.src.phk.read(f));
    o.flx.play = new FlxAnimation(load(file), mode === 6, load(first));
    o.flx.rec = rec;
    o.anim.mode = mode;
    o.anim.active = true;
    o.anim.delay = delay;
    o.anim.counter = delay;
    if (o.visible) this.renderer.hide(o.id);
    o.visible = false;
    return true;
  }

  /** One due FLX step (Game_Run 0x4368xx): the frame counter is the image for ACTIVEMACROANIMA / ANIMAEFFECT. */
  private stepFlx(o: ObjectSprite): void {
    const f = o.flx!;
    const play = f.play;
    if (!play || play.isFinished) {
      o.anim!.active = false;
      return;
    }
    this.events.push({ kind: "animFrame", anim: o.name, image: play.counter, rec: f.rec, flx: true });
    const s = play.step();
    this.stepAnimShadow(o, !!s.sprite, s.rect, play.header.mode);
    if (s.sprite) {
      const img: Image16 = { width: s.sprite.width, height: s.sprite.height, kind: "rgb565", pixels: s.sprite.pixels };
      this.renderer.set(o.id, o.x + s.sprite.x, o.y + s.sprite.y, img, SCALE_KEEP);
      o.visible = true;
    }
    if (s.finished) {
      o.anim!.active = false;
      this.events.push({ kind: "animEnded", anim: o.name, reason: "end" });
    }
  }

  private drawObject(o: ObjectSprite): void {
    let img = o.frameFile ? this.image("phk", o.frameFile) : o.base;
    if (o.light < 1) img = brightenImage(img, o.light);
    // Game_Run (type -8, g_sceneObjWasPbm16 = 1): the picture is a mask blended over the scene toward the animation's colour
    if (o.pbm16) {
      const x = o.x + o.frameDx;
      const y = o.y + o.frameDy;
      img = blendOverBackdrop(img, this.composeRegion(x, y, img.width, img.height, o.z, o.id), 0, 0, o.darkness);
    }
    this.renderer.set(o.id, o.x + o.frameDx, o.y + o.frameDy, img, o.scale);
    o.visible = true;
  }

  private apply(u: JackUpdate): void {
    if (u.sprite) {
      const img = this.jackImage(u.sprite.source, u.sprite.file);
      this.renderer.set(this.jackId, u.sprite.x, u.sprite.y, img, u.sprite.mirrored ? -u.sprite.scale : u.sprite.scale);
    }
    u.shadows?.forEach((s: ShadowSprite | null | undefined, i) => {
      if (s === undefined) return;
      if (s === null) this.renderer.hide(this.shadowIds[i]);
      else this.drawJackShadow(i as 0 | 1, s);
    });
  }

  /**
 * Jack against the sprites his rectangle overlaps (Game_Run, again): persons by the y of the
 * feet, objects by their floor quads. Like the original it never sorts: Jack's sprite (and his
 * shadows) moves under / over the other one only when it lies on the wrong side.
 */
  private arrangeJack(edgesOnly = false): void {
    if (this.jackHidden || !this.jackCheckDepth) return;
    const self = this.renderer.sprite(this.jackId);
    if (!self?.visible) return;
    const at = { x: Math.trunc(this.walker.x), y: Math.trunc(this.walker.y) };
    for (const other of this.depthPartners(self)) {
      let rel: DepthRelation = null;
      if (other.kind === "object") rel = edgesOnly ? personObjectDepth(this.world.objects[other.index], at.x, at.y) : objectDepth(this.world.objects[other.index], at);
      else if (other.kind === "person") rel = personDepth(this.walker.y, this.persons.persons[other.index].y);
      if (rel !== null) this.placeSprite(this.jackId, other.id, rel === "front");
    }
  }
}

/**
 *, pass 0: the point (g_clickX, g_clickY, shorts) lies strictly inside the sprite's rectangle
 * (`0 < dx < w`, `0 < dy < h`) and the pixel under it is not transparent. A scaled sprite is sampled at its own
 * resolution; a mirrored one (negative scale) from the other side.
 */
export function spritePixelHit(
  sp: { x: number; y: number; w: number; h: number; scale: number; image?: Surface16 | null },
  px: number,
  py: number,
): boolean {
  const img = sp.image;
  if (!img) return false;
  const dx = Math.trunc(px) - sp.x;
  const dy = Math.trunc(py) - sp.y;
  if (!(dx > 0 && dx < sp.w && dy > 0 && dy < sp.h)) return false;
  let sx = Math.trunc((dx * img.width) / sp.w);
  const sy = Math.trunc((dy * img.height) / sp.h);
  if (sp.scale < 0) sx = img.width - 1 - sx;
  return (img.pixels[sy * strideOf(img) + sx] ?? 0) !== 0;
}
