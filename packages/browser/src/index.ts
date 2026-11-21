// Browser play session. The engine has no DOM: this module feeds it files, time, the mouse and the
// keyboard, and draws what it returns. The page supplies the files and the status line.
import {
  gameVolumeToLevel,
  Mixer,
  MUSIC_CHANNEL,
  MusicPlayer,
  WebAudioBackend,
} from "jack-orlando-re/audio";
import {
  attachDisplay,
  clientToScreen,
  EngineLoop,
  runLoop,
  type FrameInfo,
} from "jack-orlando-re/core";
import { drawCursor } from "jack-orlando-re/cursor";
import { GuiWindow, HAND_TIP, TEXTS_PL } from "jack-orlando-re/gui";
import {
  buildWaitScreen,
  ClickSkip,
  fetchLogos,
  IntroEscape,
  LaunchSequence,
  markIntroShown,
  openIntro,
  readStartupOptions,
  StripeWipe,
  type StartupOptions,
} from "jack-orlando-re/launcher";
import {
  fetchMainMenuAssets,
  MainMenu,
  MENU_MUSIC,
  type MainMenuAssets,
  type MainMenuEvent,
} from "jack-orlando-re/mainmenu";
import {
  bindPause,
  browserStorage,
  readPauseOnBlur,
  type PauseBinding,
} from "jack-orlando-re/pause";
import {
  drawOverlays,
  PlayGame,
  type GameFiles,
  type PlayInput,
} from "jack-orlando-re/play";
import {
  blitCopy,
  createSurface,
  presentRgba,
  SCREEN_H,
  SCREEN_W,
  windowToRgba,
  type Surface16,
} from "jack-orlando-re/render";
import {
  BrowserFilePicker,
  IDB_SLOTS,
  IdbStore,
  SaveManager,
  windowPickerEnv,
} from "jack-orlando-re/save";
import { ConfigStore, type GameConfig } from "jack-orlando-re/settings";
import {
  Disposables,
  GameFlow,
  loadStartAssets,
  MenuMusic,
  StartScreen,
  StartStore,
  type FlowCommand,
  type FlowEvent,
  type IntroFrom,
  type StartAction,
  type StartAssets,
} from "jack-orlando-re/start";
import { WebAudioMovieSink, type MoviePlayer } from "jack-orlando-re/video";

export interface MountOptions {
  canvas: HTMLCanvasElement;
  files: GameFiles;
  onStatus?: (text: string) => void;
  /** Default true. false matches ?mute=1: no WebAudioBackend. */
  audio?: boolean;
  /** Skip the start screen and launch this scene. Replaces ?scene= / ?start=1. */
  direct?: { scene: string };
  /** Logos and intro. When omitted, same result as readStartupOptions("", localStorage). Does not read location.search. */
  startup?: StartupOptions;
  /** Mode overrides. When a field is omitted, use the stored StartStore / pause value, not the URL. */
  saves?: "files" | "slots";
  easy?: boolean;
  inventory?: "coat" | "bar";
  pauseOnBlur?: boolean;
  /** Partial GameConfig overlay. When omitted, ConfigStore.load() alone (no URL). */
  settings?: Partial<GameConfig>;
  vars?: Record<string, number>;
  talkTicks?: number;
  /** Default true. false matches ?dialogs=0. */
  dialogs?: boolean;
  /**
   * "contain" sizes the canvas to the window and keeps the 640×480 aspect.
   * The page background shows in the bars. Omit it for the dev-page fit.
   */
  fit?: "contain";
  /**
   * Main-menu Exit would return to the start screen. When set, that screen is
   * not shown: the host ends the process instead. The closing animation still plays.
   */
  onQuit?: () => void;
}

export interface PlayerHandle {
  /** Removes the loop, closes audio, and drops every listener this mount added. */
  stop(): Promise<void>;
}

/** Fetch game files from `baseUrl`. A text/html body counts as missing, the same way a dev server's fallback page does. */
export function httpGameFiles(baseUrl: string): GameFiles {
  const base = baseUrl.replace(/\/+$/, "");
  const url = (rel: string): string => {
    const path = rel.replace(/\\/g, "/").replace(/^\/+/, "");
    return base === "" ? path : `${base}/${path}`;
  };
  return {
    async read(rel) {
      const res = await fetch(url(rel));
      if (!res.ok || isHtml(res)) throw new Error(`${rel}: HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async exists(rel) {
      const res = await fetch(url(rel), { method: "HEAD" });
      return res.ok && !isHtml(res);
    },
  };
}

function isHtml(res: Response): boolean {
  return (res.headers.get("content-type") ?? "").includes("text/html");
}

/**
 * Starts a play session on `options.canvas` and returns immediately.
 * Missing files and start-screen failures are reported through `onStatus`.
 */
export function mountPlayer(options: MountOptions): PlayerHandle {
  const canvas = options.canvas;
  const files = options.files;
  canvas.width = SCREEN_W;
  canvas.height = SCREEN_H;
  const ctx2d = canvas.getContext("2d");
  if (!ctx2d) throw new Error("canvas 2d context is unavailable");
  const ctx: CanvasRenderingContext2D = ctx2d;
  let detachDisplay = attachDisplay(canvas, options.fit === "contain" ? { fit: "contain" } : {});
  canvas.style.cursor = "none";
  const image = ctx.createImageData(SCREEN_W, SCREEN_H);

  let backend: WebAudioBackend | null = null;
  let game: PlayGame | null = null;
  let startingGen = -1;
  const session = new Disposables();
  let generation = 0;
  GuiWindow.tipShift = HAND_TIP;
  let startScreen: StartScreen | null = null;
  let startAssets: StartAssets | null = null;
  let pause: PauseBinding | null = null;
  let launchFx: LaunchSequence | null = null;
  const flow = new GameFlow();
  let menu: MainMenu | null = null;
  let menuAssets: MainMenuAssets | null = null;
  let menuMusic: MenuMusic | null = null;
  let menuMixer: Mixer | null = null;
  let intro: { player: MoviePlayer; clockMs: number; esc: IntroEscape } | null = null;
  let preparedIntro: MoviePlayer | null = null;
  let introFrame: Surface16 | null = null;
  let wipeFx: { wipe: StripeWipe; surface: Surface16 } | null = null;
  let lastScreen: Surface16 | undefined;
  let preparedGame: PlayGame | null = null;
  let openLoadPending = false;
  const startStore = new StartStore();
  const configStore = new ConfigStore();
  const filmClick = new ClickSkip();
  const introClick = new ClickSkip();
  let leftCtrl = false;
  const input: PlayInput = { x: 320, y: 240, pressed: false, down: false, inWindow: false, escape: false };
  let stopped = false;
  let stopping: Promise<void> | null = null;
  const offs: Array<() => void> = [];

  function listen(
    target: EventTarget,
    type: string,
    handler: (ev: Event) => void,
    options?: boolean | AddEventListenerOptions,
  ): void {
    target.addEventListener(type, handler, options);
    offs.push(() => target.removeEventListener(type, handler, options));
  }

  function setInfo(text: string): void {
    options.onStatus?.(text);
  }

  function startupNow(): StartupOptions {
    return options.startup ?? readStartupOptions("", browserStorage());
  }

  function loadSettings(): GameConfig {
    const s = configStore.load();
    const patch = options.settings;
    if (!patch) return s;
    const defined: Record<string, number> = {};
    for (const key of Object.keys(patch) as (keyof GameConfig)[]) {
      const value = patch[key];
      if (value !== undefined) defined[key] = value;
    }
    return Object.assign(s, defined);
  }

  function saveMode(): "files" | "slots" {
    return options.saves ?? startStore.loadModes().saves;
  }

  function easyMode(): boolean {
    return options.easy ?? startStore.loadModes().easy;
  }

  function inventoryMode(): "coat" | "bar" {
    return options.inventory ?? startStore.loadModes().inventory;
  }

  function makeSave(): SaveManager {
    return new SaveManager({
      store: new IdbStore(),
      slots: new IdbStore(IDB_SLOTS),
      picker: new BrowserFilePicker(windowPickerEnv()),
      light: easyMode(),
    });
  }

  const loop: EngineLoop = new EngineLoop({
    update() {
      game?.update();
    },
    frame() {
      if (!game) return;
      const heldEsc = input.escape;
      if (filmClick.take(game.phase === "movie")) input.escape = true;
      game.frame(input);
      input.escape = heldEsc;
      input.pressed = false;
      input.rightPressed = false;
      input.middlePressed = false;
    },
    render(_alpha: number, info: FrameInfo) {
      if (launchFx) {
        launchFx.advance(info.elapsedMs);
        windowToRgba(launchFx.surface, 0, 0, SCREEN_W, SCREEN_H, image.data);
        ctx.putImageData(image, 0, 0);
        if (launchFx.done) {
          launchFx = null;
          apply(flow.handle({ type: "logosDone" }));
        }
        return;
      }
      if (intro) return renderIntro(info.elapsedMs);
      if (flow.stage === "afterIntro") return;
      if (wipeFx) return renderWipe(info.elapsedMs);
      if (menu) return renderMenu(info.elapsedMs);
      game?.advance(info.elapsedMs);
      if (!game) return;
      if (openLoadPending && game.phase === "playing" && game.openLoadWindow()) openLoadPending = false;
      const view = game.view();
      if (!view) return;
      presentRgba(view.surface, view.scrollX, 0, image.data);
      drawOverlays(image.data, view.overlays);
      if (view.cursor && view.cursorImage && input.inWindow) {
        drawCursor(image.data, view.cursorImage, view.cursor, view.scrollX, 0, 640, 480, view.lensMasks);
      }
      ctx.putImageData(image, 0, 0);
    },
  });

  function screenPos(e: PointerEvent): [number, number] {
    const p = clientToScreen(e.clientX, e.clientY, canvas.getBoundingClientRect(), SCREEN_W, SCREEN_H);
    return [Math.max(0, Math.min(SCREEN_W - 1, p.x)), Math.max(0, Math.min(SCREEN_H - 1, p.y))];
  }

  function menuInput(): MainMenu | null {
    return menu && !intro && !wipeFx && !launchFx && !game && flow.stage !== "afterIntro" ? menu : null;
  }

  function pointer(e: PointerEvent): void {
    if (stopped) return;
    if (startScreen) {
      onStartActions(startScreen.pointerMove(...screenPos(e)));
      return;
    }
    const m = menuInput();
    if (m) {
      m.pointerMove(...screenPos(e));
      return;
    }
    const p = clientToScreen(e.clientX, e.clientY, canvas.getBoundingClientRect(), SCREEN_W, SCREEN_H);
    input.x = Math.max(0, Math.min(SCREEN_W - 1, p.x));
    input.y = Math.max(0, Math.min(SCREEN_H - 1, p.y));
    input.inWindow = true;
  }

  listen(canvas, "pointermove", (ev) => pointer(ev as PointerEvent));
  listen(canvas, "pointerenter", (ev) => pointer(ev as PointerEvent));
  listen(canvas, "pointerleave", () => {
    input.inWindow = false;
    menuInput()?.pointerLeave();
  });
  listen(canvas, "pointerdown", (ev) => {
    const e = ev as PointerEvent;
    if (e.button !== 0) return;
    if (startScreen) {
      onStartActions(startScreen.pointerDown(...screenPos(e)));
      return;
    }
    if (intro) {
      introClick.press();
      return;
    }
    if (game?.phase === "movie") {
      filmClick.press();
      return;
    }
    if (launchFx) {
      launchFx.skip();
      return;
    }
    const m = menuInput();
    if (m) {
      m.pointerDown(...screenPos(e));
      return;
    }
    if (game?.menuOpen) {
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // without capture the drag stops at the canvas edge
      }
    }
    pointer(e);
    input.ctrl = e.ctrlKey && leftCtrl;
    input.pressed = true;
    input.down = true;
  });
  listen(window, "pointerup", (ev) => {
    const e = ev as PointerEvent;
    if (e.button !== 0) return;
    if (startScreen) onStartActions(startScreen.pointerUp(...screenPos(e)));
    else menuInput()?.pointerUp(...screenPos(e));
    input.down = false;
  });
  listen(window, "pointercancel", () => Object.assign(input, { down: false, right: false, middle: false }));
  listen(canvas, "contextmenu", (e) => e.preventDefault());
  listen(canvas, "mousedown", (ev) => {
    const e = ev as MouseEvent;
    if (startScreen || (e.button !== 1 && e.button !== 2)) return;
    if (e.button === 1) e.preventDefault();
    input.ctrl = e.ctrlKey && leftCtrl;
    if (e.button === 2) Object.assign(input, { right: true, rightPressed: true });
    else Object.assign(input, { middle: true, middlePressed: true });
  });
  listen(window, "mouseup", (ev) => {
    const e = ev as MouseEvent;
    if (e.button === 2) input.right = false;
    else if (e.button === 1) input.middle = false;
  });
  listen(
    canvas,
    "wheel",
    (ev) => {
      const e = ev as WheelEvent;
      if (startScreen || intro || launchFx || game?.phase === "movie") return;
      if (game?.wheel(e.deltaY, e.deltaMode)) e.preventDefault();
    },
    { passive: false },
  );
  listen(canvas, "auxclick", (e) => e.preventDefault());
  listen(window, "keydown", (ev) => {
    const e = ev as KeyboardEvent;
    if (startScreen) {
      if (!e.repeat && !(e.target instanceof HTMLInputElement)) onStartActions(startScreen.keyDown(e.key));
      return;
    }
    if (e.key === "Escape") {
      if (launchFx) launchFx.skip();
      input.escape = true;
    }
    const m = menuInput();
    if (m) {
      if (!e.repeat && !(e.target instanceof HTMLInputElement) && (e.key === "Enter" || e.key === "Escape")) {
        e.preventDefault();
        m.keyDown(e.key);
      }
      return;
    }
    if (e.code === "ControlLeft") input.ctrl = leftCtrl = true;
    if (e.target instanceof HTMLInputElement) return;
    if (game && !launchFx && game.keyDown(e.key, e.repeat)) {
      e.preventDefault();
      return;
    }
  });
  listen(window, "keyup", (ev) => {
    const e = ev as KeyboardEvent;
    if (startScreen) {
      if (!(e.target instanceof HTMLInputElement)) onStartActions(startScreen.keyUp(e.key));
      return;
    }
    if (e.key === "Escape") input.escape = false;
    if (e.code === "ControlLeft") input.ctrl = leftCtrl = false;
    menuInput()?.keyUp(e.key);
    if (!(e.target instanceof HTMLInputElement)) game?.keyUp(e.key);
  });

  async function buildGame(scene: string, gen: number): Promise<PlayGame> {
    const sound = backend;
    return PlayGame.create(files, {
      start: scene,
      talkTicks: options.talkTicks,
      vars: { ...(options.vars ?? {}) },
      dialogs: options.dialogs !== false,
      backend: sound,
      settings: loadSettings(),
      persistSettings: (cfg) => void configStore.save(cfg),
      easy: easyMode(),
      save: makeSave(),
      saveMode: saveMode(),
      inventory: inventoryMode(),
      onExit: () => {
        if (gen === generation) setTimeout(() => gen === generation && leaveGame(), 0);
      },
      movieSink: sound ? () => new WebAudioMovieSink(sound.ctx, sound.output) : undefined,
    });
  }

  function installGame(created: PlayGame): void {
    game?.audio.silence();
    game = created;
    const sound = backend;
    if (sound) {
      created.audio.stereoFx = sound.stereoFx;
      created.audio.applyConfig(created.settings);
    }
    if (pause?.controller.paused) created.audio.mixer.setPaused(true);
  }

  async function start(scene: string): Promise<void> {
    if (startingGen === generation) return;
    startingGen = generation;
    const gen = generation;
    try {
      const created = await buildGame(scene, gen);
      if (stopped || gen !== generation) {
        created.audio.silence();
        return;
      }
      installGame(created);
    } catch (e) {
      if (gen !== generation) return;
      setInfo(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      if (startingGen === gen) startingGen = -1;
    }
  }

  function ensureRuntime(): void {
    if (pause || stopped) return;
    if (options.audio !== false) {
      const b = new WebAudioBackend();
      backend = b;
      void b.unlock().catch(() => undefined);
      if (b.ctx.state !== "running") {
        // Same pointer/key/touch events as WebAudioBackend.unlockOnGesture, held here so stop() can remove them.
        const events = ["pointerdown", "keydown", "touchend"];
        const handler = (): void => {
          void b.unlock().then(() => {
            if (b.ctx.state === "running") {
              for (const type of events) window.removeEventListener(type, handler);
            }
          }, () => undefined);
        };
        for (const type of events) listen(window, type, handler);
      }
      session.add("audio", async () => {
        if (backend === b) backend = null;
        menuMixer = null;
        menuMusic = null;
        if (b.ctx.state !== "closed") await b.ctx.close();
      });
    }
    const binding = bindPause(window, document, loop, {
      pauseOnBlur: options.pauseOnBlur ?? readPauseOnBlur("", browserStorage()),
      onChange: (paused) => {
        game?.audio.mixer.setPaused(paused);
        menuMixer?.setPaused(paused);
      },
    });
    pause = binding;
    const stopLoop = runLoop(loop);
    session.add("loop", () => {
      stopLoop();
      binding.unbind();
      if (pause === binding) pause = null;
    });
    session.add("game", () => {
      game?.audio.silence();
      game = null;
      resetScreens();
    });
  }

  function resetScreens(): void {
    Object.assign(input, {
      pressed: false, down: false, escape: false, right: false, middle: false,
      rightPressed: false, middlePressed: false, ctrl: false,
    });
    launchFx = null;
    menu = null;
    intro?.player.abort();
    intro = null;
    preparedIntro?.abort();
    preparedIntro = null;
    introFrame = null;
    wipeFx = null;
    lastScreen = undefined;
    preparedGame?.audio.silence();
    preparedGame = null;
  }

  function launch(scene: string): void {
    if (stopped) return;
    generation++;
    hideStartScreen();
    ensureRuntime();
    resetScreens();
    apply(flow.handle({ type: "direct" }));
    void start(scene).catch(() => undefined);
  }

  function apply(cmds: FlowCommand[]): void {
    if (stopped) return;
    for (const c of cmds) {
      switch (c.type) {
        case "showStart":
          if (options.onQuit) {
            options.onQuit();
            void stop();
            break;
          }
          void toStartScreen().catch(() => undefined);
          break;
        case "playLogos":
          void playLogos(generation);
          break;
        case "playIntro":
          void playIntro(c.from, generation);
          break;
        case "markIntroShown":
          markIntroShown(browserStorage());
          break;
        case "prepareIntro":
          void prepareIntro(generation);
          break;
        case "wipe":
          beginWipe();
          break;
        case "openMenu":
          void openMenu(c.previous, generation).catch(() => undefined);
          break;
        case "menuReturnFromIntro":
          menu?.returnFromIntro(introFrame ?? undefined);
          break;
        case "prepareGame":
          void prepareGame(generation);
          break;
        case "enterGame":
          enterGame(c.openLoad);
          break;
      }
    }
  }

  function feed(e: FlowEvent, gen: number): void {
    if (stopped || gen !== generation) return;
    apply(flow.handle(e));
  }

  function copyOf(s: Surface16): Surface16 {
    const out = createSurface(SCREEN_W, SCREEN_H);
    blitCopy(s, 0, 0, Math.min(SCREEN_W, s.width), Math.min(SCREEN_H, s.height), out, 0, 0);
    return out;
  }

  function snapshotGame(g: PlayGame): Surface16 | undefined {
    try {
      const v = g.view();
      if (!v) return undefined;
      const out = createSurface(SCREEN_W, SCREEN_H);
      blitCopy(v.surface, v.scrollX, 0, SCREEN_W, SCREEN_H, out, 0, 0);
      return out;
    } catch {
      return undefined;
    }
  }

  async function ensureStartAssets(): Promise<StartAssets> {
    startAssets ??= await loadStartAssets(files.read);
    return startAssets;
  }

  async function playLogos(gen: number): Promise<void> {
    try {
      const assets = await ensureStartAssets();
      if (stopped || gen !== generation) return;
      const fx = new LaunchSequence(buildWaitScreen(assets.menu));
      launchFx = fx;
      try {
        fx.setLogos(await fetchLogos(files.read));
      } catch (e) {
        setInfo(`logos: ${e instanceof Error ? e.message : String(e)}`);
        fx.setLogos(null);
      }
    } catch (e) {
      setInfo(`logos: ${e instanceof Error ? e.message : String(e)}`);
      feed({ type: "logosDone" }, gen);
    }
  }

  async function openIntroPlayer(): Promise<MoviePlayer | null> {
    const s = loadSettings();
    const b = backend;
    return openIntro(files.read, {
      dialogText: s.showText !== 0,
      sound: b ? new WebAudioMovieSink(b.ctx, b.output) : null,
      level: gameVolumeToLevel(s.musicVol),
    });
  }

  async function prepareIntro(gen: number): Promise<void> {
    preparedIntro = null;
    const p = await openIntroPlayer().catch(() => null);
    if (stopped || gen !== generation) return;
    preparedIntro = p;
    feed({ type: "introReady", ok: p !== null }, gen);
  }

  async function playIntro(from: IntroFrom, gen: number): Promise<void> {
    const player = from === "start" ? await openIntroPlayer().catch(() => null) : preparedIntro;
    preparedIntro = null;
    if (stopped || gen !== generation) return;
    if (!player) {
      introFrame = null;
      feed({ type: "introEnded" }, gen);
      return;
    }
    player.start(0);
    intro = { player, clockMs: 0, esc: new IntroEscape() };
  }

  function renderIntro(dtMs: number): void {
    const m = intro;
    if (!m) return;
    m.clockMs += dtMs;
    const s = m.player.step(Math.floor(m.clockMs / 5), m.esc.update(input.escape === true) || introClick.take(true));
    windowToRgba({ width: SCREEN_W, height: SCREEN_H, pixels: m.player.screen.pixels }, 0, 0, SCREEN_W, SCREEN_H, image.data);
    ctx.putImageData(image, 0, 0);
    if (!s.end) return;
    introFrame = copyOf({ width: SCREEN_W, height: SCREEN_H, pixels: m.player.screen.pixels });
    intro = null;
    feed({ type: "introEnded" }, generation);
  }

  function beginWipe(): void {
    const surface = introFrame ? copyOf(introFrame) : createSurface(SCREEN_W, SCREEN_H);
    wipeFx = { wipe: new StripeWipe(surface), surface };
  }

  function renderWipe(dtMs: number): void {
    const w = wipeFx;
    if (!w) return;
    w.wipe.advance(dtMs);
    windowToRgba(w.surface, 0, 0, SCREEN_W, SCREEN_H, image.data);
    ctx.putImageData(image, 0, 0);
    if (w.wipe.done) {
      wipeFx = null;
      feed({ type: "wipeDone" }, generation);
    }
  }

  function menuSound(): MenuMusic | null {
    const b = backend;
    if (!b) return null;
    if (!menuMusic) {
      const mixer = new Mixer(b);
      menuMixer = mixer;
      const player = new MusicPlayer(mixer, { enabled: true });
      menuMusic = new MenuMusic(
        {
          play: (n, bytes) => player.play(n, bytes),
          stop: () => player.stop(),
          setLevel: (l) => mixer.setChannelVolume(MUSIC_CHANNEL, l),
        },
        gameVolumeToLevel,
      );
    }
    return menuMusic;
  }

  async function openMenu(previous: "black" | "lastFrame", gen: number): Promise<void> {
    try {
      if (previous === "lastFrame" && menu) lastScreen = copyOf(menu.frame());
      const from = previous === "lastFrame" ? lastScreen : undefined;
      game?.audio.silence();
      menuAssets ??= await fetchMainMenuAssets(files.read);
      const music = menuSound();
      await music?.preload(MENU_MUSIC, files.read);
      if (stopped || gen !== generation) return;
      game = null;
      preparedGame = null;
      menu = new MainMenu(menuAssets, {
        sound: music !== null,
        musicVolume: loadSettings().musicVol,
        previous: from,
        onEvent: (e: MainMenuEvent) => {
          if (e.kind === "music") music?.handle(e.command);
          else feed({ type: "menuResult", result: e.result }, generation);
        },
      });
      lastScreen = undefined;
    } catch (e) {
      setInfo(`menu: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  }

  function renderMenu(dtMs: number): void {
    const m = menu;
    if (!m) return;
    m.advance(dtMs);
    if (m.readyToLeave) feed({ type: "menuReady" }, generation);
    if (m.phase === "done" && m.result === "quit") feed({ type: "menuDone" }, generation);
    if (!menu) return;
    windowToRgba(m.frame(), 0, 0, SCREEN_W, SCREEN_H, image.data);
    ctx.putImageData(image, 0, 0);
  }

  async function prepareGame(gen: number): Promise<void> {
    try {
      const created = await buildGame("SC001", gen);
      if (stopped || gen !== generation) {
        created.audio.silence();
        return;
      }
      preparedGame = created;
      feed({ type: "gameReady", ok: true }, gen);
    } catch (e) {
      setInfo(e instanceof Error ? e.message : String(e));
      feed({ type: "gameReady", ok: false }, gen);
    }
  }

  function enterGame(openLoad: boolean): void {
    const g = preparedGame;
    preparedGame = null;
    menu = null;
    input.escape = false;
    openLoadPending = openLoad;
    if (g) installGame(g);
  }

  function leaveGame(): void {
    if (game) lastScreen = snapshotGame(game);
    apply(flow.handle({ type: "gameExit" }));
  }

  async function toStartScreen(): Promise<void> {
    generation++;
    for (const e of await session.dispose()) console.warn("stopEngine:", e);
    await showStartScreen();
  }

  function onStartActions(actions: StartAction[]): void {
    for (const a of actions) {
      if (a.type === "start") begin(startupNow());
      else if (a.key === "pauseOnBlur") startStore.savePauseOnBlur(a.state.pauseOnBlur);
      else startStore.saveModes(a.state.modes);
    }
  }

  function begin(opts: StartupOptions): void {
    if (stopped) return;
    generation++;
    hideStartScreen();
    ensureRuntime();
    resetScreens();
    apply(flow.handle({ type: "begin", logos: opts.logos, intro: opts.intro }));
  }

  let startFrame = 0;
  const startSurface = createSurface(SCREEN_W, SCREEN_H);

  function drawStartScreen(): void {
    if (!startScreen || stopped) return;
    startScreen.draw(startSurface);
    windowToRgba(startSurface, 0, 0, SCREEN_W, SCREEN_H, image.data);
    ctx.putImageData(image, 0, 0);
    startFrame = requestAnimationFrame(drawStartScreen);
  }

  async function showStartScreen(): Promise<void> {
    if (stopped) return;
    try {
      startAssets = await loadStartAssets(files.read);
    } catch (e) {
      if (stopped) return;
      setInfo(`start screen: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
    if (stopped) return;
    startScreen = new StartScreen({
      assets: startAssets.menu,
      texts: TEXTS_PL,
      background: startAssets.background,
      state: { modes: startStore.loadModes(), pauseOnBlur: startStore.loadPauseOnBlur() },
    });
    GuiWindow.tipShift = { dx: 0, dy: 0 };
    canvas.style.cursor = "default";
    cancelAnimationFrame(startFrame);
    startFrame = requestAnimationFrame(drawStartScreen);
    setInfo("");
  }

  function hideStartScreen(): void {
    startScreen = null;
    GuiWindow.tipShift = HAND_TIP;
    canvas.style.cursor = "none";
    cancelAnimationFrame(startFrame);
  }

  function stop(): Promise<void> {
    if (stopping) return stopping;
    stopped = true;
    generation += 1;
    hideStartScreen();
    for (const off of offs.splice(0)) off();
    detachDisplay();
    detachDisplay = () => undefined;
    stopping = session.dispose().then((errors) => {
      for (const e of errors) console.warn("stopEngine:", e);
    });
    return stopping;
  }

  if (options.direct) launch(options.direct.scene.toUpperCase());
  else void showStartScreen().catch(() => undefined);

  return { stop };
}
