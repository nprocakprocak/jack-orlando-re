// Fields the scene player's methods read. The class keeps them private; a wrapper casts this.

import type {
  FrameSprite,
  InsertionTable,
  JackAnimator,
  JackPose,
  JackUpdate,
  ObjectAnimation,
  SoundEvent,
} from "../anim";
import type { Image16 } from "../formats/bm";
import type { HotSpot, Ics } from "../formats/global";
import type { Pak } from "../formats/pak";
import type { Scene } from "../formats/scene";
import type { PersonSound, ScenePersons } from "../persons";
import type { PersonShadow, ShadowTables } from "../persons/shadow";
import type { Renderer } from "../render";
import type { FlxAnimation } from "../video/flx";
import type { TurningJack } from "../walk/turn";
import type { Walker, WalkPlan, WalkWorld } from "../walk";

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

export interface ObjectSprite {
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

/** The scene player, including the fields the class keeps private. A wrapper casts this. */
export interface ScenePlayerState {
  readonly src: SceneSources;
  readonly scene: Scene;
  readonly world: WalkWorld;
  readonly hasWalkArea: boolean;
  readonly renderer: Renderer;
  readonly jack: JackAnimator;
  readonly walker: Walker;
  readonly turning: TurningJack;
  readonly insertions: InsertionTable;
  readonly persons: ScenePersons;
  readonly bgWidth: number;
  readonly scripted: boolean;
  scrollX: number;
  ticks: number;
  events: SceneEvent[];
  jackHidden: boolean;
  jackCheckDepth: boolean;
  brightness: number;
  jackShadowScale: number;
  jackLight: number;
  jackAvoiding: boolean;
  playerLocked: boolean;
  idleFrames: number;
  idleIns: boolean;
  turnFromScript: boolean;
  turnEndedPending: boolean;
  insReleaseEarly: boolean;
  jackFresh: boolean;
  readonly freshPersons: Set<number>;
  turnStepToggle: boolean;
  readonly hotSpots: Map<string, HotSpot[]>;
  fixedScale: number | null;
  jackShown: boolean;
  jackPlaced: boolean;
  scrollDir: number;
  bgWide: boolean;
  scrollMin: number;
  scrollMax: number;
  marginL: number;
  marginR: number;
  walkSpeedOption: number;
  readonly cache: Map<string, Image16>;
  readonly objects: ObjectSprite[];
  readonly objectByName: Map<string, ObjectSprite>;
  jackId: number;
  shadowIds: [number, number];
  personIds: number[];
  readonly shadowsOn: boolean;
  readonly jackShadows: [PersonShadow, PersonShadow];
  readonly shadowTables: ShadowTables;
  backdrop: Image16;
  backdropOwned: boolean;
  shadowOne: string | null;
  readonly extraShadowId: number;
  readonly animShadows: Map<
    string,
    {
      jack: boolean;
      person: number;
      points: readonly (readonly number[])[];
      step: number;
      clear: boolean;
    }
  >;
  readonly roundMask: Image16;
  personShadowIds: number[];
  personMasks: (Image16 | null)[];
  readonly drawnObjects: Set<number>;
  readonly objectSpriteIds: Map<number, number>;
  readonly globalIcs: Ics | null;
  pose(): JackPose;
  walkPlan(plan: WalkPlan, forced?: number | null): boolean;
  standJack(): void;
  refreshBackground(): void;
  stayJack(name: string, macro?: boolean): boolean;
  startGlobalInsertion(name: string, facing: 1 | -1, scaleMul?: number): boolean;
  image(source: FrameSprite["source"] | "phk", file: string, pbm?: boolean): Image16;
  drawObject(o: ObjectSprite): void;
  composeRegion(x: number, y: number, w: number, h: number, maxZ: number, excludeId: number): Image16;
  apply(u: JackUpdate): void;
  jackTick(result: TickResult): void;
}
