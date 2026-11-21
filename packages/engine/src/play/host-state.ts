// Fields the scene host's command groups read. The class keeps them private; a wrapper casts `this`.

import type { AreaState } from "../areas";
import type { DialogController, Speaker } from "../dialog";
import type { ScenePlayer } from "../scene";
import type { Command, CommandContext, CommandResult, Interpreter, LogEntry } from "../script";
import type { PlayAudio } from "./audio";
import type { AutoIncClock } from "./host";

/**
 * The inventory commands of the scripts: the coat, the item in hand, the revolver
 * and the uniform live in the game, not in the scene. Without it (`HostEnv.items` absent) the commands are "unhandled".
 */
export interface ItemPort {
  /** HAVETOOL object (`Inventory_Add`): the object's image into the first free slot of the active region */
  haveTool(object: string): void;
  /** NOHAVETOOL name (`Script_ExecStep` case 0x46): the item in hand with that name, else the first slot with it */
  noHaveTool(name: string): void;
  /** NOHAVE (`Cursor_ResetMode`): the item in hand is gone, the cursor is the pointer again */
  noHave(): void;
  /** TAKE object (case 0x21): the object's image into the hand; false = the object has no image */
  take(object: string): boolean;
  /** MOUSETOTOOL (`Item_PutBackToBar`): what is in the hand goes to the coat */
  mouseToTool(): void;
  /** ITEMPRESENT (`Inventory_Has`): in a slot (the hand does not count) */
  itemPresent(name: string): boolean;
  /** EXTRA 11 (SC105): the slots 66..83 move to 0..65 */
  moveBigRegion(): void;
  /** HAVEGUN / NOHAVEGUN: `Cursor_LoadSet2` + `GUN = 1` / `Cursor_LoadSet1` + `GUN = 0` (mode 3 → 0) */
  setGun(on: boolean): void;
  /** EXTRA 6 / 8: `g_jackUniform` (the version of the coat) */
  setUniform(on: boolean): void;
}

export interface HostEnv {
  scene: ScenePlayer;
  areas: AreaState;
  /** GOTOSCENE: name of the next scene (without extension) */
  gotoScene(name: string): void;
  /** REFRESHSCREEN: the next scene change fades (Scene_RefreshBackground, g_mixingPending) */
  requestFade(): void;
  /** DIALOG when the dialog layer is off: the answer for dialog `id`. `asked` is how often it has been asked. */
  answer(id: number, asked: number): number;
  /** x of the last click in scene coordinates (IFMOUSEXM / IFMOUSEXW) */
  clickX(): number;
  log(entry: LogEntry): void;
  /** The dialog layer. When set, TALK / DIALOG / SHOWFACE run on it. When absent, a talk line waits a fixed number of ticks and DIALOG uses `answer`. */
  dialog?: DialogController;
  /** Sound, music and speech ; without it effects and music commands are skipped. */
  audio?: PlayAudio;
  /** RUNAVX film scene: the game plays the film at the end of the frame (Game_Run, 4852) and loads `scene` */
  runMovie?(film: string, scene: string): void;
  /**
   * RUNFILMP film x y mode: `Film_Play` plays the `.FCM` film of the scene in a window and returns when it has
   * ended; the game does nothing else meanwhile (the scene stands, the scripts wait). The game plays it after this frame's commands.
   */
  runFilm?(film: string, x: number, y: number, mode: number, global?: boolean): void;
  /** The inventory commands: the coat, the hand, the revolver */
  items?: ItemPort;
  /** The AUTOINCRANGE clock (owned by the game: it outlives the scene); without it the command only sets the variable. */
  autoInc?: AutoIncClock;
}

/** The scene host, including the fields the class keeps private. A wrapper casts `this`. */
export interface HostState {
  interpreter: Interpreter;
  walkAllowed: boolean;
  readonly skipped: Map<string, number>;
  saveable: boolean;
  viewScrolling: boolean;
  readonly scrollPoints: { L: { x: number; y: number }; R: { x: number; y: number } };
  pointRotate: number;
  readonly animaMacros: { macro: string; anim: string; rec: number; image: number }[];
  talkWaiter: number | null;
  posXY: { x: number; y: number };
  readonly slots: Map<string, number>;
  timers: { ticks: number; macro: number }[];
  readonly dialogsAsked: Map<number, number>;
  readonly env: HostEnv;
  readonly talkTicks: number;
  random(): number;
  setJackVars(ctx: CommandContext): void;
  wait(key: string, ctx: CommandContext): "async";
  waitAlways(key: string, ctx: CommandContext): "async";
  fallbackTalk(cmd: Command, ctx: CommandContext): CommandResult;
  speaker(cmd: Command): Speaker | null;
  noteSkipped(cmd: Command): void;
}
