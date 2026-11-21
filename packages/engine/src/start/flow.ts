// The flow of the program above the single game: Launcher_Run and WinMain.
// Pure state machine without DOM, sound or files: the host feeds it events and carries out the commands.
// start screen -> logos (every run, skippable) -> [first run: INTRO.AVX -> stripe wipe] -> main menu
// main menu: Introduction -> "Loading" -> INTRO.AVX -> menu
// New game -> "Loading" -> INTRO.AVX -> stripe wipe -> SC001 | Load a game -> "Loading" -> SC001 + load window | Exit -> start screen
// game: "Quit the game" (F4) / OUTRO.AVX -> main menu (the WinMain loop), not the start screen
// The original plays the logos and the intro together only on the first run (g_cfgPlayIntro) and starts "New game"
// without the intro. [engine, not from the original; user decision 2026-11-07]: the logos on every run, the intro by
// itself only on the first run, then after "Introduction" and before every "New game".
import type { MainMenuResult } from "../mainmenu";

export type FlowStage =
  | "start"
  /** "PLEASE WAIT", blackout and the logos */
  | "logos"
  /** INTRO.AVX plays; `introFrom` tells who started it */
  | "intro"
  /** stripe blackout of the last frame of the intro (first run, or "New game" -) */
  | "wipe"
  | "menu"
  /** the menu shows "Loading": the next step (movie / game) is being prepared */
  | "loading"
  /** the intro of "New game" and its blackout ended, the game is still being prepared: the black screen stays */
  | "afterIntro"
  | "quitting"
  | "game";

/** Who started INTRO.AVX: the first run after "Start", "Introduction", or "New game". */
export type IntroFrom = "start" | "menu" | "newGame";

export type FlowEvent =
  /**
   * "Start a new game" on the start screen; `logos`: the studio logos first (every run unless ?logos=0);
   * `intro`: INTRO.AVX before the menu (first run, g_cfgPlayIntro)
   */
  | { type: "begin"; logos: boolean; intro: boolean }
  /** the page was opened with ?scene= / ?start=1: the game runs at once */
  | { type: "direct" }
  | { type: "logosDone" }
  | { type: "wipeDone" }
  | { type: "menuResult"; result: MainMenuResult }
  /** "Loading" has been shown long enough (MainMenu.readyToLeave) */
  | { type: "menuReady" }
  /** the menu finished its closing animation after "Exit" */
  | { type: "menuDone" }
  /** INTRO.AVX opened (ok) or cannot be opened */
  | { type: "introReady"; ok: boolean }
  | { type: "introEnded" }
  /** the game was created (ok) or failed */
  | { type: "gameReady"; ok: boolean }
  /** "Quit the game" confirmed or OUTRO.AVX */
  | { type: "gameExit" }
  /** the host ends the session; the flow returns to the start screen */
  | { type: "stop" };

export type FlowCommand =
  | { type: "showStart" }
  | { type: "playLogos" }
  | { type: "playIntro"; from: IntroFrom }
  /** the first-run intro starts: store g_cfgPlayIntro = 0 (Launcher_Run) */
  | { type: "markIntroShown" }
  /** open INTRO.AVX in the background while "Loading" is shown */
  | { type: "prepareIntro" }
  | { type: "wipe" }
  /** a new MainMenu; `previous` = the screen it blackens first */
  | { type: "openMenu"; previous: "black" | "lastFrame" }
  | { type: "menuReturnFromIntro" }
  /** the game of "New game" or "Load a game" (both start at SC001: `g_loadOnStart` only opens the load window there) */
  | { type: "prepareGame" }
  /** `openLoad`: "Load a game" - the load window opens in the first frame of the scene (`Game_Run`) */
  | { type: "enterGame"; openLoad: boolean };

type Target = "intro" | "newGame" | "load";

export class GameFlow {
  stage: FlowStage = "start";
  introFrom: IntroFrom = "start";
  private target: Target | null = null;
  /** INTRO.AVX should follow the logos */
  private startIntro = false;
  private menuReady = false;
  /** undefined = still preparing */
  private introOk: boolean | undefined;
  private gameOk: boolean | undefined;
  /** "New game": the intro has been played (or skipped because it could not be opened) */
  private introDone = false;

  handle(e: FlowEvent): FlowCommand[] {
    if (e.type === "stop") return this.reset([{ type: "showStart" }], "start");
    switch (e.type) {
      case "begin":
        return this.onBegin(e);
      case "direct":
        return this.reset([], "game");
      case "logosDone":
        if (this.stage !== "logos") return [];
        return this.afterLogos();
      case "wipeDone":
        return this.onWipeDone();
      case "introEnded":
        return this.onIntroEnded();
      case "menuResult":
        return this.menuResult(e.result);
      case "menuReady":
        if (this.stage !== "loading") return [];
        this.menuReady = true;
        return this.settle();
      case "menuDone":
        if (this.stage !== "quitting") return [];
        return this.reset([{ type: "showStart" }], "start");
      case "introReady":
        if (this.target !== "intro" && this.target !== "newGame") return [];
        if (this.introOk !== undefined) return [];
        this.introOk = e.ok;
        return this.settle();
      case "gameReady":
        if (this.target !== "newGame" && this.target !== "load") return [];
        if (this.gameOk !== undefined) return [];
        this.gameOk = e.ok;
        return this.settle();
      case "gameExit":
        if (this.stage !== "game") return [];
        return this.reset([{ type: "openMenu", previous: "lastFrame" }], "menu");
    }
    return [];
  }

  private onBegin(e: { logos: boolean; intro: boolean }): FlowCommand[] {
    if (this.stage !== "start") return [];
    this.startIntro = e.intro;
    if (e.logos) {
      this.stage = "logos";
      return [{ type: "playLogos" }];
    }
    return this.afterLogos();
  }

  private onWipeDone(): FlowCommand[] {
    if (this.stage !== "wipe") return [];
    if (this.introFrom === "newGame" && this.target === "newGame") {
      // the intro of "New game" is blackened; the game follows once it is ready (the black screen stays until then)
      this.stage = "afterIntro";
      return this.settle();
    }
    return this.reset([{ type: "openMenu", previous: "black" }], "menu");
  }

  private onIntroEnded(): FlowCommand[] {
    if (this.stage !== "intro") return [];
    if (this.introFrom === "start") {
      this.stage = "wipe";
      return [{ type: "wipe" }];
    }
    if (this.introFrom === "newGame") {
      // [engine, user request 2026-11-09, ] the same stripe blackout as after "Introduction", whether the film ended or was skipped
      this.introDone = true;
      this.stage = "wipe";
      return [{ type: "wipe" }];
    }
    this.stage = "menu";
    this.target = null;
    return [{ type: "menuReturnFromIntro" }];
  }

  /** After the logos (or without them): the first-run intro, or the menu at once. */
  private afterLogos(): FlowCommand[] {
    if (this.startIntro) {
      this.stage = "intro";
      this.introFrom = "start";
      this.startIntro = false;
      return [{ type: "markIntroShown" }, { type: "playIntro", from: "start" }];
    }
    return this.reset([{ type: "openMenu", previous: "black" }], "menu");
  }

  private reset(cmds: FlowCommand[], stage: FlowStage): FlowCommand[] {
    this.stage = stage;
    this.target = null;
    this.startIntro = false;
    this.clearWait();
    return cmds;
  }

  private clearWait(): void {
    this.menuReady = false;
    this.introOk = undefined;
    this.gameOk = undefined;
    this.introDone = false;
  }

  private menuResult(r: MainMenuResult): FlowCommand[] {
    if (this.stage !== "menu") return [];
    this.clearWait();
    if (r === "quit") {
      this.stage = "quitting";
      return [];
    }
    this.stage = "loading";
    if (r === "intro") {
      this.target = "intro";
      return [{ type: "prepareIntro" }];
    }
    if (r === "newGame") {
      // [engine, user decision 2026-11-07] the intro before the new game; the game is prepared while it plays
      this.target = "newGame";
      return [{ type: "prepareIntro" }, { type: "prepareGame" }];
    }
    this.target = "load";
    return [{ type: "prepareGame" }];
  }

  /** The next step once its conditions are met ("Loading" shown long enough, the movie / game ready or failed). */
  private settle(): FlowCommand[] {
    const target = this.target;
    if (!target) return [];
    if (target === "intro") {
      if (!this.menuReady || this.introOk === undefined) return [];
      this.target = null;
      if (!this.introOk) {
        this.stage = "menu";
        return [{ type: "menuReturnFromIntro" }];
      }
      this.stage = "intro";
      this.introFrom = "menu";
      return [{ type: "playIntro", from: "menu" }];
    }
    if (target === "newGame" && !this.introDone) {
      if (!this.menuReady || this.introOk === undefined) return [];
      if (this.introOk) {
        if (this.stage !== "loading") return [];
        this.stage = "intro";
        this.introFrom = "newGame";
        return [{ type: "playIntro", from: "newGame" }];
      }
      // INTRO.AVX cannot be opened: the game follows "Loading" as without the intro
      this.introDone = true;
    }
    if (!this.menuReady || this.gameOk === undefined) return [];
    if (this.stage === "intro" || this.stage === "wipe") return []; // the game is ready, the intro / its blackout still runs
    this.target = null;
    if (!this.gameOk) {
      // the game could not be created: the menu comes back
      this.stage = "menu";
      return [{ type: "openMenu", previous: "lastFrame" }];
    }
    this.stage = "game";
    return [{ type: "enterGame", openLoad: target === "load" }];
  }
}
