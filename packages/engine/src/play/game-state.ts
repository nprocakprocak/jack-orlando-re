// Fields the playable game's methods read. The class keeps them private; a wrapper casts `this`.

import { Cursor, CursorEnable } from "../cursor";
import { DialogController, ReleaseGate, type DialogTables, type Side } from "../dialog";
import type { Image16 } from "../formats/bm";
import type { Font } from "../formats/fnt";
import type { Ics } from "../formats/global";
import { Pak } from "../formats/pak";
import type { MoviePlayer } from "../video";
import { PlayAudio } from "./audio";
import { FilmRun } from "./film";
import type { Remap } from "./facewin";
import type { Overlay } from "./overlay";
import { AreaState, type HitRect, type ClickOutcome } from "../areas";
import { type Surface16, SceneTransition } from "../render";
import { GuiMenu, type MenuAssets } from "../gui";
import { BulletMenu, VerbMenu } from "../bulletmenu";
import { CoatScreen, Inventory } from "../inventory";
import { WheelAccumulator } from "../inventory/wheel";
import { TopBar } from "../inventory/topbar";
import { MiniMapScreen } from "../minimap";
import type { GameConfig } from "../settings/config";
import { NoticeStrip } from "../keys/notice";
import { SlotWindow, type JackPose as SavedPose, type LoadedState } from "../save";
import { ScenePlayer, type SceneEvent } from "../scene";
import { Interpreter, Variables } from "../script";
import type { EdgeState } from "./edgescroll";
import { AutoIncClock, SceneHost } from "./host";
import type { GameFiles, LogLine, Phase, PlayInput, PlayOptions, PlayView } from "./types";

/** What the game needs to draw the dialog layer: the caption font and the dialog tables. */
export interface DialogAssets {
  font: Font;
  tables: DialogTables;
  /** colour tables: the face window darkens the scene behind it with them */
  remap: Remap;
}

/** A RUNFILMP film in its window (phase "film"): the scene stands, `clockMs` is the film's own time. */
export interface RunningFilm {
  run: FilmRun;
  name: string;
  clockMs: number;
  /** a film of GLOBAL.FCM (RUNGLOBALFILMP): frames and sounds come from Global.pak */
  global: boolean;
}

/** A film being played (phase "movie"): `clock` counts 5 ms ticks of real time (Media_Step). */
export interface RunningMovie {
  player: MoviePlayer;
  film: string;
  clockMs: number;
  surface: Surface16;
}

/** One of Jack's three refusals from the catalog: caption, voice file, and caption width. */
export interface JackRefusal {
  text: string;
  voice: string;
  width: number;
}

/** The playable game, including the fields the class keeps private. A wrapper casts `this`. */
export interface GameState {
  readonly vars: Variables;
  readonly cursor: Cursor;
  readonly areas: AreaState;
  readonly log: LogLine[];
  verbMode: number;
  scene: ScenePlayer | null;
  interpreter: Interpreter | null;
  host: SceneHost | null;
  phase: Phase;
  transition: SceneTransition | null;
  sceneName: string;
  pendingScene: string | null;
  fadeRequested: boolean;
  ticks: number;
  clickX: number;
  lastClick: { x: number; y: number; outcome: ClickOutcome["kind"] | "ignored"; macro?: string | null } | null;
  readonly history: string[];
  error: string | null;
  readonly audio: PlayAudio;
  dialog: DialogController | null;
  pendingMovie: { film: string; scene: string } | null;
  moviePause: { total: number; left: number; volume: number } | null;
  movie: RunningMovie | null;
  pendingFilm: { film: string; x: number; y: number; mode: number; global: boolean } | null;
  film: RunningFilm | null;
  defaultMusic: boolean;
  endSurface: Surface16 | null;
  dialogAssets: DialogAssets | null;
  jackUniform: boolean;
  talkArmed: boolean;
  skipLine: boolean;
  captionTicks: number;
  captionSeen: object | null;
  captionScroll: number;
  captionHidden: boolean;
  exit: "finished" | "quit" | "death" | null;
  readonly inventory: Inventory;
  readonly notice: NoticeStrip;
  noticeFont: Font | null;
  slotUi: { win: SlotWindow; kind: "save" | "load"; scene: Surface16; screen: Surface16; down: boolean; fromMenu: boolean } | null;
  modal: boolean;
  ioPromise: Promise<void> | null;
  jackSaved: SavedPose;
  jackPlaced: boolean;
  hardNoSave: boolean;
  readonly autoInc: AutoIncClock;
  autosavePending: boolean;
  coat: CoatScreen | null;
  miniMap: MiniMapScreen | null;
  miniScreen: Surface16 | null;
  mKeyHeld: boolean;
  bar: TopBar | null;
  frameImage: Surface16 | null;
  prevCursorRect: HitRect | null;
  barCursorCountdown: number;
  readonly bullet: BulletMenu;
  verbWindow: VerbMenu | null;
  coatRequest: boolean;
  jackIsMenu: boolean;
  refusals: JackRefusal[] | null;
  refusalCounter: number;
  refusal: { side: Side } | null;
  readonly settings: GameConfig;
  menu: GuiMenu | null;
  optionsRequest: boolean;
  readonly defaults: ReadonlyMap<string, number>;
  menuAssets: MenuAssets | null;
  bulletImages: Map<string, Image16>;
  coatScreen: Surface16 | null;
  coatWait: boolean;
  coatLeftDown: boolean;
  coatCursorCountdown: number;
  verbScene: Surface16 | null;
  verbScreen: Surface16 | null;
  verbLeftDown: boolean;
  escPressed: boolean;
  waitRelease: boolean;
  prevRight: boolean;
  prevMiddle: boolean;
  menuScene: Surface16 | null;
  menuScreen: Surface16 | null;
  menuInput: { down: boolean; escape: boolean; };
  menuCursorCountdown: number;
  readonly keysPressed: Set<number>;
  wasTalking: boolean;
  musicClock: number;
  readonly textCache: Map<string, Image16>;
  readonly faceWindows: Record<Side, { key: string; window: Surface16 } | null>;
  readonly faceImages: Map<string, Image16>;
  armed: boolean;
  menuCursorSaved: number | null;
  menuGate: ReleaseGate;
  edge: EdgeState;
  readonly drawEnabled: CursorEnable;
  scrolling: boolean;
  cursorCountdown: number;
  overReaction: boolean;
  overObject: boolean;
  loadPromise: Promise<void> | null;
  readonly logged: Set<string>;
  lastInput: PlayInput;
  idleMouse: { x: number; y: number } | null;
  readonly files: GameFiles;
  readonly resource: Pak;
  readonly global: Pak;
  readonly globalIcs: Ics;
  readonly cursorImages: Map<string, Image16>;
  readonly opts: PlayOptions;
  settle(): Promise<void>;
  enter(name: string, restorePose?: SavedPose): Promise<void>;
  scenePhk: WeakMap<ScenePlayer, Pak>;
  addLog(text: string): void;
  update(): void;
  release(ev: SceneEvent): void;
  captionTimer(): void;
  frame(rawInput: PlayInput): void;
  answerMenuCursor(open: boolean): void;
  syncMouseVars(click: { x: number; y: number }): void;
  jackRefuses(clickX: number): void;
  refusalFrame(): void;
  advance(dtMs: number): void;
  stepFilm(dtMs: number): void;
  beginMovieFade(): { total: number; left: number; volume: number } | null;
  advanceMovieFade(dtMs: number): void;
  stepMovie(dtMs: number): void;
  keyDown(key: string, repeat?: boolean): boolean;
  readonly wheelSum: WheelAccumulator;
  wheel(deltaY: number, deltaMode?: number): boolean;
  keyUp(key: string): void;
  takeFlag: boolean;
  keyFrame(): boolean;
  setDebugVerb(verb: number): boolean;
  readonly menuOpen: boolean;
  openMenu(screen?: "main" | "quit"): boolean;
  leaveMenu(): void;
  readonly showBullet: boolean;
  newGame(): void;
  readonly sceneSaveable: boolean;
  quickSave(notice: boolean): void;
  quickLoad(): void;
  fileWindow(kind: "save" | "load", fromMenu: boolean): boolean;
  openLoadWindow(): boolean;
  applyLoaded(l: LoadedState): void;
  inv(): Inventory;
  readonly uniform: boolean;
  edges(input: PlayInput): { right: boolean; middle: boolean };
  resetMenuVar(): void;
  startNoControl(name: string): void;
  openCoat(): boolean;
  barFrame(input: PlayInput): boolean;
  barOverlays(sc: ScenePlayer): Overlay[];
  ctrlPoint(point: number): void;
  view(): PlayView | null;
}
