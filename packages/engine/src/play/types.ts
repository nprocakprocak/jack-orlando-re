// Types the host shares with the playable game. `film.ts` and `files.ts` read `GameFiles` from here.
import type { AudioBackend } from "../audio/types";
import type { CursorDraw, LensMasks } from "../cursor";
import type { Image16 } from "../formats/bm";
import type { Surface16 } from "../render";
import type { SaveManager } from "../save";
import type { GameConfig } from "../settings/config";
import type { MovieSoundSink } from "../video";
import type { PlayConfig } from "./audio";
import type { Overlay } from "./overlay";

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
