// In-game menu (F4): main menu, "Opcje gry", "Opcje audio", "O grze", quit confirmation.
// Window builders and a controller that turns mouse/keyboard events into actions for the game.
import type { Font } from "../formats/fnt";
import { textWidth } from "../formats/fnt";
import type { CreditLine } from "../formats/text";
import type { Surface16 } from "../render/surface";
import { blitKeyed } from "../render/surface";
import { encodeMazovia } from "../dialog/caption";
import type { GameConfig } from "../settings/config";
import { VOLUME_MAX, WALK_SPEED_MAX } from "../settings/config";
import { CreditsScroller, TICK_MS } from "./credits";
import { COLOR_BLUE, COLOR_OUTLINE_BLACK, COLOR_WHITE, COLOR_YELLOW, centerOffset } from "./draw";
import type { GuiTexts } from "./texts";
import type { GuiEvent, WindowAssets } from "./window";
import { GuiWindow, SCREEN_H, SCREEN_W } from "./window";

export interface MenuAssets extends WindowAssets {
  /** JACBM.BM 396 x 98 */
  logo: Surface16;
  /** COPBM.BM 340 x 27 */
  copyright: Surface16;
  /** TEKST.COD, parsed */
  credits: readonly CreditLine[];
}

export type MenuScreen = "main" | "gameOptions" | "audioOptions" | "about" | "quit";

/** What the menu asks the game to do. */
export type MenuAction =
  | { type: "resume" }
  | { type: "newGame" }
  /** the slot window is /; the menu stays open until the game calls `close()` (a loaded game closes it) */
  | { type: "load" }
  | { type: "save" }
  /** confirmed with "Tak": the original ends the process (Sys_FatalExit "OK. Bye!") */
  | { type: "quit" }
  /** an option changed (already written into the config object) */
  | { type: "setting"; key: keyof GameConfig; value: number }
  /** a volume slider moved: play the preview sample (SFX.S16 / TALK.S16) or set the music level live */
  | { type: "preview"; channel: "music" | "sfx" | "talk"; value: number }
  /** an options window was left: the original writes the config here */
  | { type: "settingsSaved" };

/** Control name -> config field, for the two option windows. */
export const OPTION_FIELDS: Readonly<Record<string, keyof GameConfig>> = {
  WalkSpeed: "walkSpeed",
  TalkOnOff: "talkInterrupt",
  DialogOnOff: "showText",
  BulletOnOff: "showBullet",
  MusicVol: "musicVol",
  SFXVol: "sfxVol",
  TalkVol: "talkVol",
  RevStereoOnOff: "reverseStereo",
  SurroundOnOff: "surround",
  MusDownOnOff: "musicDown",
};

const PREVIEW: Readonly<Record<string, "music" | "sfx" | "talk">> = { MusicVol: "music", SFXVol: "sfx", TalkVol: "talk" };

/**
 * Music level change from the audio window: below 5 the music stops and counts as muted,
 * above 5 while muted it is restarted (5 itself does nothing).
 */
export function musicVolumeEffect(value: number, playing: boolean, muted: boolean): "stop" | "resume" | null {
  if (value < 5 && playing) return "stop";
  if (value > 5 && muted) return "resume";
  return null;
}

type Ctx = { assets: MenuAssets; texts: GuiTexts; config: GameConfig; scene: Surface16 };

const LABEL = [COLOR_BLUE, COLOR_WHITE] as const;

function title(w: GuiWindow, text: string, y: number): void {
  w.addLabel(text, true, 0, y, COLOR_OUTLINE_BLACK, COLOR_YELLOW);
}

function label(w: GuiWindow, text: string, y: number): void {
  w.addLabel(text, false, 15, y, ...LABEL);
}

/** Menu_InGameOptions: 440 x 380, 8 buttons of 370 x 33 (Resume is button 1, so Enter resumes). */
export function buildMainMenu({ assets, texts, scene }: Ctx): GuiWindow {
  const w = new GuiWindow(assets, scene, 0, 0, 440, 380, true);
  title(w, texts.title, 14);
  const x = centerOffset(440, 370) - 1;
  const items: [string, string, number][] = [
    ["Resume", texts.resume, 325], ["NewGame", texts.newGame, 55], ["Load", texts.load, 92], ["Save", texts.save, 129],
    ["GameCtrl", texts.gameCtrl, 166], ["AudioCtrl", texts.audioCtrl, 203], ["About", texts.about, 240], ["Quit", texts.quit, 277],
  ];
  for (const [name, text, y] of items) w.addButton(name, text, x, y, 370, 33);
  return w;
}

/** Menu_GameOptions: 500 x 306. */
export function buildGameOptions({ assets, texts, config, scene }: Ctx): GuiWindow {
  const w = new GuiWindow(assets, scene, 0, 0, 500, 306, true);
  title(w, texts.gameOptionsTitle, 16);
  label(w, texts.walkSpeed, 68);
  label(w, texts.talkInterruption, 112);
  label(w, texts.showText, 156);
  label(w, texts.showBullet, 200);
  w.addSlider("WalkSpeed", 253, 75, WALK_SPEED_MAX, config.walkSpeed);
  w.addToggle("TalkOnOff", 253, 110, config.talkInterrupt, texts.no, texts.yes);
  w.addToggle("DialogOnOff", 253, 154, config.showText, texts.no, texts.yes);
  w.addToggle("BulletOnOff", 253, 198, config.showBullet, texts.no, texts.yes);
  w.addButton("MainMenu", texts.mainMenu, centerOffset(w.w, 160), 252, 160, 32);
  return w;
}

/** Menu_AudioOptions: 520 x 380. */
export function buildAudioOptions({ assets, texts, config, scene }: Ctx): GuiWindow {
  const w = new GuiWindow(assets, scene, 0, 0, 520, 380, true);
  title(w, texts.audioOptionsTitle, 16);
  label(w, texts.musicVolume, 68);
  label(w, texts.sfxVolume, 112);
  label(w, texts.talkVolume, 156);
  label(w, texts.reverseStereo, 200);
  label(w, texts.surround, 244);
  label(w, texts.musicDown, 288);
  w.addSlider("MusicVol", 273, 75, VOLUME_MAX, config.musicVol);
  w.addSlider("SFXVol", 273, 119, VOLUME_MAX, config.sfxVol);
  w.addSlider("TalkVol", 273, 163, VOLUME_MAX, config.talkVol);
  w.addToggle("RevStereoOnOff", 370, 198, config.reverseStereo, texts.no, texts.yes);
  w.addToggle("SurroundOnOff", 370, 242, config.surround, texts.no, texts.yes);
  w.addToggle("MusDownOnOff", 370, 288, config.musicDown, texts.no, texts.yes);
  w.addButton("MainMenu", texts.mainMenu, centerOffset(w.w, 160), 330, 160, 32);
  return w;
}

/** Gui_ShowAbout: 460 x 340, logo, copyright line, "Ok"; the credits are drawn over it (scroller at (30, 124)). */
export function buildAbout({ assets, texts, scene }: Ctx): GuiWindow {
  const w = new GuiWindow(assets, scene, 0, 0, 460, 340, true);
  w.addImage(assets.logo, 32, 16);
  w.addImage(assets.copyright, 86, 94);
  w.addButton("AboutOk", texts.ok, centerOffset(w.w, 100), 290, 100, 32);
  return w;
}

export const ABOUT_SCROLL_X = 30;
export const ABOUT_SCROLL_Y = 124;

/** Gui_MessageBox as used by Menu_ConfirmQuit: "Tak" (BtOk) left, "Nie" (BtCl) right. */
export function buildConfirm({ assets, texts, scene }: Ctx): GuiWindow {
  const font: Font = assets.fontBig;
  const lines = texts.confirmQuit.split("|");
  const widthOf = (t: string) => textWidth(font, encodeMazovia(t));
  const even = (n: number) => n + (n % 2);
  const bw = even(Math.max(widthOf(texts.confirmYes), widthOf(texts.confirmNo)) + 20);
  let W = Math.max(...lines.map(widthOf)) + 40;
  W = even(Math.max(W, 40 + 30 + 2 * bw));
  const H = 0x56 + 22 * lines.length;
  const w = new GuiWindow(assets, scene, Math.trunc((SCREEN_W - W) / 2), Math.trunc((SCREEN_H - H) / 2), W, H, false);
  lines.forEach((l, i) => w.addLabel(l, true, 0, 13 + 22 * i, COLOR_BLUE, COLOR_WHITE));
  const y = H - 13 - 32;
  const half = Math.trunc((W - 2) / 2);
  w.addButton("BtOk", texts.confirmYes, half - 14 - bw, y, bw, 32);
  w.addButton("BtCl", texts.confirmNo, half + 15, y, bw, 32);
  return w;
}

interface Entry {
  screen: MenuScreen;
  win: GuiWindow;
}

export interface MenuOptions extends Ctx {
  onAction(a: MenuAction): void;
  /** called when an options window is left (the original saves the config then) */
  persist?(config: GameConfig): void;
}

/**
 * Window stack and input routing. Only the top window takes input. Every window's snapshot is the bare scene
 * (Gui_CreateWindow composes layers below 1000), so a window above another one covers it only where
 * it overlaps: the taller main menu peeks out above and below "O grze". Coordinates are screen pixels (640 x 480).
 */
export class GuiMenu {
  private readonly stack: Entry[] = [];
  private scroller: CreditsScroller | null = null;
  private tickCarry = 0;

  constructor(private readonly o: MenuOptions) {}

  get isOpen(): boolean {
    return this.stack.length > 0;
  }

  get screen(): MenuScreen | null {
    return this.stack.length ? this.stack[this.stack.length - 1].screen : null;
  }

  /** Replaces the frozen scene view used by windows opened from now on. */
  setScene(scene: Surface16): void {
    this.o.scene = scene;
  }

  /** F4 opens "main", F10 opens "quit" directly (answering "Nie" then returns to the game). */
  open(screen: "main" | "quit" = "main"): void {
    this.stack.length = 0;
    this.push(screen);
  }

  /** Closes everything without an action (the game loaded a save). */
  close(): void {
    this.stack.length = 0;
    this.scroller = null;
  }

  private push(screen: MenuScreen): void {
    const build = { main: buildMainMenu, gameOptions: buildGameOptions, audioOptions: buildAudioOptions, about: buildAbout, quit: buildConfirm }[screen];
    this.stack.push({ screen, win: build(this.o) });
    if (screen === "about") {
      this.scroller = new CreditsScroller(this.o.assets.credits, { big: this.o.assets.fontBig, small: this.o.assets.fontSmall });
      this.scroller.running = true;
      this.tickCarry = 0;
    }
  }

  private pop(): void {
    const e = this.stack.pop();
    if (e?.screen === "about") this.scroller = null;
    if (e && (e.screen === "gameOptions" || e.screen === "audioOptions")) {
      this.o.persist?.(this.o.config);
      this.o.onAction({ type: "settingsSaved" });
    }
  }

  private top(): Entry | null {
    return this.stack.length ? this.stack[this.stack.length - 1] : null;
  }

  private finish(action: MenuAction): void {
    this.close();
    this.o.onAction(action);
  }

  pointerDown(x: number, y: number): void {
    this.handle(this.top()?.win.pointerDown(x, y));
  }

  pointerMove(x: number, y: number): void {
    this.handle(this.top()?.win.pointerMove(x, y));
  }

  pointerUp(x: number, y: number): void {
    this.handle(this.top()?.win.pointerUp(x, y));
  }

  /** `key`: KeyboardEvent.key ("Enter", "Escape"). */
  keyDown(key: string): void {
    this.handle(this.top()?.win.keyDown(key));
  }

  keyUp(key: string): void {
    this.handle(this.top()?.win.keyUp(key));
  }

  /** Advances the "O grze" scroller by real time (5 ms ticks). */
  tick(ms: number): void {
    if (!this.scroller) return;
    this.tickCarry += ms;
    while (this.tickCarry >= TICK_MS) {
      this.tickCarry -= TICK_MS;
      this.scroller.tick();
    }
  }

  private handle(events: GuiEvent[] | undefined): void {
    for (const e of events ?? []) {
      const entry = this.top();
      if (!entry) return;
      switch (entry.screen) {
        case "main":
          this.mainEvent(e);
          break;
        case "gameOptions":
        case "audioOptions":
          this.optionsEvent(entry, e);
          break;
        case "about":
          if (e.kind === "escape") this.finish({ type: "resume" }); // Esc leaves the whole menu
          else if (e.kind === "press") this.pop();
          break;
        case "quit":
          this.quitEvent(e);
          break;
      }
    }
  }

  private mainEvent(e: GuiEvent): void {
    if (e.kind === "escape") return this.finish({ type: "resume" });
    if (e.kind !== "press") return;
    switch (e.name) {
      case "Resume": return this.finish({ type: "resume" });
      case "NewGame": return this.finish({ type: "newGame" });
      case "Load": return this.o.onAction({ type: "load" });
      case "Save": return this.o.onAction({ type: "save" });
      case "GameCtrl": return this.push("gameOptions");
      case "AudioCtrl": return this.push("audioOptions");
      case "About": return this.push("about");
      case "Quit": return this.push("quit");
    }
  }

  private optionsEvent(entry: Entry, e: GuiEvent): void {
    if (e.kind === "escape" || (e.kind === "press" && e.name === "MainMenu")) return this.pop();
    const name = e.name;
    const key = OPTION_FIELDS[name];
    if (!key) return;
    const value = e.kind === "slide" ? e.value : entry.win.getValue(name);
    if (e.kind === "slide" && e.final) return; // the value was already applied by the live events
    this.o.config[key] = value;
    this.o.onAction({ type: "setting", key, value });
    if (e.kind === "slide" && PREVIEW[name]) this.o.onAction({ type: "preview", channel: PREVIEW[name], value });
  }

  private quitEvent(e: GuiEvent): void {
    if (e.kind === "press" && e.name === "BtOk") return this.finish({ type: "quit" });
    // "Nie" and Esc (Esc = "/0" returns 0 from Gui_MessageBox): back to the main menu, or to the game after F10
    if (e.kind === "escape" || (e.kind === "press" && e.name === "BtCl")) {
      if (this.stack.length > 1) this.pop();
      else this.finish({ type: "resume" });
    }
  }

  /** Draws the open windows (and the credits over "O grze") on `screen`. */
  draw(screen: Surface16): void {
    for (const { win, screen: kind } of this.stack) {
      win.draw(screen);
      if (kind === "about" && this.scroller) {
        const v = this.scroller.view();
        blitKeyed(v, 0, 0, v.width, v.height, screen, win.x + ABOUT_SCROLL_X, win.y + ABOUT_SCROLL_Y);
      }
    }
  }
}
