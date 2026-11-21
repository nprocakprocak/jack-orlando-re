// The game as the original runs it, without DOM: a scene (ScenePlayer) driven by its macro
// interpreter, the cursor, clicks on areas / sprites / the floor, and the change of scenes
// (GOTOSCENE, optionally through the fade of REFRESHSCREEN). The host feeds
// it time and the mouse and draws what `view()` says.
// Frame order: the scene is loaded, the area flags
// are reset, [PRE] runs to its end at once, [INIT] starts, then every frame: cursor and clicks
//, one command of every active macro, and on every 15 ms logic
// tick the animations (Game_TimerTick + the step blocks of Game_Run).
import { uniformAfterLoad } from "../anim/jack";
import {
  allCursorFiles, lensMaskFiles, Cursor, ANIM_PERIOD, CursorEnable, enableDrawVerb, frameOverlay, noHaveGunCursor, type CursorDraw, type LensMasks,
} from "../cursor";
import {
  composeFace,
  DialogController,
  DIALOG_TABLES,
  encodeMazovia,
  FACE_WINDOW,
  FACE_WINDOW_Y,
  faceWindowX,
  ReleaseGate,
  rowStyle,
  type DialogHost,
  type DialogTables,
  type Side,
} from "../dialog";
import { gameVolumeToLevel } from "../audio/mixer";
import { prepareSound } from "../audio/prepare";
import type { AudioBackend } from "../audio/types";
import { Sound } from "../formats/sound";
import { decodeBm, type Image16 } from "../formats/bm";
import { parseSceneDialogs, type Dcn } from "../formats/dialog";
import { JACK_REFUSALS } from "./refusals";
import { parseFnt, renderText, textWidth, type Font } from "../formats/fnt";
import { fcmEffectFile, parseFcm, parseCm, parseIcs, type Ics } from "../formats/global";
import { Pak } from "../formats/pak";
import { decodePbm } from "../formats/pbm";
import { decrypt } from "../formats/textcrypt";
import { loadSceneSounds, swapChannel, type SceneSounds } from "../sfx";
import type { MoviePlayer, MovieSoundSink } from "../video";
import { PlayAudio, DEFAULT_TRACK, type PlayConfig } from "./audio";
import { FilmRun, isOutro, MASK_WIDTHS, openMovie } from "./film";
import { BUNDLED_REMAP, faceWindowPixels, type Remap } from "./facewin";
import type { Overlay } from "./overlay";
import {
  AreaState,
  areaClick,
  areaReaction,
  interpreterPort,
  macroMouseX,
  ROPE_DESCENT_FIX,
  resolveAreaRef,
  reactionExists,
  resolveClick,
  spriteClickTarget,
  spriteReaction,
  startReaction,
  zoneCursorMode,
  cursorHitRect,
  type HitRect,
  type Action,
  type ClickOutcome,
} from "../areas";
import type { Surface16 } from "../render";
import { SceneTransition } from "../render";
import { blitCopy, createSurface } from "../render/surface";
import { GuiMenu, loadMenuAssets, TEXTS_PL, type MenuAction, type MenuAssets } from "../gui";
import {
  BulletMenu, debugVerbAllowed, highlightImageName, ICONS, bulletImageName, VerbMenu, VERB_TEXTS, type BulletEvent,
} from "../bulletmenu";
import {
  CoatScreen, DIK_COAT, Inventory, InventoryError, itemNameLookup, loadCoatAssets, type CoatExit, type CoatHost,
} from "../inventory";
import { WheelAccumulator } from "../inventory/wheel";
import { TopBar, loadTopBarAssets, type TopBarHost } from "../inventory/topbar";
import { DIK, keyActions, mapAvailableIn, sceneChapter, sceneNumber, type KeyContext } from "../keys";
import { DIK_MAP, loadMiniMapAssets, MiniMapScreen } from "../minimap";
import { LOGIC_TICK_MS } from "../core/constants";
import { defaultConfig, type GameConfig } from "../settings/config";
import { VAR_SLOTS } from "../formats/save";
import { NoticeStrip, NOTICE_Y_QUICKSAVE } from "../keys/notice";
import {
  QUICK_NAME_PL, SlotWindow, applyInventory, loadedVars, namedVars, type JackPose as SavedPose, type LoadedState,
  type ReadResult, type SaveManager, type SaveState,
} from "../save";
import { ScenePlayer, type SceneEvent, type TickResult } from "../scene";
import { restoredScroll } from "../scene/scroll";
import { ENDIF, IF_CODES } from "../script/compiler";
import { compileMcc, Interpreter, parseVariables, Variables, type Command, type LogEntry } from "../script";
import { findWalkTriangle, planWalk } from "../walk";
import { edgeFrame, noControlDir, type EdgeState } from "./edgescroll";
import { isNoControlScene, MAP_SCENE, mapClickAreas, noControlCursor } from "../map";
import { AutoIncClock, SceneHost, syncJackVars, TALK_TICKS, type HostEnv, type ItemPort } from "./host";

/** Bytes the host supplies. `read` returns one relative path. `exists` is optional. */
export interface GameFiles {
  read(rel: string): Promise<Uint8Array>;
  /** false when the file is not there (Data/<scene>.ph2 of a scene without insertions) */
  exists?(rel: string): Promise<boolean>;
}

/** Timer_Sleep(10) in the music fade before a film: one volume step per 10 ms */
export const MOVIE_FADE_STEP_MS = 10;

export type Phase = "loading" | "playing" | "fading" | "movie" | "film" | "finished";

/** Mouse state for one frame. Coordinates are screen pixels (0..639, 0..479). */
export interface PlayInput {
  x: number;
  y: number;
  /** left button went down since the last frame (latched by the page) */
  pressed: boolean;
  /** left button is down */
  down: boolean;
  inWindow: boolean;
  /** Esc is down: it ends a film (Game_Run, Input_IsKeyDown(1)) */
  escape?: boolean;
  /** right / middle button is down (`g_mouseRight`, `009d281c`): the bullet menu, the coat */
  right?: boolean;
  middle?: boolean;
  /** the button went down since the last frame (latched by the page); absent = taken from the change of `right` / `middle` */
  rightPressed?: boolean;
  middlePressed?: boolean;
  /** Ctrl is down (`Input_IsKeyDown(0x1d)`): the hidden points of the coat */
  ctrl?: boolean;
}

export interface PlayOptions {
  /** first scene, default SC001 */
  start?: string;
  /** g_lastScene variable LAST is a game variable set by the scripts; this presets it (to start in the middle) */
  vars?: Record<string, number>;
  /** logic ticks a talk line waits */
  talkTicks?: number;
  /** answer of DIALOG number `id` the n-th time it is asked (default 0: the first answer; the menu is) */
  answer?: (id: number, asked: number) => number;
  /** WalkSpeed option (default 1) */
  walkSpeed?: number;
  /**
 * The dialog layer (faces, captions, the answer menu, speech): default on. `false`: a line waits
 * `talkTicks`, and `DIALOG` takes the answer from `answer`.
 */
  dialogs?: boolean;
  /** Where the sound goes (WebAudioBackend in the page, a fake one in tests); null / absent = a game without sound */
  backend?: AudioBackend | null;
  /** The options of the game (defaults: Sys_InitConfigAndCd) */
  config?: Partial<PlayConfig>;
  /** The sound sink of a film (WebAudioMovieSink on the backend's master node); absent = a silent film */
  movieSink?: () => MovieSoundSink | null;
  /** Loads the `MUSIC\*.PMS` tracks ahead (default on when there is a backend) */
  preloadMusic?: boolean;
  /**
 * The options of the game (`g_config`); the F4 menu edits this very object. Absent = built from
 * `config` / `walkSpeed` and the defaults. The page passes what `ConfigStore` loaded.
 */
  settings?: GameConfig;
  /** Called when an options window is left (the original writes the registry then; the page saves to localStorage) */
  persistSettings?: (config: GameConfig) => void;
  /** Easy version (`g_easyVersion`): `GUN = 1` at the start and in a new game, `LIGHTVER = 1` at every scene start */
  easy?: boolean;
  /** The F4 menu. Fonts come from `Resource.pak`. Default on together with `dialogs`. */
  menu?: boolean;
  /** `Inventory_Clear`: a new game and the return after an exit film empty the coat (hangs the inventory here) */
  onNewGame?: () => void;
  /**
 * Saving and loading: F2/F3 and the menu open the file windows (`saveMode` "files") or the
 * slot windows ("slots", the start screen's mode), F5/F6 the quick save, the autosave runs at the first frame of a scene.
 * Absent = the keys do nothing and the menu's "Load"/"Save" stay without effect (tests, `?scene=` without storage).
 */
  save?: SaveManager;
  saveMode?: "files" | "slots";
  /** The inventory of the start screen: "coat" (default) or "bar" — the item bar at the top of the screen instead of the coat (F1) */
  inventory?: "coat" | "bar";
  /** The game is over: "quit" = "Quit the game" confirmed, "finished" = OUTRO.AVX, "death" = a death film. The host tears the session down. */
  onExit?: (reason: "quit" | "finished" | "death") => void;
}

export interface LogLine {
  tick: number;
  scene: string;
  text: string;
}

export interface PlayView {
  surface: Surface16;
  scrollX: number;
  /** the cursor to draw over it, null while hidden (script running, fade, leaving the window) */
  cursor: CursorDraw | null;
  cursorImage: Image16 | null;
  /** masks of the lens (mode 1), for drawCursor */
  lensMasks: LensMasks;
  /** face windows, captions and the answer menu, over the scene and under the cursor */
  overlays: Overlay[];
}

/** What the game needs to draw the dialog layer: the caption font and the dialog tables. */
interface DialogAssets {
  font: Font;
  tables: DialogTables;
  /** colour tables: the face window darkens the scene behind it with them */
  remap: Remap;
}

/** A RUNFILMP film in its window (phase "film"): the scene stands, `clockMs` is the film's own time. */
interface RunningFilm {
  run: FilmRun;
  name: string;
  clockMs: number;
  /** a film of GLOBAL.FCM (RUNGLOBALFILMP): frames and sounds come from Global.pak */
  global: boolean;
}

/** `IM<w>.PBM` ring of each mask index (Game_Main loads five; index 0, width 220, has none) */
const RING_FILES = [null, "IM240.PBM", "IM260.PBM", "IM280.PBM", "IM300.PBM", "IM312.PBM", "IM312.PBM"];

/** A film being played (phase "movie"): `clock` counts 5 ms ticks of real time (Media_Step). */
interface RunningMovie {
  player: MoviePlayer;
  film: string;
  clockMs: number;
  surface: Surface16;
}

const MAX_LOG = 400;

/** KeyboardEvent.key -> the scan code the coat reads */
const COAT_KEYS: Readonly<Record<string, number>> = {
  Escape: DIK_COAT.ESC, F1: DIK_COAT.F1, Home: DIK_COAT.HOME, ArrowUp: DIK_COAT.UP, PageUp: DIK_COAT.PGUP,
  End: DIK_COAT.END, ArrowDown: DIK_COAT.DOWN, PageDown: DIK_COAT.PGDN,
};

/** KeyboardEvent.key -> DirectInput scan code of the keys `Game_Run` reads */
const KEY_DIK: Readonly<Record<string, number>> = {
  F1: DIK.F1, F2: DIK.F2, F3: DIK.F3, F4: DIK.F4, F5: DIK.F5, F6: DIK.F6, F10: DIK.F10,
  m: DIK.M, M: DIK.M, // the small map
};

/** POCISK*.BM and the highlights of the bullet menu */
function bulletImageNames(): string[] {
  const names = new Set<string>();
  for (const gun of [false, true]) {
    names.add(bulletImageName(gun));
    for (const i of ICONS) names.add(highlightImageName(i, gun));
  }
  return [...names];
}

export class PlayGame {
  readonly vars: Variables;
  readonly cursor: Cursor;
  readonly areas = new AreaState();
  readonly log: LogLine[] = [];
  /** Cursor verb (`g_verbMode`): 0 pointer, 1 look, 2 strike, 3 shoot, 4 take. `VerbMenu` opens when the bullet menu is off. */
  verbMode = 0;
  scene: ScenePlayer | null = null;
  interpreter: Interpreter | null = null;
  host: SceneHost | null = null;
  phase: Phase = "loading";
  transition: SceneTransition | null = null;
  sceneName = "";
  /** the scene the scripts asked for with GOTOSCENE */
  pendingScene: string | null = null;
  /** REFRESHSCREEN was run: the next scene change fades (g_mixingPending) */
  fadeRequested = false;
  /** logic ticks since the start of the game */
  ticks = 0;
  /** x (scene coordinates) of the last click, for IFMOUSEXM / IFMOUSEXW */
  clickX = 0;
  lastClick: { x: number; y: number; outcome: ClickOutcome["kind"] | "ignored"; macro?: string | null } | null = null;
  /** scenes visited, in order */
  readonly history: string[] = [];
  /** error text of a failed scene load */
  error: string | null = null;
  /** sound, music and speech */
  readonly audio: PlayAudio;
  /** the dialog layer of the scene ; null without it (`PlayOptions.dialogs: false`) */
  dialog: DialogController | null = null;
  /** RUNAVX asked for a film (the game plays it at the end of the frame) */
  pendingMovie: { film: string; scene: string } | null = null;
  /** the music fade before a film: the scene is frozen on its last frame until it is over */
  moviePause: { total: number; left: number; volume: number } | null = null;
  /** the film being played */
  movie: RunningMovie | null = null;
  /** RUNFILMP asked for a film (Film_Play blocks: it starts after the commands of this frame) */
  private pendingFilm: { film: string; x: number; y: number; mode: number; global: boolean } | null = null;
  /** the RUNFILMP film being played */
  film: RunningFilm | null = null;
  /** the scene change after a film starts the default track */
  private defaultMusic = false;
  private endSurface: Surface16 | null = null;
  private dialogAssets: DialogAssets | null = null;
  private jackUniform = false;
  private talkArmed = true;
  private skipLine = false;
  /** ticks left before Caption_Hide takes the caption off (strlen * 3 + 200), whatever the voice does */
  private captionTicks = 0;
  private captionSeen: object | null = null;
  /** `g_scrollX` at the start of the caption: the line stays where it first appeared on the screen (deviation, see) */
  private captionScroll = 0;
  private captionHidden = false;
  /**
 * The game is over: "finished" after OUTRO.AVX (`g_gameFinished`, Game_Run leaves the loop), "quit" after
 * "Quit the game" (the original ends the process, `Sys_FatalExit("OK. Bye!")`). The host tears the session down (`onExit`).
 */
  exit: "finished" | "quit" | "death" | null = null;
  /** the coat: 84 slots, the item in hand; it outlives the scenes (`Inventory_Clear` only in a new game) */
  readonly inventory = new Inventory();
  /** the strip of the quick save (F5: "Szybki Zapis", `Notice_Show(0x1cc)`), drawn over the scene */
  readonly notice = new NoticeStrip();
  noticeFont: Font | null = null;
  /** the slot window (slot mode), null otherwise */
  slotUi: { win: SlotWindow; kind: "save" | "load"; scene: Surface16; screen: Surface16; down: boolean; fromMenu: boolean } | null = null;
  /** a system file window is open (the original stands in the modal GetSaveFileNameA: the game does not run) */
  private modal = false;
  private ioPromise: Promise<void> | null = null;
  /** `g_jackSavedX..`: Jack's pose, refreshed every frame while the player is not locked */
  private jackSaved: SavedPose = { x: 320, y: 240, scale: 1, dir: 0, facing: 1 };
  /** `g_jackPlaced` */
  private jackPlaced = false;
  private hardNoSave = false;
  /** AUTOINCRANGE clock (host.ts): global like the game's, off until a script or a chapter-3 scene starts it */
  private readonly autoInc = new AutoIncClock();
  /** the autosave runs at the end of the first frame of a scene (flag) */
  private autosavePending = false;
  /** the coat screen (F1); null when `menu` and the dialogs are both off. Fonts come from `Resource.pak`. */
  coat: CoatScreen | null = null;
  /** the small map (M); null when `menu` and the dialogs are both off, like the coat */
  miniMap: MiniMapScreen | null = null;
  private miniScreen: Surface16 | null = null;
  /** M is down (the map waits for its release after the press) */
  private mKeyHeld = false;
  /** the legacy item bar (`inventory: "bar"`); null in the default mode */
  bar: TopBar | null = null;
  /** RAMKA.BM (Resource.pak): the frame of the item cursor, drawn in every inventory mode */
  frameImage: Surface16 | null = null;
  /** the cursor image's rectangle of the previous frame (Sprite_SetOverlay: the redraw covers old and new place) */
  private prevCursorRect: HitRect | null = null;
  private barCursorCountdown = 0;
  /** the bullet menu (right button); the images are in RESOURCE.PAK */
  readonly bullet = new BulletMenu();
  /** the verb window of `BulletOnOff = 0` while it is open (modal) */
  verbWindow: VerbMenu | null = null;
  /** `g_coatRequest008f6870`: the mouse asked for the coat (right button with an item in hand, middle button) */
  coatRequest = false;
  /** `g_jackIsMenu008f687c`: a click on Jack's sprite with an empty hand asks for the coat (`JACKISMENU` at the scene start, the Ctrl point 4) */
  jackIsMenu = true;
  /** the three refusals from `refusals.ts`; null when `dialogs` is false */
  private refusals: JackRefusal[] | null = null;
  /** the counter of the refusals, 0 at the start of the game (Game_Run prologue) */
  private refusalCounter = 0;
  /** Jack's refusal is being spoken; the window that shows him goes away with the line */
  private refusal: { side: Side } | null = null;
  /** the options of the game (`g_config`), edited by the F4 menu */
  readonly settings: GameConfig;
  /** the F4 menu; null when `menu` is false, or when it is omitted and `dialogs` is false */
  menu: GuiMenu | null = null;
  /** `g_optionsRequest`: the main menu opens in the next frame without a key (after an exit film) */
  optionsRequest = false;
  private readonly defaults: ReadonlyMap<string, number>;
  private menuAssets: MenuAssets | null = null;
  private bulletImages = new Map<string, Image16>();
  private coatScreen: Surface16 | null = null;
  private coatWait = false;
  private coatLeftDown = false;
  private coatCursorCountdown = 0;
  private verbScene: Surface16 | null = null;
  private verbScreen: Surface16 | null = null;
  private verbLeftDown = false;
  private escPressed = false;
  private waitRelease = false;
  private prevRight = false;
  private prevMiddle = false;
  private menuScene: Surface16 | null = null;
  private menuScreen: Surface16 | null = null;
  private menuInput = { down: false, escape: false };
  private menuCursorCountdown = 0;
  private readonly keysPressed = new Set<number>();
  private wasTalking = false;
  private musicClock = 0;
  private readonly textCache = new Map<string, Image16>();
  /** the window of each side as last drawn: the game redraws it (and re-copies the scene behind it) only when the face changes */
  private readonly faceWindows: Record<Side, { key: string; window: Surface16 } | null> = { L: null, R: null };
  private readonly faceImages = new Map<string, Image16>();

  private armed = true;
  /** the cursor mode before the answer menu opened */
  private menuCursorSaved: number | null = null;
  /** the answer menu needs g_clickArmed: a button already down when it opened is ignored until released */
  private menuGate = new ReleaseGate();
  /** the scroll-edge cursor: mode to come back to, the "view scrolled" flags / */
  private edge: EdgeState = { mode: 0, saved: 0, prevScrolling: false };
  /** g_cursorEnabled `007cde78` as step 21 of Game_Run keeps it */
  private readonly drawEnabled = new CursorEnable();
  private scrolling = false;
  private cursorCountdown = 0;
  private overReaction = false;
  private overObject = false;
  private loadPromise: Promise<void> | null = null;
  private readonly logged = new Set<string>();
  private lastInput: PlayInput = { x: 320, y: 240, pressed: false, down: false, inWindow: true };
  /** /: the mouse (scene coordinates) of the previous frame, for the idle counter */
  private idleMouse: { x: number; y: number } | null = null;

  private constructor(
    private readonly files: GameFiles,
    private readonly resource: Pak,
    private readonly global: Pak,
    private readonly globalIcs: Ics,
    private readonly cursorImages: Map<string, Image16>,
    variables: Map<string, number>,
    private readonly opts: PlayOptions,
  ) {
    this.defaults = new Map(variables);
    this.vars = new Variables(variables);
    const c = opts.config ?? {};
    const d = defaultConfig();
    this.settings = opts.settings ?? {
      ...d,
      walkSpeed: opts.walkSpeed ?? d.walkSpeed,
      showText: c.dialogText === false ? 0 : 1,
      musicVol: c.musicVolume ?? d.musicVol,
      sfxVol: c.sfxVolume ?? d.sfxVol,
      talkVol: c.talkVolume ?? d.talkVol,
      reverseStereo: c.revStereo ? 1 : 0,
      musicDown: c.musicDown === false ? 0 : 1,
    };
    this.audio = new PlayAudio(opts.backend ?? null, opts.config);
    this.audio.applyConfig(this.settings);
    if (opts.easy) this.vars.set("GUN", 1); // Game_Run prologue: Cursor_LoadSet2 + Var_Set("GUN", 1)
    for (const [k, v] of Object.entries(opts.vars ?? {})) this.vars.set(k, v);
    this.cursor = new Cursor((n) => {
      const i = n === "item" ? this.heldImage() : this.cursorImages.get(n);
      return i ? { w: i.width, h: i.height } : null;
    });
  }

  static async create(files: GameFiles, opts: PlayOptions = {}): Promise<PlayGame> {
    const [resource, global] = await Promise.all([files.read("Resource/RESOURCE.PAK"), files.read("Global.pak")]).then((b) =>
      b.map((x) => new Pak(x)),
    );
    const variables = parseVariables(resource.read(resource.find("VARIABLE.ALL")!));
    const globalIcs = parseIcs(decrypt(global.read("GLOBAL.ICS")), true);
    const images = new Map<string, Image16>();
    for (const name of [...allCursorFiles(), ...lensMaskFiles()]) if (resource.find(name)) images.set(name, decodeBm(resource.read(name)));
    const game = new PlayGame(files, resource, global, globalIcs, images, variables, opts);
    game.audio.speechFallback = global;
    for (const n of bulletImageNames()) if (resource.find(n)) game.bulletImages.set(n, decodeBm(resource.read(n)));
    if (resource.find("RAMKA.BM")) game.frameImage = decodeBm(resource.read("RAMKA.BM"));
    const withMenu = opts.menu ?? opts.dialogs !== false;
    if (opts.dialogs !== false || withMenu) {
      if (opts.dialogs !== false) {
        game.dialogAssets = { font: parseFnt(resource.read("JACK.FNT")), tables: DIALOG_TABLES, remap: BUNDLED_REMAP };
        game.refusals = JACK_REFUSALS;
      }
      const coatAssets = loadCoatAssets(global, resource);
      game.noticeFont = coatAssets.font;
      game.coat = new CoatScreen(game.inventory, coatAssets, game.coatHost());
      game.miniMap = new MiniMapScreen({ onExit: () => game.onMiniMapExit() });
      if (opts.inventory === "bar") game.bar = new TopBar(game.inventory, loadTopBarAssets(resource), coatAssets.font, game.barHost());
      if (withMenu) {
        game.menuAssets = loadMenuAssets(resource);
        game.menu = new GuiMenu({
          assets: game.menuAssets,
          texts: TEXTS_PL,
          config: game.settings,
          scene: createSurface(640, 480),
          persist: (cfg) => opts.persistSettings?.(cfg),
          onAction: (a) => game.onMenuAction(a),
        });
        const sample = (name: string) => (resource.find(name) ? resource.read(name) : undefined);
        game.audio.loadPreviews(sample("SFX.S16"), sample("TALK.S16"));
      }
    }
    await game.enter(opts.start ?? "SC001");
    return game;
  }

  /** Resolves when no scene is being loaded (tests, the page's first frame). */
  async settle(): Promise<void> {
    while (this.loadPromise || this.ioPromise) await (this.loadPromise ?? this.ioPromise);
  }

  // --- scenes ---------------------------------------------------------------------------------

  /** Scene_Load + the start of Game_Run for scene `name`; the old scene (if any) fades out when REFRESHSCREEN asked for it. */
  private async enter(name: string, restorePose?: SavedPose): Promise<void> {
    this.phase = "loading";
    this.cursor.busy = true;
    const old = this.scene;
    // Game_Run, after the scene loop and just before `g_barOptionsRequest = 0`: `if (g_itemInHand) Item_PutBackToBar()` - the item in the hand
    // goes back to the coat at the end of every scene; the next scene starts with the pointer
    if (old && this.inventory.held) {
      this.inv().putBack();
      this.cursor.mode = this.verbMode = 0;
    }
    const fade = this.fadeRequested && old !== null;
    this.fadeRequested = false;
    this.pendingScene = null;
    try {
      const sc = await this.loadScene(name);
      this.areas.reset();
      if (old && !restorePose) sc.inheritFacing(old.walker); // g_jackDir/g_jackFacing outlive the scene
      this.scene = sc;
      this.sceneName = name;
      this.history.push(name);
      // l. 440: the mode goes to 0 only with the pointer verb; with another verb the cursor keeps it
      this.cursor.sceneStart(this.verbMode);
      this.drawEnabled.sceneEnd(); // l. 4816
      this.startNoControl(name);
      this.bullet.close();
      this.coatRequest = false;
      this.jackIsMenu = this.vars.get("JACKISMENU") !== 0; //
      this.refusal = null;
      // Game_Run: the item in hand went back to the coat at the end of the previous scene (above), so the cursor is not mode 5
      this.armed = true;
      // g_cursorModeSaved is not reset at a scene start (written only)
      this.edge = { mode: this.cursor.mode, saved: this.edge.saved, prevScrolling: false };
      this.scrolling = false;
      const phk = this.scenePak(sc);
      const program = compileMcc(decrypt(phk.read(`${name}.MCC`)));
      // [engine; approved deviation, ] the city map clicks exactly where a place's caption lights up
      if (name === MAP_SCENE) sc.scene.areas = mapClickAreas(sc.scene.areas, program);
      await this.loadSound(name, phk, program.commands);
      const env: HostEnv = {
        scene: sc,
        areas: this.areas,
        gotoScene: (n) => {
          this.pendingScene = n;
        },
        requestFade: () => {
          this.fadeRequested = true;
        },
        clickX: () => this.clickX,
        answer: (id, asked) => (this.opts.answer ? this.opts.answer(id, asked) : 0),
        log: (e) => this.onLog(e),
        audio: this.audio,
        runMovie: (film, scene) => {
          this.pendingMovie = { film, scene };
        },
        runFilm: (film, x, y, mode, global = false) => {
          this.bullet.close(); // RUNFILMP closes the bullet menu
          this.pendingFilm ??= { film, x, y, mode, global };
        },
        items: this.itemPort(sc),
        autoInc: this.autoInc,
      };
      const host = new SceneHost(env, this.opts.talkTicks ?? TALK_TICKS);
      host.restoringPose = !!restorePose; // g_restoreJackPose: INIT does not place or move Jack
      const it = new Interpreter(program, host, this.vars);
      host.interpreter = it;
      this.dialog = this.dialogAssets ? this.makeDialog(name, phk, it, host) : null;
      env.dialog = this.dialog ?? undefined;
      this.host = host;
      this.interpreter = it;
      this.logged.clear();
      this.talkArmed = true;
      this.wasTalking = false;
      // `Scene_SetNumberAndMapFlag`, the scene of a loaded save: the saved track starts here, before the scene's own MUSIC commands
      const saved = this.audio.music.pendingSavedTrack;
      if (saved) await this.loadTrack(saved);
      this.audio.music.startSaved(saved ? this.audio.track(saved) : undefined);
      if (this.defaultMusic) {
        // The scene loaded after a film starts the default track (fade-in step 0)
        this.defaultMusic = false;
        const bytes = this.audio.track(DEFAULT_TRACK);
        if (bytes && this.audio.enabled) this.audio.music.play(DEFAULT_TRACK, bytes, 0);
      }
      // Game_Run, every scene before [PRE]: Var_Set("LIGHTVER", g_easyVersion ? 1: 0)
      this.vars.set("LIGHTVER", this.opts.easy ? 1 : 0);
      this.autoInc.sceneStart(sceneChapter(sceneNumber(name)), this.vars); // Game_Run l. 382: chapter 3 -> OCHR 0..60
      // the three scenes with a hard-coded 0 (read at the scene start: SC002 sets LAST to its own number later; the exact point is a hypothesis)
      this.hardNoSave = (name === "SC000C" || name === "SC002" || name === "SC005B") && this.vars.get("LAST") === 0;
      this.jackPlaced = false; // `g_jackPlaced` = 0 at the start of a scene
      // Game_Run: `Save_WriteState(tempjs, 1)` before PRE / INIT
      if (this.opts.save) await this.opts.save.sceneStart(this.saveState()).catch((e) => this.addLog(`! tempjs: ${e instanceof Error ? e.message : String(e)}`));
      this.resetMenuVar();
      it.runSynchronous("PRE");
      if (restorePose && !isNoControlScene(name)) this.restoreJack(sc, restorePose);
      it.start("INIT");
      this.autosavePending = !!this.opts.save;
      this.error = null;
      if (fade && old) {
        this.transition = new SceneTransition(old.renderer.framebuffer, sc.renderer.framebuffer);
        this.phase = "fading";
      } else this.phase = "playing";
    } catch (e) {
      this.error = `${name}: ${e instanceof Error ? e.message : String(e)}`;
      this.addLog(`ERROR ${this.error}`);
      this.phase = "playing";
      throw e;
    } finally {
      this.cursor.busy = false;
    }
  }

  /** The scene's sound list and the tracks its MUSIC commands name (read ahead: a command cannot wait for a file). */
  private async loadSound(name: string, phk: Pak, commands: readonly Command[]): Promise<void> {
    let bank: SceneSounds | null = null;
    const ssd = phk.find(`${name}.SSD`);
    if (this.audio.enabled && ssd) {
      bank = loadSceneSounds(phk.read(ssd), (f) => {
        const e = phk.find(f);
        return e ? phk.read(e) : undefined;
      });
    }
    this.audio.loadScene(bank, phk);
    if (!this.audio.enabled || this.opts.preloadMusic === false) return;
    for (const c of commands) if (c.code === 0x3f) await this.loadTrack(c.n1);
  }

  private async loadTrack(name: string): Promise<void> {
    if (this.audio.track(name)) return;
    try {
      this.audio.addTrack(name, await this.files.read(`Music/${name}`));
    } catch {
      // a missing track plays nothing
    }
  }

  /** A DialogController for the scene: its faces and lines (.DCN.FCC), the options, the uniform of Jack that outlives scenes. */
  private makeDialog(name: string, phk: Pak, it: Interpreter, host: SceneHost): DialogController {
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

  private scenePhk = new WeakMap<ScenePlayer, Pak>();

  private scenePak(sc: ScenePlayer): Pak {
    return this.scenePhk.get(sc)!;
  }

  private async loadScene(name: string): Promise<ScenePlayer> {
    const phk = new Pak(await this.files.read(`Action/${name}.phk`));
    const ph2 = (await (this.files.exists?.(`Data/${name}.ph2`) ?? Promise.resolve(true)))
      ? await this.files.read(`Data/${name}.ph2`).then((b) => new Pak(b)).catch(() => null)
      : null;
    const sc = new ScenePlayer(
      { name, resource: this.resource, phk, ph2, global: this.global, globalIcs: this.globalIcs },
      { scripted: true, walkSpeed: this.settings.walkSpeed, shadowTables: this.dialogAssets?.remap },
    );
    // g_jackUniform and the loaded frame set (write the same buffers) outlive scenes
    sc.tj.uniform = sc.jack.uniform = this.dialog?.jackUniform ?? this.jackUniform;
    this.scenePhk.set(sc, phk);
    return sc;
  }

  private onLog(e: LogEntry): void {
    if (e.kind === "end" || e.kind === "missing-var") return;
    if ((e.kind === "start" || e.kind === "missing-macro") && /^CO\d+$/.test(e.macro)) return;
    if (e.kind === "unhandled") {
      const key = `${e.macro}:${e.command?.word}`;
      if (this.logged.has(key)) return;
      this.logged.add(key);
    }
    this.addLog(e.kind === "start" ? `▶ ${e.text}` : e.kind === "unhandled" ? `⏭ ${e.text}` : `! ${e.text}`);
  }

  private addLog(text: string): void {
    this.log.push({ tick: this.ticks, scene: this.sceneName, text });
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
  }

  // --- time -----------------------------------------------------------------------------------

  /** One 15 ms logic tick (Game_TimerTick + the step blocks of Game_Run). */
  update(): void {
    if (this.phase !== "playing" || !this.scene || !this.interpreter || !this.host) return;
    if (this.miniMap?.isOpen) return this.miniMap.tick(LOGIC_TICK_MS); // g_logicFrozen = 1 while the small map is open
    if (this.menu?.isOpen || this.coat?.isOpen || this.bar?.isOpen || this.verbWindow || this.slotUi || this.modal) return; // g_logicFrozen = 1 while a menu / the coat / the verb window is open
    this.ticks++;
    this.scene.idleCount(); // g_idleFrames grows while g_logicFrozen == 0 (Game_Run, before ;)
    this.interpreter.logicTick();
    this.host.tick();
    this.dialog?.tick();
    this.captionTimer();
    this.scene.playerLocked = this.interpreter.playerLocked();
    if (!this.scene.playerLocked) this.jackSaved = this.scene.pose(); // Game_Run: g_jackSaved* while the player is free
    if (!this.jackPlaced && this.scene.jackPlaced) this.jackPlaced = true; // g_jackPlaced: Jack_Stand / STAY / the restored pose
    const scrollBefore = this.scene.scrollX;
    const wasWalking = this.scene.walker.walking;
    const result = this.scene.tick();
    // Game_Run (the walk step): g_jackX/Y change -> JACKX / JACKY (script variables) follow while Jack walks
    if ((wasWalking || this.scene.walker.walking) && this.interpreter) syncJackVars(this.interpreter.vars, this.scene.walker);
    this.scrolling = this.scene.scrollX !== scrollBefore; // Game_Tick14ms:
    this.host.viewScrolling = this.scrolling; // SHOWFACE waits for the end of a scroll (Script_ExecStep case 0x17)
    this.playSounds(result);
    for (const ev of this.scene.events) this.release(ev);
    if (this.cursorCountdown-- < 1) {
      this.cursorCountdown = ANIM_PERIOD;
      this.cursor.setTargets(this.overReaction, this.overObject);
      this.cursor.animate(this.lastInput.x + this.scene.scrollX);
    }
  }

  /**
 * Step 20 of Game_Run (the macros) is followed by steps 26-31 in the same frame: what the commands (and a click) just
 * started takes its first step now (`ScenePlayer.firstSteps`); a macro it releases runs in the next frame.
 */
  private firstSteps(): void {
    const result = this.scene?.firstSteps();
    if (!result || !this.scene) return;
    this.playSounds(result);
    for (const ev of this.scene.events) this.release(ev);
  }

  private release(ev: SceneEvent): void {
    const h = this.host;
    if (!h) return;
    switch (ev.kind) {
      case "jackArrived":
        return h.finish("jack:walk");
      case "jackAvoidWalk":
        // Jack_AvoidPerson -> Jack_WalkTo -> Script_InterruptOutMacros(-1): the action macro (OUTMACRO) ends, its destructor starts
        return this.interpreter?.interruptOutMacros(-1);
      case "jackInsertionEnded":
        return h.jackInsertionEnded(ev.global);
      case "jackTurnEnded":
        return h.finish("jack:turn");
      case "personArrived":
        return h.finish(`person:${ev.person}:walk`);
      case "personInsertionEnded":
        return h.finish(`person:${ev.person}:ins`);
      case "jackInsertionReleased":
        return h.release("jack:ins");
      case "personInsertionReleased":
        return h.release(`person:${ev.person}:ins`);
      case "animEnded":
        // an animation stopped by STOPANIMAFRAME / STOPANIMANEG does not release the macro
        return ev.reason === "end" ? h.finish(`anim:${ev.anim}`) : undefined;
      case "animFrame":
        return h.animFrame(ev.anim, ev.image, ev.rec);
    }
  }

  /**
 * A caption stays at most `strlen * 3 + 200` logic ticks (Script_ExecStep case 10 sets, Game_TimerTick
 * counts it down, Game_Run calls Caption_Hide at 0): a long voice outlasts it, the line goes on without text.
 */
  private captionTimer(): void {
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
 * The sounds the animators ask for in a tick: Jack's footsteps and insertion effects, the persons' walk and insertion
 * effects. All of them end in Sound_PlayIndexed (SfxPlayer.playIndexed): the footsteps with flag 1.
 */
  private playSounds(r: TickResult): void {
    if (!this.audio.enabled) return;
    const sfx = this.audio.sfx;
    const play = (sound: number | string, channels: number[], volumes: number[], step: boolean) => {
      const index = typeof sound === "number" ? sound : (sfx.sounds?.find(sound) ?? -1);
      channels.forEach((ch, i) => sfx.playIndexed(ch, index, volumes[i], step ? 1 : 0));
    };
    for (const s of r.sounds) play(s.sound, s.channels, s.volumes, s.kind === "step");
    for (const s of r.personSounds) play(s.sound, s.channels, s.volumes, s.kind === "walk");
  }

  /**
 * The macros hold the player (`Interpreter.playerLocked`, the original) or a death sequence is under way ([engine; approved
 * deviation, ]): the cursor is hidden and clicks / bullet menu / coat are ignored until the death film.
 */
  private playerHeld(): boolean {
    return !!this.interpreter && (this.interpreter.playerLocked() || this.deathSequence());
  }

  /** A death is certain: the film is pending, or an active macro runs straight to a `RUNAVX` of a death film (`deathAhead`). */
  private deathSequence(): boolean {
    if (this.phase !== "playing" || !this.interpreter) return false;
    if (this.pendingMovie) return isDeathFilm(this.pendingMovie.film);
    return deathAhead(this.interpreter);
  }

  /** One game frame: cursor, clicks, one command of every active macro, scene changes. */
  frame(rawInput: PlayInput): void {
    if (this.waitRelease) {
      // after the coat / the verb window the original waits until every button is up: no click reaches the scene before
      if (!rawInput.down && !rawInput.right && !rawInput.middle) this.waitRelease = false;
      else rawInput = { ...rawInput, pressed: false, down: false, right: false, middle: false, rightPressed: false, middlePressed: false };
    }
    this.lastInput = rawInput;
    if (this.phase !== "playing" || !this.scene || !this.interpreter) return;
    if (this.modal) return;
    if (this.slotUi) return this.slotFrame(rawInput);
    if (this.menu?.isOpen) return this.menuFrame(rawInput);
    if (this.verbWindow) return this.verbFrame(rawInput);
    if (this.coat?.isOpen) return this.coatFrame(rawInput);
    if (this.miniMap?.isOpen) return;
    if (this.bar && this.barFrame(rawInput)) return;
    this.idleFrame(rawInput);
    this.mouseRequests(rawInput);
    if (this.autosavePending) {
      // end of the first frame of a scene: a copy of tempjs, always
      this.autosavePending = false;
      this.io(this.opts.save!.autosave().then(() => undefined));
    }
    if (this.notice.shown) this.notice.auto ? this.notice.tickAuto() : this.notice.tickAnim();
    if (this.keyFrame()) return;
    const sc = this.scene;
    const it = this.interpreter;
    let input = rawInput;
    const d = this.dialog;
    this.answerMenuCursor(!!d?.menu);
    if (d) {
      d.scrollX = sc.scrollX;
      // a line being spoken ends at the next click; g_clickArmed is cleared when a line starts (Script_ExecStep case 10)
      // and set again once the button is up
      if (d.talking && !this.wasTalking) {
        this.talkArmed = false;
        this.skipLine = false;
      }
      this.wasTalking = d.talking;
      if (!input.down && !input.pressed) this.talkArmed = true;
      if (d.menu) {
        // the answer menu has the mouse: a row is pressed and released ; the scene gets no click
        // rows are hit by the cursor hotspot g_clickX/Y, not the raw mouse
        // Game_Run calls only while g_clickArmed != 0: the click that interrupted the line cleared it and it comes back
        // when the button is up, so a held button does not reach the rows (ReleaseGate)
        const hot = this.cursor.clickPoint(input.x + sc.scrollX, input.y);
        if (d.pointer(hot.x, hot.y, this.menuGate.update(true, input.down)) !== undefined) {
          this.audio.duckMusic(true);
          this.armed = false;
        }
        input = { ...input, pressed: false, down: false };
      } else {
        this.menuGate.update(false, input.down);
        if (d.talking && input.pressed && this.talkArmed && this.settings.talkInterrupt !== 0) {
          // the click stays pending until the face step that reads it (g_clickArmed is a flag of the game)
          this.skipLine = true;
          this.armed = false;
          input = { ...input, pressed: false };
        }
        d.frame(this.skipLine);
        if (!d.talking) this.skipLine = false;
        this.refusalFrame();
      }
    }
    this.audio.sfx.tick();
    const world = { x: input.x + sc.scrollX, y: input.y };
    const locked = this.playerHeld();
    const cursorEnabled = !locked;
    this.cursorEnableStep(locked, !!d?.menu);
    let click = this.cursor.clickPoint(world.x, world.y);
    const port = interpreterPort(it);
    // cursor mode of the exit area under the hotspot
    this.cursor.mode = zoneCursorMode(sc.scene.areas, this.areas, { mode: this.cursor.mode, verbMode: this.verbMode, click, suspended: this.bullet.open });
    this.cursor.inWindow = input.inWindow;
    this.scrollEdge(input, locked);
    // steps 12-13: the right button opens the bullet menu / the verb window, the icons are chosen by the left one
    if (locked) this.bullet.close();
    const opened = this.bulletFrame(input, world, locked);
    if (opened === "verb") return;
    if (opened === "blocked") input = { ...input, pressed: false, down: false };
    click = this.cursor.clickPoint(world.x, world.y);
    // Cursor_UpdateHotspot (Game_Run, before the macros run): the script variables MOUSEX / MOUSEY = the hotspot g_clickX/Y,
    // refreshed every frame (scene coordinates: the mouse + scroll + the per-mode offset), not only at a click
    this.syncMouseVars(click);
    // the macro prefix is the item in hand, else the verb
    const action: Action = { verb: this.cursor.verb, item: this.inventory.held?.name ?? null };
    // what is under the hotspot (Cursor_DrawOnPresent: sprites first, then areas)
    // pass 1 of the hit tests (a flagged sprite = an opaque pixel anywhere under the cursor image): the rectangle of the redraw
    const size = this.cursor.imageSize();
    const rect = size ? cursorHitRect(world.x, world.y, size.w, size.h, this.prevCursorRect) : null;
    this.prevCursorRect = size ? { x: world.x - (size.w >> 1), y: world.y - (size.h >> 1), w: size.w, h: size.h } : null;
    const cands = sc.spriteCandidates(click.x, click.y, rect);
    const s = spriteReaction(cands, port, this.cursor.mode, action);
    const a = s.over && s.exists ? null : areaReaction(sc.scene.areas, this.areas, port, click, this.cursor.mode, action);
    this.overReaction = s.exists || !!a?.exists;
    this.overObject = s.over || !!a?.over;
    // the click
    if (!input.down && !input.pressed) this.armed = true;
    else if (input.pressed || this.armed) {
      const r = resolveClick({
        mode: this.cursor.mode,
        armed: this.armed || input.pressed,
        cursorEnabled,
        playerLocked: locked,
        walkAllowed: this.host?.walkAllowed ?? true,
        itemInHand: !!this.inventory.held,
        area: () => areaClick(sc.scene.areas, this.areas, port, click, this.cursor.mode, action),
        sprite: () => {
          // (approved deviation): skip hit sprites without a macro, like the cursor test (Cursor_HitTestSprites)
          const idx = spriteClickTarget(cands, this.cursor.mode, (n) => reactionExists(port, action, n, true));
          // Sprite_ClickMacro: the click on Jack's sprite with an empty hand asks for the coat (also when `<verb>-JACK` runs)
          if (idx >= 0 && jackClickAsksCoat(cands[idx].name, !!action.item, this.jackIsMenu)) this.coatRequest = true;
          return idx < 0 ? null : startReaction(port, action, cands[idx].name, true);
        },
        inWalkArea: () => findWalkTriangle(sc.world.walk, click.x, click.y) >= 0,
      });
      this.armed = r.armed;
      this.onClick(r.outcome, click, port);
    }
    it.tick();
    this.firstSteps();
    if (this.pendingFilm) this.startFilm();
    if (!this.pendingMovie) this.moviePause = null;
    else if (!this.moviePause) this.moviePause = this.beginMovieFade();
    if (this.pendingMovie && !this.loadPromise && (this.moviePause?.left ?? 0) <= 0) {
      const m = this.pendingMovie;
      this.pendingMovie = null;
      this.moviePause = null;
      this.phase = "loading";
      this.loadPromise = this.startMovie(m.film, m.scene)
        .catch(() => undefined)
        .finally(() => {
          this.loadPromise = null;
        });
    } else if (this.pendingScene && !this.loadPromise) {
      const next = this.pendingScene;
      this.addLog(`→ GOTOSCENE ${next}${this.fadeRequested ? " (przenikanie)" : ""}`);
      this.phase = "loading";
      this.loadPromise = this.enter(next)
        .catch(() => undefined)
        .finally(() => {
          this.loadPromise = null;
        });
    }
  }

  /**
 * Jack's idle reaction, in the frame after the cursor and before the keys and the
 * macros: a held button, a moved mouse (screen x + scroll) or a macro holding the player zeroes `g_idleFrames`, then
 * `ScenePlayer.idleCheck` (the map scenes `g_sceneNoControl` never get one). rand() is the scripts' generator (one stream).
 */
  private idleFrame(input: PlayInput): void {
    const sc = this.scene!;
    const x = input.x + sc.scrollX;
    const moved = this.idleMouse === null || this.idleMouse.x !== x || this.idleMouse.y !== input.y;
    this.idleMouse = { x, y: input.y };
    sc.idleInput(!!input.down || !!input.right || !!input.middle || moved || !!this.interpreter?.playerLocked());
    const c = sc.idleCheck(isNoControlScene(this.sceneName), () => this.host?.random() ?? 0, () => this.vars.get("GUN"));
    if (c?.section || c?.stay) this.addLog(`◦ bezczynność ${c.section ?? `STAY ${c.stay}`}`);
  }

  /**
 * Scrolling by the mouse at the screen edge (Game_Run and the g_sceneNoControl step; edgescroll.ts).
 * The edge cursor (modes 20 / 21) takes over the mode; a click there starts the scroll and, with SETPOSSCROLL points, a walk.
 */
  private scrollEdge(input: PlayInput, locked: boolean): void {
    const sc = this.scene!;
    if (!sc.scripted) return;
    const d = this.dialog;
    if (isNoControlScene(this.sceneName)) {
      const dir = noControlDir(input.x, !locked);
      if (dir !== null) sc.scrollDir = dir;
      return;
    }
    const pts = this.host?.scrollPoints ?? { L: { x: -1000, y: -1000 }, R: { x: -1000, y: -1000 } };
    const r = edgeFrame(
      { ...this.edge, mode: this.cursor.mode },
      {
        mouseX: input.x,
        scrollX: sc.scrollX,
        scrollMin: sc.scrollMin,
        scrollMax: sc.scrollMax,
        bgWide: sc.bgWide,
        noControl: false,
        menuOrText: !!d && (!!d.menu || !!d.talking),
        scrolling: this.scrolling,
        cursorEnabled: !locked,
        clickArmed: input.down && this.armed,
        jackTurning: sc.tj.turn !== null,
        jackX: sc.walker.x,
        points: pts,
      },
    );
    this.edge = { mode: r.mode, saved: r.saved, prevScrolling: r.prevScrolling };
    this.cursor.mode = r.mode;
    this.answerMenuCursor(!!d?.menu);
    if (r.dir !== null) sc.scrollDir = r.dir;
    if (r.walkTo) sc.walkJackTo(r.walkTo.x, r.walkTo.y);
  }

  /**
 * Step 21 of Game_Run (l. 1774-1792): a macro holding the player switches the cursor off (not while the answer menu is open);
 * once nothing holds it, `Cursor_EnableDraw` switches it on again - which in mode 0 also puts the verb back to the pointer.
 */
  private cursorEnableStep(locked: boolean, menuOpen: boolean): void {
    if (this.drawEnabled.step(locked, menuOpen)) this.enableDraw();
  }

  /** `Cursor_EnableDraw`: in mode 0 `g_verbMode` = 0 as well (the pointer); any other mode stays as it is. */
  private enableDraw(): void {
    // under the answer menu the engine shows the arrow (deviation); the original's mode is the one saved before it
    this.verbMode = enableDrawVerb(this.menuCursorSaved ?? this.cursor.mode, this.verbMode);
  }

  /**
 * The cursor over the answer menu: the arrow. The original code shows no switch (Cursor_EnableDraw, called when
 * DIALOG opens the menu, only re-selects WSK in mode 0, and Cursor_AnimateStep is idle while g_menuOpen), but the
 * user's observation [original] is the arrow with a hand, a fist or an item taken before the dialog - so while the menu is open
 * the mode is 0 (picture and hotspot), and the mode before it comes back when the menu closes. A deviation, see.
 */
  private answerMenuCursor(open: boolean): void {
    if (open) {
      if (this.menuCursorSaved === null) this.menuCursorSaved = this.cursor.mode;
      this.cursor.mode = 0;
    } else if (this.menuCursorSaved !== null) {
      this.cursor.mode = this.menuCursorSaved;
      this.menuCursorSaved = null;
    }
  }

  /** MOUSEX / MOUSEY (script variables, `Cursor_UpdateHotspot`): the hotspot g_clickX/Y of the cursor, short. */
  private syncMouseVars(click: { x: number; y: number }): void {
    // (approved deviation, areas/deviations.ts): while POKAZANIE-DOL of SC087 runs without the rope, it must see the ladder side
    const ropeIdx = this.scene ? resolveAreaRef(this.scene.scene.areas, ROPE_DESCENT_FIX.area, ROPE_DESCENT_FIX.ropeDup) : -1;
    const ropeOn = ropeIdx >= 0 && this.areas.enabled[ropeIdx] !== 0;
    const active = this.interpreter?.isActive(ROPE_DESCENT_FIX.macro) ? ROPE_DESCENT_FIX.macro : "";
    if (this.vars.has("MOUSEX")) this.vars.set("MOUSEX", macroMouseX(this.sceneName, active, click.x, ropeOn));
    if (this.vars.has("MOUSEY")) this.vars.set("MOUSEY", click.y);
  }

    private onClick(outcome: ClickOutcome, click: { x: number; y: number }, port: ReturnType<typeof interpreterPort>): void {
    const sc = this.scene!;
    if (outcome.kind === "ignored") return;
    this.clickX = click.x;
    this.lastClick = { x: click.x, y: click.y, outcome: outcome.kind };
    if (outcome.kind === "walk") {
      port.interruptOutMacros(-1);
      const plan = planWalk(sc.world, sc.walker, { x: Math.trunc(click.x), y: Math.trunc(click.y) });
      if (plan) sc.walkPlan(plan);
    } else if (outcome.kind === "putBack") {
      // (tail): a click with the item on nothing puts it back into the coat; Cursor_ResetMode
      this.inv().putBack();
      this.cursor.mode = this.verbMode = 0;
    } else if (outcome.kind === "refuse") {
      this.jackRefuses(click.x);
    }
  }

  /**
 * Jack_RefuseAction (Game_Run tail): the item was used on a target that has neither `<item>-X` nor `PIERDOLA-X`.
 * Not while a refusal is still spoken. The click is spent; Jack's face opens in the window on the side
 * away from the click (the click to the right of the middle of the screen: the left window, voice channel 1), the next
 * of three lines (the counter + 1 mod 3: the first refusal of a game is the second line) is said with
 * the voice `N0n0.S22` and the width of the caption from the table. The item stays in hand.
 */
  private jackRefuses(clickX: number): void {
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
    const dcn: Dcn = { entries: [{ id: 0, text: line.text, width: line.width, sound: line.voice }], dialogs: [{ id: 0, kind: "R", first: 0, count: 1 }] };
    d.dcn = dcn;
    d.talkOption(r.side === "L" ? "LEFT" : "RIGHT", 0, 0, r.channel, "+", 0);
    d.dcn = saved;
    this.refusal = { side: r.side };
  }

  /** Talk_FaceStep: when the refusal ends, Jack's window closes. */
  private refusalFrame(): void {
    if (!this.refusal || this.dialog?.talking) return;
    this.dialog?.hideFace(this.refusal.side);
    this.refusal = null;
  }

  /**
 * Real time (`dtMs`): the music fades (Game_Tick14ms, every 14 ms), a film's frames (Media_Step, 5 ms ticks) and the
 * fade between scenes.
 */
  advance(dtMs: number): void {
    this.musicClock += dtMs;
    for (let n = 0; this.musicClock >= 14 && n < 200; n++) {
      this.musicClock -= 14;
      this.audio.music.tick14ms();
    }
    this.musicClock = Math.min(this.musicClock, 14);
    this.menu?.tick(dtMs);
    this.slotUi?.win.tick(dtMs);
    if (this.moviePause && this.moviePause.left > 0) this.advanceMovieFade(dtMs);
    if (this.phase === "movie") return this.stepMovie(dtMs);
    if (this.phase === "film") return this.stepFilm(dtMs);
    if (this.phase !== "fading" || !this.transition) return;
    this.transition.advance(dtMs);
    if (this.transition.finished) {
      this.transition = null;
      this.phase = "playing";
    }
  }

  // --- films (RUNFILMP) ------------------------------------------------------------------------

  /**
 * Film_Play: the film `film` of `<scene>.FCM` (RUNFILMP, global = 0) or the section of `GLOBAL.FCM` (RUNGLOBALFILMP,
 * global = 1: `Fcm_LoadSection`, pictures from Global.pak) is looked up (`Film_Find`; the game stops with
 * "No Film!!" when there is none, here the command is logged and skipped), the cursor sprites are removed and the film
 * plays in a window of the scene picture; the game loop does not run meanwhile.
 */
  private startFilm(): void {
    const p = this.pendingFilm!;
    this.pendingFilm = null;
    const sc = this.scene!;
    const command = p.global ? "RUNGLOBALFILMP" : "RUNFILMP";
    try {
      const phk = p.global ? this.global : this.scenePak(sc);
      const entry = phk.find(p.global ? "GLOBAL.FCM" : `${this.sceneName}.FCM`);
      const wanted = p.film.toUpperCase();
      const film = entry ? parseFcm(decrypt(phk.read(entry))).find((f) => f.name.toUpperCase() === wanted) : undefined;
      if (!film) {
        this.addLog(`! ${command} ${p.film}: No Film!!`);
        return;
      }
      const images = film.frames.map((f) => decodePbm(phk.read(f.file), f.file));
      const circle = p.mode === 2 || p.mode === 3;
      let index = MASK_WIDTHS.indexOf(images[1].width);
      if (index < 0) index = 0;
      const maskFile = `CM${MASK_WIDTHS[index]}.BIN`;
      const ringFile = RING_FILES[index];
      const mask = circle ? parseCm(maskFile, this.resource.read(this.resource.find(maskFile)!)) : null;
      const ring = circle && ringFile && this.resource.find(ringFile) ? decodePbm(this.resource.read(ringFile), ringFile) : null;
      const run = new FilmRun({ film, images, scene: sc.renderer.framebuffer, mask, ring }, p.mode, p.x, p.y, sc.scrollX);
      this.film = { run, name: film.name, clockMs: 0, global: p.global };
      this.phase = "film";
      this.addLog(`▶ ${command} ${film.name} (${p.x}, ${p.y}) tryb ${p.mode}`);
      this.filmSounds(0);
    } catch (e) {
      this.addLog(`! ${p.global ? "RUNGLOBALFILMP" : "RUNFILMP"} ${p.film}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
 * The effects of the passes up to film time `ms`: channel 0 plays on channels 1 and 2 (Film_Play). A scene film uses
 * Sound_PlayIndexed (index in the scene's sound list of the name as written); a global one Sound_PlayTalk(1): the raw `.S16` file of Global.pak,
 * a free channel of the requested side, volume as given (no doubling) scaled by SFXVol / 64.
 */
  private filmSounds(ms: number): void {
    const f = this.film;
    if (!f) return;
    const sfx = this.audio.sfx;
    for (const e of f.run.effectsUntil(ms)) {
      if (!this.audio.enabled) continue;
      if (f.global) {
        for (const ch of e.channel === 0 ? [1, 2] : [e.channel]) this.playGlobalSound(ch, fcmEffectFile(e), e.volume);
        continue;
      }
      // Scene_LoadFcm: Sound_FindSceneSfx(name as written, `001-06.SND`; only Fcm_LoadSection changes it to .S16)
      const index = sfx.sounds?.find(e.sound) ?? -1;
      for (const ch of e.channel === 0 ? [1, 2] : [e.channel]) sfx.playIndexed(ch, index, e.volume, 0);
    }
  }

  /** Sound_PlayTalk(channel, file, volume, 1): `file` of Global.pak, nothing when it is missing or sound is off. */
  private playGlobalSound(channel: number, file: string, volume: number): void {
    const audio = this.audio;
    const entry = this.global.find(file);
    if (!audio.enabled || !entry) return;
    let prepared;
    try {
      prepared = prepareSound(new Sound(this.global.read(entry), "S16"));
    } catch {
      return;
    }
    const ch = audio.pickTalkChannel(channel);
    const level = gameVolumeToLevel(Math.trunc((volume * audio.config.sfxVolume) / 64));
    audio.mixer.play(swapChannel(ch, audio.config.revStereo), prepared, { volume: level });
  }

  private stepFilm(dtMs: number): void {
    const f = this.film;
    if (!f) return;
    f.clockMs += dtMs;
    this.filmSounds(f.clockMs);
    if (!f.run.finished(f.clockMs)) return;
    this.addLog(`■ RUNFILMP ${f.name}`);
    this.film = null;
    this.phase = "playing";
  }

  // --- films (RUNAVX) --------------------------------------------------------------------------

  /**
 * At the end of the frame the music stops, the film `Movies\<name>16.AVX` plays
 * until it ends or Esc is down, then the scene is loaded again (`g_sceneChange` stays 1) and starts the default
 * track. `scene` is what the script gave as the second word (`NULL` in the data): a scene that exists is entered,
 * otherwise the current one is loaded again (**hypothesis**: the code that copies the name was lost in the decompiler).
 */
  /**
 * Game_Run (the scene change with g_movieOnExit): `while (0 < g_musicVolume) { g_musicVolume--;
 * Sound_SetChannelVolume(5, g_musicVolume); Timer_Sleep(10); }` - the music volume (game units, up to 64) falls by 1 every 10 ms,
 * so the pause before the film lasts `volume x 10 ms` (350 ms at MusicVol 35, less while the music is ducked) and is silent
 * when no music plays. The face windows are already gone then, the scene stands on its last frame. (the user saw a clear
 * pause after Biff's line and his face going away, before ONCAR.AVX; the engine used to stop the music at once.)
 */
  private beginMovieFade(): { total: number; left: number; volume: number } | null {
    const music = this.audio.music;
    if (!this.audio.enabled || !music.playing || music.volume <= 0) return { total: 0, left: 0, volume: 0 };
    const total = music.volume * MOVIE_FADE_STEP_MS;
    return { total, left: total, volume: music.volume };
  }

  private advanceMovieFade(dtMs: number): void {
    const f = this.moviePause;
    if (!f) return;
    f.left = Math.max(0, f.left - dtMs);
    this.audio.setMusicFade(Math.floor((f.volume * f.left) / f.total));
  }

  private async startMovie(film: string, _scene: string): Promise<void> {
    this.addLog(`▶ RUNAVX ${film}`);
    this.audio.silence();
    this.defaultMusic = true;
    if (this.audio.enabled) await this.loadTrack(DEFAULT_TRACK);
    this.pendingScene = null;
    const sink = this.audio.enabled ? (this.opts.movieSink?.() ?? null) : null;
    const player = await openMovie(this.files, film, { dialogText: this.audio.config.dialogText, sound: sink, level: this.audio.movieLevel });
    if (!player) {
      this.addLog(`! film ${film} cannot be opened`);
      this.afterMovie(film);
      return;
    }
    player.start(0);
    this.movie = {
      player,
      film,
      clockMs: 0,
      surface: { width: 640, height: 480, pixels: player.screen.pixels },
    };
    this.phase = "movie";
  }

  private stepMovie(dtMs: number): void {
    const m = this.movie;
    if (!m) return;
    m.clockMs += dtMs;
    const s = m.player.step(Math.floor(m.clockMs / 5), this.lastInput.escape === true);
    if (!s.end) return;
    this.addLog(`■ ${m.film}: ${s.end}`);
    this.endSurface = m.surface;
    this.movie = null;
    this.afterMovie(m.film);
  }

  /**
 * After the film (Game_Run, the exit-film branch): `OUTRO.AVX` sets `g_gameFinished` and the
 * game ends. Every other film (the death films `ONCAR16`, `83JC16`...) is a death. The original then loads `SC001.CCG`
 * (string xref), `Cursor_LoadSet1`, `Inventory_Clear`, sets `g_optionsRequest = 1` and opens the F4 menu on SC001
 * with the old variables. [engine; user decision 2026-11-06] The engine instead ends the game with `exit = "death"` and the
 * page returns to the main menu ; "New game" then starts from zero. The faithful return is a FUTURE.md option.
 */
  private afterMovie(film: string): void {
    this.fadeRequested = false;
    if (isOutro(film)) {
      this.finish("finished");
      this.addLog("■ koniec gry (OUTRO.AVX)");
      return;
    }
    this.finish("death");
    this.addLog(`■ śmierć Jacka (${film}) — powrót do menu głównego`);
  }

  // --- keys and the F4 menu ----------------------------------------------------------------------

  /**
 * A key went down (KeyboardEvent.key: "F4", "F10", "Enter", "Escape"...). Returns true when the game takes it (the page then
 * calls preventDefault). With the menu open it goes to the menu; otherwise F1..F6 and F10 are remembered for the next frame
 * (`Input_KeyPressedOnce`), where `keyFrame` decides with the conditions of `Game_Run`.
 */
  keyDown(key: string, repeat = false): boolean {
    if (key === "m" || key === "M") this.mKeyHeld = true;
    if (this.modal) return true;
    if (this.slotUi) {
      if (!repeat || key.length === 1 || key === "Backspace") this.slotEvents(this.slotUi.win.keyDown(key));
      return true;
    }
    if (this.menu?.isOpen) {
      if (!repeat) this.menu.keyDown(key);
      return true;
    }
    if (this.verbWindow) {
      if (!repeat) this.verbWindow.keyDown(key);
      return true;
    }
    if (this.miniMap?.isOpen) {
      // the map polls Input_IsKeyDown(M / Esc) itself
      const code = key === "Escape" ? DIK_MAP.ESC : key === "m" || key === "M" ? DIK_MAP.M : undefined;
      if (code !== undefined && !repeat) this.miniMap.keyDown(code);
      return true;
    }
    if (this.coat?.isOpen) {
      // Input_KeyPressedOnce: the scroll keys and F1 / Esc act on the edge, a held key does not repeat
      const code = COAT_KEYS[key];
      if (code === undefined) return false;
      if (!repeat) this.coat.keyDown(code);
      return true;
    }
    if (key === "Escape" && !repeat) this.escPressed = true; // Input_KeyPressedOnce(Esc) closes the bullet menu (step 12)
    const dik = KEY_DIK[key];
    if (dik === undefined) return false;
    if (!repeat) this.keysPressed.add(dik);
    return true;
  }

  private readonly wheelSum = new WheelAccumulator();

  /**
 * [deviation: the original has no wheel]: the wheel scrolls the coat by a row (region A) or the item bar by a slot.
 * `deltaY` / `deltaMode` as in WheelEvent; small touchpad deltas are summed to one notch. Returns true when the wheel
 * works here (the page then calls preventDefault); elsewhere it does nothing.
 */
  wheel(deltaY: number, deltaMode = 0): boolean {
    const coat = this.coat?.isOpen ? this.coat : null;
    const bar = !coat && this.bar?.isOpen ? this.bar : null;
    if (!coat && !bar) {
      this.wheelSum.reset();
      return false;
    }
    if (coat && !coat.scrollable) return false;
    const dir = this.wheelSum.add(deltaY, deltaMode);
    if (dir !== 0) (coat ?? bar)!.wheel(dir);
    return true;
  }

  keyUp(key: string): void {
    if (key === "m" || key === "M") this.mKeyHeld = false;
    if (this.miniMap?.isOpen) {
      if (key === "Escape") this.miniMap.keyUp(DIK_MAP.ESC);
      else if (key === "m" || key === "M") this.miniMap.keyUp(DIK_MAP.M);
      return;
    }
    if (this.slotUi) this.slotEvents(this.slotUi.win.keyUp(key));
    else if (this.menu?.isOpen) this.menu.keyUp(key);
    else if (this.verbWindow) this.verbWindow.keyUp(key);
  }

  /** `[macro]` of a TAKE (case 0x21): set by TAKE, cleared at the next step of that macro - about one frame. */
  private takeFlag = false;

  /** The state the key conditions of `Game_Run` read. */
  private keyContext(): KeyContext {
    const d = this.dialog;
    const locked = this.playerHeld();
    return {
      sceneNoControl: isNoControlScene(this.sceneName),
      answerMenuOpen: !!d?.menu,
      captionShown: !!d?.caption && !this.captionHidden,
      bulletMenuOpen: this.bullet.open,
      topBarOpen: this.bar?.isOpen ?? false,
      topBarFolded: true,
      macroPlayerLocked: locked,
      keysEnabled: true,
      facesShown: !!d && (d.faceView("L") !== null || d.faceView("R") !== null),
      menuVar: this.vars.get("MENU") !== 0,
      barFlag: this.scrolling,
      noticeShown: this.notice.shown,
      // Script_AnyMacroActive reads the TAKE flags, not "a macro is running"
      macroActive: this.takeFlag,
      cursorEnabled: !locked,
      cursorMode: this.cursor.mode,
      optionsRequest: this.optionsRequest,
      coatRequest: this.coatRequest,
      mapAvailable: mapAvailableIn(sceneChapter(sceneNumber(this.sceneName)), sceneNumber(this.sceneName)), //
      backspace: undefined,
      canSave: this.sceneSaveable && this.jackPlaced,
    };
  }

  /**
 * The key step of the frame: F4 (menu) and F10 (leave the game?) open the menu, F1 (or the mouse) the coat; the rest (F2/F3/F5/F6 saves -
 *, M map, Backspace) is read and dropped. F4 is read as a *held* key in the original (`Input_IsKeyDown`); here it counts
 * for the frame after the press only, so closing the menu with F4 still held does not open it again (deviation).
 */
  private keyFrame(): boolean {
    const pressed = new Set(this.keysPressed);
    this.keysPressed.clear();
    const ctx = this.keyContext();
    this.takeFlag = false; // clears the flag at the macro's next step, which follows this key step
    const down = new Set<number>(pressed.has(DIK.F4) ? [DIK.F4] : []);
    for (const a of keyActions({ pressed, down, lastChar: 0 }, ctx)) {
      if (a.kind === "options") return this.openMenu("main");
      if (a.kind === "quit") return this.openMenu("quit");
      if (a.kind === "coat") return this.openCoat();
      if (a.kind === "map") return this.openMiniMap();
      if (a.kind === "saveWindow") return this.fileWindow("save", false);
      if (a.kind === "loadWindow") return this.fileWindow("load", false);
      if (a.kind === "quickSave") this.quickSave(a.notice);
      if (a.kind === "quickLoad") this.quickLoad();
    }
    return false;
  }

  /**
 * A developer aid for the host (the original has no digit keys):
 * the cursor mode is set only if the verb window would offer it - mode 3 only with `GUN = 1`, none with an item
 * in hand or under an open menu. Returns whether the mode changed.
 */
  setDebugVerb(verb: number): boolean {
    const menuOpen = this.bullet.open || !!this.verbWindow || !!this.menu?.isOpen || !!this.coat?.isOpen || !!this.bar?.isOpen || !!this.slotUi || !!this.modal;
    if (!debugVerbAllowed(verb, { gun: this.vars.get("GUN") === 1, itemInHand: !!this.inventory.held, menuOpen })) return false;
    this.verbMode = verb;
    this.cursor.mode = verb;
    this.cursor.startSwitch();
    return true;
  }

  get menuOpen(): boolean {
    return !!this.menu?.isOpen;
  }

  /** Game_Run: the scene stands, the effects pause, the pointer is the cursor of mode 0. */
  openMenu(screen: "main" | "quit" = "main"): boolean {
    const sc = this.scene;
    const menu = this.menu;
    if (!menu || !sc || this.phase !== "playing") return false;
    this.optionsRequest = false;
    const snap = this.snapshot();
    this.menuScene = snap;
    this.menuInput = { down: false, escape: false };
    this.cursor.mode = 0;
    this.cursor.inWindow = true;
    this.audio.pauseEffects(true);
    menu.setScene(snap);
    menu.open(screen);
    return true;
  }

  /** The menu while open: the mouse of the page and Esc (`PlayInput.escape`) drive it; the scene is not touched. */
  private menuFrame(input: PlayInput): void {
    const menu = this.menu!;
    const st = this.menuInput;
    if (input.pressed) {
      menu.pointerDown(input.x, input.y);
      st.down = true;
    } else if (menu.isOpen) menu.pointerMove(input.x, input.y);
    if (!input.down && st.down && menu.isOpen) {
      st.down = false;
      menu.pointerUp(input.x, input.y);
    }
    const esc = input.escape === true;
    if (esc !== st.escape && menu.isOpen) {
      st.escape = esc;
      if (esc) menu.keyDown("Escape");
      else menu.keyUp("Escape");
    }
    if (menu.isOpen && this.menuCursorCountdown-- < 1) {
      this.menuCursorCountdown = ANIM_PERIOD;
      this.cursor.inWindow = input.inWindow;
      this.cursor.setTargets(false, false);
      this.cursor.animate(input.x);
    }
  }

  /** Back in the game: effects go on, the pointer returns to the chosen verb. */
  private leaveMenu(): void {
    this.audio.pauseEffects(false);
    this.cursor.mode = this.inventory.held ? 5 : this.verbMode;
    // the click that pressed the button must not reach the scene
    this.armed = false;
    this.talkArmed = false;
  }

  private onMenuAction(a: MenuAction): void {
    switch (a.type) {
      case "resume":
        return this.leaveMenu();
      case "newGame":
        this.leaveMenu();
        return this.newGame();
      case "quit":
        this.endSurface = this.menuScene;
        return this.finish("quit");
      case "load":
      case "save":
        if (!this.fileWindow(a.type, true)) this.addLog(`menu: ${a.type === "load" ? "Załaduj" : "Zapisz"} grę — bez magazynu zapisów`);
        return;
      case "setting":
        return this.applySetting(a.key);
      case "preview":
        return this.audio.preview(a.channel, a.value);
      case "settingsSaved":
        return;
    }
  }

  /** An option of the menu changed (`this.settings` already holds the value). */
  private applySetting(key: keyof GameConfig): void {
    this.audio.applySetting(key, this.settings);
    if (key === "showText" && this.dialog) this.dialog.textOn = this.settings.showText !== 0;
    if (key === "walkSpeed" && this.scene) this.scene.walkSpeed = this.settings.walkSpeed;
  }

  /** "Show the bullet" (`BulletOnOff`, g_cfgBulletMenu): right button opens the bullet menu (true) or the verb menu - read by. */
  get showBullet(): boolean {
    return this.settings.showBullet !== 0;
  }

  /**
 * "Start a new game" (Menu_InGameOptions and Game_Run): `Cursor_LoadSet1`, `Inventory_Clear`,
 * `Var_LoadAll` (every variable back to VARIABLE.ALL), the uniform off; the easy version then gets `Cursor_LoadSet2` + `GUN = 1`.
 * `Game_Run` loads `SC001.CCG` without a fade. **Hypothesis:** the sound is stopped (the code that does this was not found).
 */
  newGame(): void {
    this.fadeRequested = false;
    this.pendingScene = null;
    this.pendingMovie = null;
    this.pendingFilm = null;
    this.clearInventory();
    this.opts.onNewGame?.();
    for (const [k, v] of this.defaults) this.vars.set(k, v);
    this.jackUniform = false;
    this.refusalCounter = 0; // Game_Run prologue
    this.refusal = null;
    if (this.dialog) this.dialog.jackUniform = false;
    if (this.opts.easy) this.vars.set("GUN", 1);
    this.audio.silence();
    this.audio.music.trackName = "";
    this.history.length = 0;
    this.addLog("→ nowa gra: SC001");
    this.phase = "loading";
    this.loadPromise = this.enter("SC001")
      .catch(() => undefined)
      .finally(() => {
        this.loadPromise = null;
      });
  }

  // --- saving and loading ---------------------------------------------

  /** Background work (a store write or read): `settle()` waits for it. */
  private io(p: Promise<void>): void {
    const run = (this.ioPromise ?? Promise.resolve()).then(() => p).catch((e) => this.addLog(`! zapis: ${e instanceof Error ? e.message : String(e)}`));
    const mine = run.finally(() => {
      if (this.ioPromise === mine) this.ioPromise = null;
    });
    this.ioPromise = mine;
  }

  /** `g_sceneSaveable`: 1 at the start of a scene, `SAVEABLE n`, and 0 for SC000C / SC002 / SC005B while LAST is 0 */
  get sceneSaveable(): boolean {
    if (!this.host?.saveable) return false;
    return !this.hardNoSave;
  }

  /** Copy of the scene picture the windows are drawn over (what the menu freezes). */
  private snapshot(): Surface16 {
    const sc = this.scene!;
    const snap = createSurface(640, 480);
    blitCopy(sc.renderer.framebuffer, sc.scrollX, 0, 640, 480, snap, 0, 0);
    return snap;
  }

  /**
 * What the file is made. The item in hand goes back to the coat first, every kind of save (F2 does it in the original -
 * `Item_PutBackToBar`, -, F5 loses the item; user decision 2026-11-03).
 */
  private saveState(): SaveState {
    if (this.inventory.held) {
      this.inv().putBack();
      this.cursor.mode = this.verbMode = 0;
    }
    const entries = [...this.vars.entries()];
    const vars = new Array<number>(VAR_SLOTS).fill(0);
    entries.forEach(([, v], i) => (vars[i] = v));
    return {
      scene: `${this.sceneName}.CCG`,
      music: this.audio.music.trackName,
      vars,
      varCount: entries.length,
      inventory: this.inv(),
      light: !!this.opts.easy,
      autoInc: this.autoInc.state(),
      pose: this.jackSaved,
      sceneSaveable: this.sceneSaveable,
      jackPlaced: this.jackPlaced,
    };
  }

  /** F5: the strip "Szybki Zapis" when no strip is shown, then the file. */
  private quickSave(notice: boolean): void {
    const save = this.opts.save;
    if (!save) return;
    if (notice && this.noticeFont) this.notice.showAuto(NOTICE_Y_QUICKSAVE, encodeMazovia(QUICK_NAME_PL), this.noticeFont);
    const state = this.saveState();
    this.io(save.quickSave(state).then((r) => this.addLog(`zapis: ${r.name}${r.kind === "copy" ? " (kopia początku sceny)" : ""}`)));
  }

  /** F6: the newest quick save; no file = nothing happens, a file of the other version is refused silently. */
  private quickLoad(): void {
    const save = this.opts.save;
    if (!save) return;
    this.io(save.quickLoad().then((r) => void this.afterRead(r)));
  }

  /** The result of reading a save: loaded = the scene is entered again (`g_sceneChange`); otherwise the game goes on. */
  private afterRead(r: ReadResult | null): boolean {
    if (!r) return false;
    if (!r.ok) {
      this.addLog(`wczytanie: ${r.reason === "version" ? "zapis innej wersji gry (cicho pominięty)" : r.message}`);
      return false;
    }
    this.applyLoaded(r.state);
    return true;
  }

  /**
 * F2 / F3 and the menu's "Save" / "Load" (`Menu_Save`, `Menu_Load`): the system
 * window of the file (`saveMode` "files": the game waits for it) or the slot window ("slots"). The hand goes to the coat,
 * the cursor is mode 0, the effects pause. False = no storage.
 */
  private fileWindow(kind: "save" | "load", fromMenu: boolean): boolean {
    const save = this.opts.save;
    if (!save || !this.scene || this.phase !== "playing") return false;
    this.cursor.mode = 0;
    if (!fromMenu) this.audio.pauseEffects(true);
    const done = () => {
      this.modal = false;
      if (!fromMenu) this.leaveWindow();
    };
    this.modal = true;
    if (this.opts.saveMode === "slots") {
      const scene = fromMenu && this.menuScene ? this.menuScene : this.snapshot();
      this.io(
        save.slotDescriptions().then(
          (d) => {
            this.modal = false;
            this.slotUi = { win: new SlotWindow(this.menuAssets!, scene, kind, d), kind, scene, screen: createSurface(640, 480), down: false, fromMenu };
          },
          (e) => {
            done();
            throw e;
          },
        ),
      );
      return true;
    }
    const state = kind === "save" ? this.saveState() : null;
    this.io(
      (kind === "save" ? save.saveToFile(state!).then(() => null) : save.loadFromFile()).then(
        (r) => {
          done();
          if (kind === "load" && this.afterRead(r)) this.menu?.close();
        },
        (e) => {
          done();
          throw e;
        },
      ),
    );
    return true;
  }

  /**
 * "Load a game" of the main menu: `Game_Run` with `g_loadOnStart` (set by `Game_Main` for launcher result 3) calls
 * `Menu_Load` in the first frame of SC001. The window opens over the scene; a cancel leaves the plain new game. False = the scene is
 * not playing yet (the page tries again next frame).
 */
  openLoadWindow(): boolean {
    return this.fileWindow("load", false);
  }

  /** Back in the game after a window opened by a key (F2 / F3): effects go on, the click that closed it does not reach the scene. */
  private leaveWindow(): void {
    this.audio.pauseEffects(false);
    this.cursor.mode = this.inventory.held ? 5 : this.verbMode;
    this.armed = false;
    this.talkArmed = false;
  }

  /** The slot window while open: the mouse of the page drives it; keys come through `keyDown` (so that Esc counts once). */
  private slotFrame(input: PlayInput): void {
    const ui = this.slotUi!;
    if (input.pressed) {
      this.slotEvents(ui.win.pointerDown(input.x, input.y));
      ui.down = true;
    } else if (this.slotUi) this.slotEvents(ui.win.pointerMove(input.x, input.y));
    if (!input.down && ui.down && this.slotUi) {
      ui.down = false;
      this.slotEvents(ui.win.pointerUp(input.x, input.y));
    }
    if (this.slotUi && this.menuCursorCountdown-- < 1) {
      this.menuCursorCountdown = ANIM_PERIOD;
      this.cursor.inWindow = input.inWindow;
      this.cursor.setTargets(false, false);
      this.cursor.animate(input.x);
    }
  }

  private slotEvents(events: ReturnType<SlotWindow["keyDown"]>): void {
    const save = this.opts.save;
    if (!save || !this.slotUi) return;
    for (const e of events) {
      if (!this.slotUi) return;
      if (e.kind === "cancel") this.closeSlots();
      else if (e.kind === "newGame") {
        this.closeSlots();
        this.menu?.close();
        this.leaveMenu();
        this.newGame();
      } else if (e.kind === "load") {
        this.io(
          save.loadFromSlot(e.slot).then((r) => {
            if (this.afterRead(r)) {
              this.slotUi = null;
              this.menu?.close();
            }
          }),
        );
      } else if (e.kind === "save") {
        const state = this.saveState();
        // an empty description is the name of the scene
        this.io(
          save
            .saveToSlot(state, e.slot, e.description.trim() ? e.description : this.sceneName)
            .then(() => save.slotDescriptions())
            .then((d) => this.slotUi?.win.setDescriptions(d)),
        );
      }
    }
  }

  private closeSlots(): void {
    const ui = this.slotUi;
    if (!ui) return;
    this.slotUi = null;
    if (ui.fromMenu) this.menuInput = { down: false, escape: this.lastInput.escape === true }; // the Esc that closed the window must not close the menu
    else this.leaveWindow();
  }

  /**
 * Loads a read save (`Save_LoadState` and what Game_Run does after `g_gameLoaded`): the variables
 * (those the file lacks keep their start values), the uniform (`JACKISWOJ`), the coat (the hand is empty), the music is left to
 * the scripts; then the scene is entered again with `PRE` / `INIT`, Jack at the saved pose when the file says so.
 */
  applyLoaded(l: LoadedState): void {
    const names = [...this.defaults.keys()];
    const values = loadedVars(l, [...this.defaults.values()]);
    names.forEach((n, i) => this.vars.set(n, values[i]));
    const nv = namedVars(values, names);
    this.jackUniform = uniformAfterLoad(this.uniform, nv.jackIsWoj); //
    if (this.dialog) this.dialog.jackUniform = this.jackUniform;
    applyInventory(this.inventory, l, nv.marzeczy);
    this.autoInc.restore(l.autoInc);
    this.bullet.close();
    this.coatRequest = false;
    this.cursor.mode = this.verbMode = 0;
    this.fadeRequested = false;
    this.pendingScene = null;
    this.pendingMovie = null;
    this.pendingFilm = null;
    // a track name different from the playing one stops the music (`Music_Stop(2)`); the same one plays on, uninterrupted.
    // The name stays as it was; the scene's MUSIC command (case 0x3e) compares with it and starts a track only when it differs.
    // The new track is started by `enter` before PRE (`Scene_SetNumberAndMapFlag`); `loadSaved` remembers it.
    this.audio.music.loadSaved(l.music);
    this.audio.pauseEffects(false);
    this.armed = false;
    this.talkArmed = false;
    const scene = l.scene.replace(/\.CCG$/i, "");
    this.addLog(`→ wczytano zapis: ${scene}`);
    this.phase = "loading";
    this.loadPromise = this.enter(scene, l.restorePose ? l.pose : undefined)
      .catch(() => undefined)
      .finally(() => {
        this.loadPromise = null;
      });
  }

  /** `g_restoreJackPose`: Jack at the saved place, `Jack_Stand`; the view as `restoredScroll` (right of 650 → right edge, left of 650 → 0;). */
  private restoreJack(sc: ScenePlayer, p: SavedPose): void {
    sc.setJackPosition(p.x, p.y);
    sc.walker.scale = p.scale;
    sc.walker.dir = p.dir as typeof sc.walker.dir;
    sc.walker.mirror = (p.facing < 0 ? -1 : 1) as typeof sc.walker.mirror;
    sc.standJack();
    sc.scrollX = restoredScroll(sc.scrollX, sc.walker.x, sc.bgWidth);
    this.jackSaved = sc.pose();
  }

  /** The strip of the quick save over the scene (screen coordinates). */
  private noticeOverlay(sc: ScenePlayer): Overlay[] {
    const pic = this.notice.picture(sc.renderer.framebuffer, sc.scrollX);
    return pic ? [{ x: this.notice.x(sc.scrollX) - sc.scrollX, y: this.notice.y, image: pic }] : [];
  }


  /** The game is over (OUTRO.AVX or "Quit the game"): the page stops the engine (`onExit`, `exit`). */
  private finish(reason: "quit" | "finished" | "death"): void {
    this.exit = reason;
    this.phase = "finished";
    this.opts.onExit?.(reason);
  }

  // --- the coat, the hand and the bullet menu -------------------------------------------------

  /** The inventory with MARZECZY applied: `Inventory_Add` chooses the region by the variable at the moment of the call. */
  private inv(): Inventory {
    this.inventory.marzeczy = this.vars.has("MARZECZY") ? this.vars.get("MARZECZY") : 1;
    return this.inventory;
  }

  /** `g_jackUniform`: the version of the coat (INV_C / INV_M) */
  private get uniform(): boolean {
    return this.dialog ? this.dialog.jackUniform : this.jackUniform;
  }

  /** The item in hand as the cursor image (mode 5). */
  private heldImage(): Image16 | null {
    return (this.inventory.held?.image as Image16 | undefined) ?? null;
  }

  /** Image of an object by name: the scene's archive, then GLOBAL.PAK and RESOURCE.PAK (items made by the global macros). */
  private objectImage(name: string, sc: ScenePlayer): Image16 | null {
    for (const pak of [this.scenePak(sc), this.global, this.resource]) {
      if (!pak.find(name)) continue;
      try {
        const data = pak.read(name);
        const img = name.toUpperCase().endsWith(".PBM") ? decodePbm(data, name) : decodeBm(data); // as ScenePlayer.image
        if (img.width > 0 && img.height > 0) return img;
      } catch {
        // an undecodable file is not an image
      }
    }
    return null;
  }

  /** `Inventory_Clear` and `Cursor_ResetMode` (a new game, the return after an exit film). */
  private clearInventory(): void {
    this.inventory.clear();
    this.bullet.close();
    this.coatRequest = false;
    this.cursor.mode = this.verbMode = 0;
  }

  /** The inventory commands of the scripts (host.ts `ItemPort`;). */
  private itemPort(sc: ScenePlayer): ItemPort {
    const guarded = (action: string, f: () => void): void => {
      try {
        f();
      } catch (e) {
        if (!(e instanceof InventoryError)) throw e;
        this.addLog(`! ${action}: ${e.message}`);
      }
    };
    return {
      haveTool: (object) =>
        guarded(`HAVETOOL ${object}`, () => {
          const img = this.objectImage(object, sc);
          if (!img) this.addLog(`! HAVETOOL ${object}: no image`);
          else if (this.inv().add(object, img) < 0) this.addLog(`HAVETOOL ${object}: the coat is full`);
        }),
      noHaveTool: (name) => {
        if (this.inventory.held?.name === name) this.cursor.mode = this.verbMode = 0; // Script_ExecStep case 0x46,
        this.inv().remove(name);
      },
      noHave: () => {
        this.inventory.noHave();
        this.cursor.mode = this.verbMode = 0;
      },
      take: (object) => {
        const img = this.objectImage(object, sc);
        if (!img) return false;
        guarded(`TAKE ${object}`, () => this.inv().take(object, img));
        if (this.inventory.held?.name !== object) return false;
        // case 0x21: g_cursorMode = 5, g_clickArmed = 0; the bullet menu closes
        this.cursor.mode = 5;
        this.armed = false;
        this.bullet.close();
        this.takeFlag = true;
        return true;
      },
      mouseToTool: () => {
        if (!this.inventory.held) return;
        this.inv().putBack();
        this.cursor.mode = this.verbMode = 0;
      },
      itemPresent: (name) => this.inventory.has(name),
      moveBigRegion: () => this.inventory.moveBigRegion(),
      setGun: (on) => {
        // HAVEGUN: Cursor_LoadSet2 + GUN = 1; NOHAVEGUN: Cursor_LoadSet1 + GUN = 0, and mode 3 becomes 0
        this.vars.set("GUN", on ? 1 : 0);
        // Script_ExecStep l. 1795: only the gun cursor itself goes back to the pointer, together with the verb
        if (!on) {
          const c = noHaveGunCursor({ mode: this.cursor.mode, verbMode: this.verbMode });
          this.cursor.mode = c.mode;
          this.verbMode = c.verbMode;
        }
      },
      setUniform: (on) => {
        this.jackUniform = on;
      },
    };
  }

  private coatHost(): CoatHost {
    const names = this.resource.find("ELEM.LST") ? itemNameLookup(this.resource.read("ELEM.LST")) : () => null;
    return {
      startMacro: (name) => !!this.interpreter && interpreterPort(this.interpreter).start(name) >= 0,
      itemName: names,
      onExit: (e) => this.onCoatExit(e),
    };
  }

  /** Button edges of this frame (the page latches them, else they come from the change of the level). */
  private edges(input: PlayInput): { right: boolean; middle: boolean } {
    const right = input.rightPressed ?? (!!input.right && !this.prevRight);
    const middle = input.middlePressed ?? (!!input.middle && !this.prevMiddle);
    this.prevRight = !!input.right;
    this.prevMiddle = !!input.middle;
    return { right, middle };
  }

  /**
 * Game_Run line 467 (the prologue every scene passes, after Save_WriteState, before [PRE]): `MENU = (g_exitToDos == 0)` = 1.
 * SC000D [PRE] does `LET MENU` and nothing else writes the variable; without this reset F1-F4 and the click on Jack stayed dead
 * in every scene entered from the map.
 */
  private resetMenuVar(): void {
    this.vars.set("MENU", 1);
  }

  /**
 * Game_Run ~line 705: a scene without control (the city map SC000D, SC008B) zeroes `g_verbMode` and `g_cursorMode`;
 * so the map is clicked with the pointer (`POKAZANIE- `) and the verb chosen before the map does not come back after it.
 */
  private startNoControl(name: string): void {
    const c = noControlCursor(name, this.cursor.mode, this.verbMode);
    this.cursor.mode = c.mode;
    this.verbMode = c.verbMode;
  }


  /** `g_coatRequest` (Game_Run 4150): the right button with an item in hand (mode 5) or the middle one asks for the coat. */
  private mouseRequests(input: PlayInput): void {
    const e = this.edges(input);
    if (this.bar) return; // the bar replaces the coat
    if ((e.right && this.cursor.mode === 5) || e.middle) this.coatRequest = true;
  }

  /** Game_Run: the scene stands, effects pause, the coat of the current uniform opens. */
  private openCoat(): boolean {
    const coat = this.coat;
    if (!coat || this.bar || this.phase !== "playing") return false;
    this.inv();
    this.coatRequest = false;
    this.bullet.close();
    coat.open(this.uniform);
    this.coatWait = !!(this.lastInput.down || this.lastInput.right || this.lastInput.middle); // opened by a button: it waits until they are up
    this.coatLeftDown = false;
    this.audio.pauseEffects(true);
    this.cursor.mode = coat.cursorMode;
    this.cursor.inWindow = true;
    return true;
  }

  /** The coat while open: the mouse of the page drives it; the scene is not touched. */
  private coatFrame(input: PlayInput): void {
    const coat = this.coat!;
    const e = this.edges(input);
    if (this.coatWait && !input.down && !input.right && !input.middle) this.coatWait = false;
    coat.pointerMove(input.x, input.y);
    if (!this.coatWait) {
      // the Ctrl points are a level check of Game_Run: Ctrl pressed while the button is already held over a point works too
      if (input.ctrl && input.down && !input.pressed && coat.ctrlHeld(input.x, input.y)) return;
      if (input.pressed) {
        this.coatLeftDown = true;
        coat.pointerDown(input.x, input.y, 0, input.ctrl === true);
      }
      if (coat.isOpen && e.middle) coat.pointerDown(input.x, input.y, 1);
      if (coat.isOpen && e.right) coat.pointerDown(input.x, input.y, 2);
      if (coat.isOpen && !input.down && this.coatLeftDown) {
        this.coatLeftDown = false;
        coat.pointerUp(input.x, input.y, 0);
      }
    }
    if (!coat.isOpen) return;
    coat.tick();
    this.cursor.mode = coat.cursorMode;
    this.cursor.inWindow = input.inWindow;
    if (this.coatCursorCountdown-- < 1) {
      this.coatCursorCountdown = ANIM_PERIOD;
      this.cursor.setTargets(!coat.cursorIdle, !coat.cursorIdle);
      this.cursor.animate(input.x);
    }
  }

  /** M: the scene stands, the effects pause, the music goes on, no cursor. */
  private openMiniMap(): boolean {
    const mm = this.miniMap;
    if (!mm || !this.scene || this.phase !== "playing") return false;
    mm.open(loadMiniMapAssets(this.global, sceneChapter(sceneNumber(this.sceneName))), this.snapshot(), this.mKeyHeld);
    this.bullet.close();
    this.audio.pauseEffects(true); // Snd_TogglePauseFx
    return true;
  }

  /** The end of the small map: the effects go on; like the coat, no click reaches the scene before the buttons are up. */
  private onMiniMapExit(): void {
    this.audio.pauseEffects(false);
    this.armed = false;
    this.talkArmed = false;
    this.waitRelease = true;
  }

  /** The end of the coat: effects go on, the cursor returns to the verb unless an item is held. */
  private onCoatExit(e: CoatExit): void {
    this.audio.pauseEffects(false);
    this.cursor.mode = this.inventory.held ? 5 : this.verbMode;
    this.armed = false;
    this.talkArmed = false;
    this.waitRelease = true;
    switch (e.kind) {
      case "close":
      case "macro":
        return;
      case "options":
        this.openMenu("main");
        return;
      case "ctrl":
        return this.ctrlPoint(e.point);
    }
  }

  // --- the legacy item bar (topbar.ts) ---------------------------------------------------------

  private barHost(): TopBarHost {
    const names = this.resource.find("ELEM.LST") ? itemNameLookup(this.resource.read("ELEM.LST")) : () => null;
    return {
      startMacro: (name) => !!this.interpreter && interpreterPort(this.interpreter).start(name) >= 0,
      macroActive: (name) => !!this.interpreter?.isActive(name),
      itemName: names,
      requestOptions: () => this.openMenu("main"),
    };
  }

  /** One frame of the bar; true while it holds the mouse (the scene stands still, update() is frozen). */
  private barFrame(input: PlayInput): boolean {
    const bar = this.bar!;
    this.inv();
    const was = bar.isOpen;
    const e = this.edges(input);
    const free = !this.playerHeld() && !this.dialog?.talking && !this.dialog?.menu && !this.bullet.open &&
      !this.notice.shown && !this.pendingScene && !this.pendingMovie && !this.pendingFilm;
    bar.frame({ x: input.x, y: input.y, down: !!input.down, pressed: !!input.pressed, right: !!input.right, rightPressed: e.right, inWindow: input.inWindow }, free);
    if (bar.isOpen) {
      if (!was) this.bullet.close();
      this.cursor.mode = bar.cursorMode;
      this.cursor.inWindow = input.inWindow;
      if (this.barCursorCountdown-- < 1) {
        this.barCursorCountdown = ANIM_PERIOD;
        this.cursor.setTargets(!bar.cursorIdle, !bar.cursorIdle);
        this.cursor.animate(input.x);
      }
      return true;
    }
    if (was && this.menu?.isOpen) {
      // the options button opened the F4 menu in this frame (openMenu set the pointer, mode 0): keep it; leaveMenu restores the verb cursor
      this.armed = false;
      this.talkArmed = false;
      return true;
    }
    if (was) {
      // the bar is gone: the cursor returns to the verb unless an item is held; the click that ended it does not reach the scene
      this.cursor.mode = this.inventory.held ? 5 : this.verbMode;
      this.armed = false;
      this.talkArmed = false;
      this.waitRelease = true;
      return true;
    }
    return false;
  }

  /** The bar's pictures (legacy bar only) and RAMKA (the frame around the item in hand, with or without the bar) over the scene. */
  private barOverlays(sc: ScenePlayer): Overlay[] {
    const bar = this.bar;
    const out: Overlay[] = bar ? bar.overlays(sc.renderer.framebuffer, sc.scrollX) : [];
    // Game_Run: RAMKA only when g_cursorIdle == 0, with no bar, answer menu, caption or bullet menu (modes 5 and up)
    const d = this.dialog;
    const f = frameOverlay(this.frameImage, {
      idle: this.cursor.frameIdle,
      mode: this.cursor.mode,
      barOpen: !!bar?.isOpen,
      menuOpen: !!d?.menu,
      captionShown: !!(d?.caption && !this.captionHidden),
      bulletOpen: this.bullet.open,
    }, this.lastInput.x, this.lastInput.y);
    if (f) out.push(f);
    return out;
  }

  /** The hidden Ctrl points of the coat (debug features of the original). */
  private ctrlPoint(point: number): void {
    const sc = this.scene;
    if (!sc || !this.interpreter) return;
    switch (point) {
      case 1: // TOPWARE + MONEY.BM (Inventory_Add)
        interpreterPort(this.interpreter).start("TOPWARE");
        this.itemPort(sc).haveTool("MONEY.BM");
        this.addLog("Ctrl + płaszcz: TOPWARE i MONEY.BM");
        return;
      case 2: // strcpy("OUTRO.AVX"): the exit film, the end of the game
        this.pendingMovie = { film: "OUTRO.AVX", scene: "NULL" };
        return;
      case 3: {
        // the city map SC000D, a hard cut (g_sceneChange; = 1 only hides the cursor until the change ends, Cursor_DrawOnPresent ; fading comes only from REFRESHSCREEN); `LAST` by the chapter of the current scene (Scene_ChapterFromName, Scene_SetNumberAndMapFlag)
        const last = mapLast(sceneChapter(sceneNumber(this.sceneName)));
        if (last !== null) this.vars.set("LAST", last);
        this.fadeRequested = false;
        this.pendingScene = MAP_SCENE;
        return;
      }
      case 4: // the JACKISMENU toggle: Var_Set and g_jackIsMenu together
        this.vars.set("JACKISMENU", this.vars.get("JACKISMENU") !== 0 ? 0 : 1);
        this.jackIsMenu = this.vars.get("JACKISMENU") !== 0;
        return;
    }
  }

  /**
 * Steps 12-13 of Game_Run: the right button opens the bullet menu or the verb window, the left one chooses an icon.
 * "verb" = the modal window opened (the frame ends), "blocked" = the bullet is open and this frame's left click must not reach the scene.
 */
  private bulletFrame(input: PlayInput, world: { x: number; y: number }, locked: boolean): "none" | "verb" | "blocked" {
    const sc = this.scene!;
    const d = this.dialog;
    const esc = this.escPressed;
    this.escPressed = false;
    const click = this.cursor.clickPoint(world.x, world.y);
    const gun = this.vars.get("GUN") === 1;
    const events = this.bullet.frame({
      mouseX: world.x,
      mouseY: world.y,
      scrollX: sc.scrollX,
      clickX: click.x,
      clickY: click.y,
      leftDown: input.down,
      rightDown: input.right === true,
      esc,
      cursorMode: this.cursor.mode,
      gun,
      showBullet: this.showBullet,
      blocked: (!!d && (d.faceView("L") !== null || d.faceView("R") !== null)) || isNoControlScene(this.sceneName),
      cursorEnabled: !locked,
      language: "P",
    });
    let verb: Extract<BulletEvent, { type: "verbMenu" }> | null = null;
    for (const ev of events) {
      if (ev.type === "open") {
        // g_cursorMode = 0, then Cursor_EnableDraw - the verb is the pointer again
        this.cursor.mode = 0;
        this.enableDraw();
      }
      else if (ev.type === "select") this.cursor.mode = this.verbMode = ev.mode;
      else if (ev.type === "verbMenu") verb = ev;
    }
    if (verb) {
      this.cursor.mode = 0;
      return this.openVerbWindow(verb.x, verb.y, gun) ? "verb" : "none";
    }
    return this.bullet.blockLeft ? "blocked" : "none";
  }

  /** `Cursor_VerbMenu`: the modal list of verbs at the screen position; the effects pause meanwhile. */
  private openVerbWindow(x: number, y: number, gun: boolean): boolean {
    const sc = this.scene;
    if (!sc || !this.menuAssets) return false;
    const snap = createSurface(640, 480);
    blitCopy(sc.renderer.framebuffer, sc.scrollX, 0, 640, 480, snap, 0, 0);
    this.verbScene = snap;
    this.verbWindow = new VerbMenu(this.menuAssets, snap, x, y, gun, VERB_TEXTS.P);
    this.verbLeftDown = false;
    this.audio.pauseEffects(true);
    return true;
  }

  private verbFrame(input: PlayInput): void {
    const v = this.verbWindow!;
    if (!v.done) {
      if (input.pressed) {
        v.pointerDown(input.x, input.y);
        this.verbLeftDown = true;
      } else v.pointerMove(input.x, input.y);
      if (!input.down && this.verbLeftDown && !v.done) {
        this.verbLeftDown = false;
        v.pointerUp(input.x, input.y);
      }
    }
    if (v.done) return this.finishVerb();
    if (this.menuCursorCountdown-- < 1) {
      this.menuCursorCountdown = ANIM_PERIOD;
      this.cursor.inWindow = input.inWindow;
      this.cursor.setTargets(false, false);
      this.cursor.animate(input.x);
    }
  }

  /** The window ended: the chosen mode becomes the verb; Esc leaves mode 0. */
  private finishVerb(): void {
    const r = this.verbWindow!.result;
    this.verbWindow = null;
    this.verbScene = null;
    this.audio.pauseEffects(false);
    this.cursor.mode = r ? (this.verbMode = r.mode) : 0;
    this.armed = false;
    this.talkArmed = false;
    this.waitRelease = true;
  }

  // --- what to draw ---------------------------------------------------------------------------

  view(): PlayView | null {
    const still = (surface: Surface16): PlayView => ({ surface, scrollX: 0, cursor: null, cursorImage: null, lensMasks: this.cursorImages, overlays: [] });
    if (this.phase === "fading" && this.transition) return still(this.transition.current);
    if (this.phase === "movie" && this.movie) return still(this.movie.surface);
    if (this.phase === "finished" && this.endSurface) return still(this.endSurface);
    const sc = this.scene;
    if (!sc) return null;
    if (this.verbWindow && this.verbScene) {
      const screen = (this.verbScreen ??= createSurface(640, 480));
      blitCopy(this.verbScene, 0, 0, 640, 480, screen, 0, 0);
      this.verbWindow.draw(screen);
      return this.screenView(screen);
    }
    if (this.miniMap?.isOpen) {
      // the cursor sprite is removed while the map is open (g_renderIdle = 0)
      const screen = (this.miniScreen ??= createSurface(640, 480));
      this.miniMap.draw(screen);
      return { surface: screen, scrollX: 0, cursor: null, cursorImage: null, lensMasks: this.cursorImages, overlays: [] };
    }
    if (this.coat?.isOpen) {
      const screen = (this.coatScreen ??= createSurface(640, 480));
      this.coat.draw(screen);
      return this.screenView(screen);
    }
    if (this.slotUi) {
      const ui = this.slotUi;
      blitCopy(ui.scene, 0, 0, 640, 480, ui.screen, 0, 0);
      ui.win.draw(ui.screen);
      return this.screenView(ui.screen);
    }
    if (this.menu?.isOpen && this.menuScene) {
      const screen = (this.menuScreen ??= createSurface(640, 480));
      blitCopy(this.menuScene, 0, 0, 640, 480, screen, 0, 0);
      this.menu.draw(screen);
      // the menu pointer is the animated "Wsk" cursor (cursor mode 0, Cursor_DrawOnPresent with = 1)
      const draw = this.cursor.present(this.lastInput.x, this.lastInput.y);
      return { surface: screen, scrollX: 0, cursor: draw, cursorImage: draw ? (this.cursorImages.get(draw.image) ?? null) : null, lensMasks: this.cursorImages, overlays: [] };
    }
    if (this.phase === "film" && this.film) {
      const w = this.film.run.windowAt(this.film.clockMs);
      const overlay: Overlay = { x: w.x - sc.scrollX, y: w.y, image: { width: w.width, height: w.height, pixels: w.pixels } };
      return { surface: sc.renderer.framebuffer, scrollX: sc.scrollX, cursor: null, cursorImage: null, lensMasks: this.cursorImages, overlays: [overlay] };
    }
    let draw: CursorDraw | null = null;
    // the answer menu shows the cursor (Cursor_EnableDraw, Script_ExecStep case 0xb) although the DIALOG macro runs
    const locked = (!!this.interpreter?.playerLocked() && !this.dialog?.menu) || this.deathSequence();
    const hidden = !this.interpreter || locked || this.phase !== "playing";
    if (!hidden) draw = this.cursor.present(this.lastInput.x + sc.scrollX, this.lastInput.y);
    return {
      surface: sc.renderer.framebuffer,
      scrollX: sc.scrollX,
      cursor: draw,
      cursorImage: this.cursorImageOf(draw),
      lensMasks: this.cursorImages,
      overlays: this.phase === "playing" ? [...this.overlays(sc), ...this.bulletOverlays(sc), ...this.noticeOverlay(sc), ...this.barOverlays(sc)] : [],
    };
  }

  private cursorImageOf(draw: CursorDraw | null): Image16 | null {
    if (!draw) return null;
    return draw.image === "item" ? this.heldImage() : (this.cursorImages.get(draw.image) ?? null);
  }

  /** A whole-screen view (menu, verb window, coat) with the cursor of the current mode over it. */
  private screenView(screen: Surface16): PlayView {
    const draw = this.cursor.present(this.lastInput.x, this.lastInput.y);
    return { surface: screen, scrollX: 0, cursor: draw, cursorImage: this.cursorImageOf(draw), lensMasks: this.cursorImages, overlays: [] };
  }

  /** The opened bullet and the pressed icon highlights (sprites 950..955). */
  private bulletOverlays(sc: ScenePlayer): Overlay[] {
    const b = this.bullet;
    if (!b.open) return [];
    const gun = this.vars.get("GUN") === 1;
    const out: Overlay[] = [];
    const base = this.bulletImages.get(bulletImageName(gun));
    if (!base) return out;
    const x = b.x - sc.scrollX;
    out.push({ x, y: b.y, image: base });
    const lit = new Set(b.highlights());
    for (const icon of ICONS) {
      const img = lit.has(icon.id) ? this.bulletImages.get(highlightImageName(icon, gun)) : undefined;
      if (img) out.push({ x: x + icon.x, y: b.y + icon.y, image: img });
    }
    return out;
  }

  // --- the dialog layer on the screen -----------------------------------------------------------

  /**
 * Face windows (Face_Show), the caption of the line and the answer menu rows, over the scene. The frame
 * and background of a window (a shaded bevel) are approximated by a flat dark fill with a light
 * two-pixel border.
 */
  private overlays(sc: ScenePlayer): Overlay[] {
    const d = this.dialog;
    const a = this.dialogAssets;
    if (!d || !a) return [];
    const out: Overlay[] = [];
    for (const side of ["L", "R"] as Side[]) {
      const v = d.faceView(side);
      if (v) out.push({ x: faceWindowX(side, 0), y: FACE_WINDOW_Y, image: this.faceWindow(side, v, sc) });
    }
    const k = this.captionHidden ? null : d.caption;
    if (k) for (const l of k.lines) out.push({ x: captionLineX(l.x, this.captionScroll), y: l.y, image: this.text(l.text, k.outline, k.fill) });
    const menu = d.menu;
    if (menu) {
      menu.rows.forEach((r, i) => {
        const st = rowStyle(i === menu.pressed, a.tables.menuFill);
        const x = r.x - sc.scrollX;
        if (st.shadow) out.push({ x: x + 1, y: r.y + 1, image: this.text(r.text, 0, 0x2104) });
        out.push({ x: x + st.dx, y: r.y + st.dy, image: this.text(r.text, d.textColors[0], st.fill) });
      });
    }
    return out;
  }

  private text(text: string, outline: number, fill: number): Image16 {
    const key = `${outline}:${fill}:${text}`;
    let img = this.textCache.get(key);
    if (!img) {
      if (this.textCache.size > 400) this.textCache.clear();
      const t = renderText(this.dialogAssets!.font, encodeMazovia(text), outline, fill);
      img = { width: t.width, height: t.height, kind: "rgb565", pixels: t.pixels };
      this.textCache.set(key, img);
    }
    return img;
  }

  private faceImage(source: "resource" | "scene", file: string, sc: ScenePlayer): Image16 {
    const key = `${source}:${file}`;
    let img = this.faceImages.get(key);
    if (!img) {
      const pak = source === "resource" ? this.resource : this.scenePak(sc);
      img = decodePbm(pak.read(file), file);
      this.faceImages.set(key, img);
    }
    return img;
  }

  /**
 * The window of a face: the scene behind it is copied when the face is (re)drawn, darkened by the colour tables
 * with a bevel of two rings (Talk_FaceStep `Render_ComposeRegion` + + the portrait), so
 * the picture shows through. Redrawn only when the face state changes.
 */
  private faceWindow(side: Side, v: NonNullable<ReturnType<DialogController["faceView"]>>, sc: ScenePlayer): Surface16 {
    const key = `${v.slot}:${v.source}:${v.mirrored}:${v.mouth}:${v.eyes.join(",")}`;
    const memo = this.faceWindows[side];
    if (memo && memo.key === key) return memo.window;
    const face = composeFace(v, (file) => this.faceImage(v.source, file, sc));
    const px = faceWindowPixels(sc.renderer.framebuffer, faceWindowX(side, sc.scrollX), FACE_WINDOW_Y, face.pixels, this.dialogAssets!.remap);
    const window: Surface16 = { width: FACE_WINDOW, height: FACE_WINDOW, pixels: px };
    this.faceWindows[side] = { key, window };
    return window;
  }
}

// --- Jack's refusal (Jack_RefuseAction) and the Ctrl point 3 of the coat -------------------------

/** One of Jack's three refusals from the catalog: caption, voice file, and caption width. */
export interface JackRefusal {
  text: string;
  voice: string;
  width: number;
}

/** The film of `RUNAVX` that ends the game as a death (every one except `OUTRO.AVX`, `Game_Run`). */
export function isDeathFilm(film: string): boolean {
  return !/^OUTRO(\.AVX)?$/i.test(film);
}

/**
 * [engine]: does an active macro run, without a condition in between, to a `RUNAVX` of a death film? Scans the commands from
 * each active macro's next one. An `IF var value` block is entered when the variable has that value now (`GANGSTERZY`: `IF GUN 0` ...
 * `DONOTHING 180`, `RUNAVX Z32A`; `POKAZANIE-PRAWO` of SC038: `IF BYLAPRZEBITKA 1`); any other condition counts as not entered. `GOTOSCENE` /
 * `DEACTIVESELF` end the scan. `CZEKAJ` of SC051 (`DONOTHING 400`, the player may still act) is not a death; it starts with `ZABJACK`.
 * Evaluated every frame, nothing is remembered: a variable that changes ends the sequence at once.
 */
export function deathAhead(it: Pick<Interpreter, "macros" | "program" | "vars">): boolean {
  const cmds = it.program.commands;
  for (const m of it.macros) {
    if (!m.active) continue;
    let skip = 0; // depth inside a block that is not entered
    for (let pc = m.pc; pc < m.start + m.count; pc++) {
      const c = cmds[pc];
      if (skip > 0) {
        if (IF_CODES.includes(c.code)) skip++;
        else if (c.code === ENDIF) skip--;
      } else if (IF_CODES.includes(c.code)) {
        // `IF var value` (0x1b) is decided by the variable now; every other condition (answers, mouse, IFF) is unknown = not entered
        const ref = c.code === 0x1b ? c.refs.find((r) => r[0] === 2 && r[1] === "var") : undefined;
        if (!ref || it.vars.get(ref[2] as string) !== c.a[0]) skip = 1;
      } else if (c.word === "RUNAVX" && isDeathFilm(c.n1)) return true;
      else if (c.word === "GOTOSCENE" || c.word === "DEACTIVESELF") break;
    }
  }
  return false;
}

/**
 * Screen x of a caption line. The original draws the caption in world coordinates (`Caption_Draw`), so a line that starts while
 * the view still scrolls rides away with the scene. (deviation, user's request): the line stays at the screen position it had when it
 * started (`scrollAtStart`). With SHOWFACE waiting for the end of a scroll (`Script_ExecStep` case 0x17) this only matters for a TALK that
 * starts during a scroll without a face.
 */
export function captionLineX(worldX: number, scrollAtStart: number): number {
  return worldX - scrollAtStart;
}

/**
 * Which refusal comes next and where it is shown: the counter goes up by one mod 3 (it is 0 at the start of a game,
 * so the first refusal is the second line); a click right of the middle of the screen (`clickX > scrollX + 320`) opens Jack's face in the
 * left window (channel 1), else in the right one (channel 2); the caption is on that side.
 */
export function jackRefusal(counter: number, clickX: number, scrollX: number): { index: number; side: Side; channel: number } {
  const left = scrollX + 0x140 < clickX;
  return { index: (counter + 1) % 3, side: left ? "L" : "R", channel: left ? 1 : 2 };
}

/** `LAST` that the Ctrl point 3 gives for the chapter (Game_Run, the Ctrl points of the coat): 1 -> 6, 2 -> 32, 3 -> 75; chapter 4 leaves it as it is. */
export function mapLast(chapter: number): number | null {
  return chapter === 1 ? 6 : chapter === 2 ? 0x20 : chapter === 3 ? 0x4b : null;
}

/** `Sprite_ClickMacro`: the target is Jack's sprite, the hand is empty and `g_jackIsMenu` is set: `g_coatRequest = 1`. */
export function jackClickAsksCoat(target: string, itemInHand: boolean, jackIsMenu: boolean): boolean {
  return target === "JACK" && !itemInHand && jackIsMenu;
}
