// The game as the original runs it, without DOM: a scene (ScenePlayer) driven by its macro
// interpreter, the cursor, clicks on areas / sprites / the floor, and the change of scenes
// (GOTOSCENE, optionally through the fade of REFRESHSCREEN). The host feeds
// it time and the mouse and draws what `view()` says.
// Frame order: the scene is loaded, the area flags
// are reset, [PRE] runs to its end at once, [INIT] starts, then every frame: cursor and clicks
//, one command of every active macro, and on every 15 ms logic
// tick the animations (Game_TimerTick + the step blocks of Game_Run).

import * as sceneBody from "./game-scene";
import * as frameBody from "./game-frame";
import * as filmBody from "./game-film";
import * as keysBody from "./game-keys";
import * as menuBody from "./game-menu";
import * as saveBody from "./game-save";
import * as inventoryBody from "./game-inventory";
import * as viewBody from "./game-view";
import * as dialogBody from "./game-dialog";
import { allCursorFiles, lensMaskFiles, Cursor, CursorEnable } from "../cursor";
import type { DialogController } from "../dialog";
import { DIALOG_TABLES, ReleaseGate, type Side } from "../dialog";
import { decodeBm, type Image16 } from "../formats/bm";
import { JACK_REFUSALS } from "./refusals";
import { parseFnt, type Font } from "../formats/fnt";
import { parseIcs, type Ics } from "../formats/global";
import { Pak } from "../formats/pak";
import { decrypt } from "../formats/textcrypt";
import { PlayAudio } from "./audio";
import { BUNDLED_REMAP } from "./facewin";
import type { Overlay } from "./overlay";
import { AreaState, type HitRect, type ClickOutcome } from "../areas";
import type { SceneTransition } from "../render";
import { type Surface16 } from "../render";
import { createSurface } from "../render/surface";
import { GuiMenu, loadMenuAssets, TEXTS_PL, type MenuAssets } from "../gui";
import type { VerbMenu } from "../bulletmenu";
import { BulletMenu, highlightImageName, ICONS, bulletImageName } from "../bulletmenu";
import { CoatScreen, Inventory, loadCoatAssets } from "../inventory";
import { WheelAccumulator } from "../inventory/wheel";
import { TopBar, loadTopBarAssets } from "../inventory/topbar";
import { MiniMapScreen } from "../minimap";
import { defaultConfig, type GameConfig } from "../settings/config";
import { NoticeStrip } from "../keys/notice";
import type { SlotWindow } from "../save";
import { type JackPose as SavedPose, type LoadedState } from "../save";
import type { ScenePlayer } from "../scene";
import { type SceneEvent } from "../scene";
import type { Interpreter } from "../script";
import { parseVariables, Variables } from "../script";
import type { EdgeState } from "./edgescroll";
import type { SceneHost } from "./host";
import { AutoIncClock } from "./host";
import type { GameFiles, LogLine, Phase, PlayInput, PlayOptions, PlayView } from "./types";
import type { GameState, DialogAssets, RunningFilm, RunningMovie, JackRefusal } from "./game-state";

export {
  MOVIE_FADE_STEP_MS,
  type GameFiles,
  type LogLine,
  type Phase,
  type PlayInput,
  type PlayOptions,
  type PlayView,
} from "./types";
export { captionLineX, deathAhead, isDeathFilm, jackClickAsksCoat, jackRefusal, mapLast } from "./predicates";
export type { JackRefusal } from "./game-state";

/** POCISK*.BM and the highlights of the bullet menu */
function bulletImageNames(): string[] {
  const names = new Set<string>();
  for (const gun of [false, true]) {
    names.add(bulletImageName(gun));
    for (const i of ICONS) names.add(highlightImageName(i, gun));
  }
  return [...names];
}

// Prototype wrappers stay one call. Prettier would split them past the 400-line ceiling.
// prettier-ignore
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
  private scenePhk = new WeakMap<ScenePlayer, Pak>();
  private readonly wheelSum = new WheelAccumulator();
  /** `[macro]` of a TAKE (case 0x21): set by TAKE, cleared at the next step of that macro - about one frame. */
  private takeFlag = false;

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
      const i = n === "item" ? inventoryBody.heldImage.call(this as unknown as GameState) : this.cursorImages.get(n);
      return i ? { w: i.width, h: i.height } : null;
    });
    this.retain();
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
      game.coat = new CoatScreen(game.inventory, coatAssets, inventoryBody.coatHost.call(game as unknown as GameState));
      game.miniMap = new MiniMapScreen({ onExit: () => keysBody.onMiniMapExit.call(game as unknown as GameState) });
      if (opts.inventory === "bar") game.bar = new TopBar(game.inventory, loadTopBarAssets(resource), coatAssets.font, inventoryBody.barHost.call(game as unknown as GameState));
      if (withMenu) {
        game.menuAssets = loadMenuAssets(resource);
        game.menu = new GuiMenu({
          assets: game.menuAssets,
          texts: TEXTS_PL,
          config: game.settings,
          scene: createSurface(640, 480),
          persist: (cfg) => opts.persistSettings?.(cfg),
          onAction: (a) => menuBody.onMenuAction.call(game as unknown as GameState, a),
        });
        const sample = (name: string) => (resource.find(name) ? resource.read(name) : undefined);
        game.audio.loadPreviews(sample("SFX.S16"), sample("TALK.S16"));
      }
    }
    await game.enter(opts.start ?? "SC001");
    return game;
  }

  get menuOpen(): boolean {
    return !!this.menu?.isOpen;
  }

  /** "Show the bullet" (`BulletOnOff`, g_cfgBulletMenu): right button opens the bullet menu (true) or the verb menu - read by. */
  get showBullet(): boolean {
    return this.settings.showBullet !== 0;
  }

  /** `g_sceneSaveable`: 1 at the start of a scene, `SAVEABLE n`, and 0 for SC000C / SC002 / SC005B while LAST is 0 */
  get sceneSaveable(): boolean {
    if (!this.host?.saveable) return false;
    return !this.hardNoSave;
  }

  /** `g_jackUniform`: the version of the coat (INV_C / INV_M) */
  private get uniform(): boolean {
    return this.dialog ? this.dialog.jackUniform : this.jackUniform;
  }

  /** The group files read these. A reference keeps the private names in use. */
  private retain(): void {
    void [
      this.pendingFilm, this.defaultMusic, this.endSurface, this.dialogAssets, this.jackUniform, this.talkArmed,
      this.skipLine, this.captionTicks, this.captionSeen, this.captionScroll, this.captionHidden, this.modal,
      this.ioPromise, this.jackSaved, this.jackPlaced, this.hardNoSave, this.autoInc, this.autosavePending,
      this.miniScreen, this.mKeyHeld, this.prevCursorRect, this.barCursorCountdown, this.refusals, this.refusalCounter,
      this.refusal, this.defaults, this.menuAssets, this.bulletImages, this.coatScreen, this.coatWait,
      this.coatLeftDown, this.coatCursorCountdown, this.verbScene, this.verbScreen, this.verbLeftDown, this.escPressed,
      this.waitRelease, this.prevRight, this.prevMiddle, this.menuScene, this.menuScreen, this.menuInput,
      this.menuCursorCountdown, this.keysPressed, this.wasTalking, this.musicClock, this.textCache, this.faceWindows,
      this.faceImages, this.armed, this.menuCursorSaved, this.menuGate, this.edge, this.drawEnabled, this.scrolling,
      this.cursorCountdown, this.overReaction, this.overObject, this.loadPromise, this.logged, this.lastInput,
      this.idleMouse, this.files, this.resource, this.global, this.globalIcs, this.cursorImages, this.opts,
      this.scenePhk, this.wheelSum, this.takeFlag, this.uniform, this.enter, this.addLog, this.release,
      this.captionTimer, this.answerMenuCursor, this.syncMouseVars, this.jackRefuses, this.refusalFrame, this.stepFilm,
      this.beginMovieFade, this.advanceMovieFade, this.stepMovie, this.keyFrame, this.leaveMenu, this.quickSave,
      this.quickLoad, this.fileWindow, this.inv, this.edges, this.resetMenuVar, this.startNoControl, this.openCoat,
      this.barFrame, this.barOverlays, this.ctrlPoint,
    ];
  }

  async settle(): Promise<void> { return sceneBody.settle.call(this as unknown as GameState); }
  private async enter(name: string, restorePose?: SavedPose): Promise<void> { return sceneBody.enter.call(this as unknown as GameState, name, restorePose); }
  private addLog(text: string): void { return sceneBody.addLog.call(this as unknown as GameState, text); }
  update(): void { return frameBody.update.call(this as unknown as GameState); }
  private release(ev: SceneEvent): void { return sceneBody.release.call(this as unknown as GameState, ev); }
  private captionTimer(): void { return dialogBody.captionTimer.call(this as unknown as GameState); }
  frame(rawInput: PlayInput): void { return frameBody.frame.call(this as unknown as GameState, rawInput); }
  private answerMenuCursor(open: boolean): void { return frameBody.answerMenuCursor.call(this as unknown as GameState, open); }
  private syncMouseVars(click: { x: number; y: number }): void { return frameBody.syncMouseVars.call(this as unknown as GameState, click); }
  private jackRefuses(clickX: number): void { return dialogBody.jackRefuses.call(this as unknown as GameState, clickX); }
  private refusalFrame(): void { return dialogBody.refusalFrame.call(this as unknown as GameState); }
  advance(dtMs: number): void { return filmBody.advance.call(this as unknown as GameState, dtMs); }
  private stepFilm(dtMs: number): void { return filmBody.stepFilm.call(this as unknown as GameState, dtMs); }
  private beginMovieFade(): { total: number; left: number; volume: number } | null { return filmBody.beginMovieFade.call(this as unknown as GameState); }
  private advanceMovieFade(dtMs: number): void { return filmBody.advanceMovieFade.call(this as unknown as GameState, dtMs); }
  private stepMovie(dtMs: number): void { return filmBody.stepMovie.call(this as unknown as GameState, dtMs); }
  keyDown(key: string, repeat = false): boolean { return keysBody.keyDown.call(this as unknown as GameState, key, repeat); }
  wheel(deltaY: number, deltaMode = 0): boolean { return keysBody.wheel.call(this as unknown as GameState, deltaY, deltaMode); }
  keyUp(key: string): void { return keysBody.keyUp.call(this as unknown as GameState, key); }
  private keyFrame(): boolean { return keysBody.keyFrame.call(this as unknown as GameState); }
  setDebugVerb(verb: number): boolean { return keysBody.setDebugVerb.call(this as unknown as GameState, verb); }
  openMenu(screen: "main" | "quit" = "main"): boolean { return menuBody.openMenu.call(this as unknown as GameState, screen); }
  private leaveMenu(): void { return menuBody.leaveMenu.call(this as unknown as GameState); }
  newGame(): void { return menuBody.newGame.call(this as unknown as GameState); }
  private quickSave(notice: boolean): void { return saveBody.quickSave.call(this as unknown as GameState, notice); }
  private quickLoad(): void { return saveBody.quickLoad.call(this as unknown as GameState); }
  private fileWindow(kind: "save" | "load", fromMenu: boolean): boolean { return saveBody.fileWindow.call(this as unknown as GameState, kind, fromMenu); }
  openLoadWindow(): boolean { return saveBody.openLoadWindow.call(this as unknown as GameState); }
  applyLoaded(l: LoadedState): void { return saveBody.applyLoaded.call(this as unknown as GameState, l); }
  private inv(): Inventory { return inventoryBody.inv.call(this as unknown as GameState); }
  private edges(input: PlayInput): { right: boolean; middle: boolean } { return inventoryBody.edges.call(this as unknown as GameState, input); }
  private resetMenuVar(): void { return sceneBody.resetMenuVar.call(this as unknown as GameState); }
  private startNoControl(name: string): void { return sceneBody.startNoControl.call(this as unknown as GameState, name); }
  private openCoat(): boolean { return inventoryBody.openCoat.call(this as unknown as GameState); }
  private barFrame(input: PlayInput): boolean { return inventoryBody.barFrame.call(this as unknown as GameState, input); }
  private barOverlays(sc: ScenePlayer): Overlay[] { return viewBody.barOverlays.call(this as unknown as GameState, sc); }
  private ctrlPoint(point: number): void { return inventoryBody.ctrlPoint.call(this as unknown as GameState, point); }
  view(): PlayView | null { return viewBody.view.call(this as unknown as GameState); }
}
