// Loading a scene, the log, and the first steps after a command.

import { Pak } from "../formats/pak";
import { decrypt } from "../formats/textcrypt";
import { loadSceneSounds, type SceneSounds } from "../sfx";
import { DEFAULT_TRACK } from "./audio";
import { SceneTransition } from "../render";
import { sceneChapter, sceneNumber } from "../keys";
import type { JackPose as SavedPose } from "../save";
import { ScenePlayer, type SceneEvent } from "../scene";
import { compileMcc, Interpreter, type Command, type LogEntry } from "../script";
import { isNoControlScene, MAP_SCENE, mapClickAreas, noControlCursor } from "../map";
import { SceneHost, TALK_TICKS, type HostEnv } from "./host";
import type { GameState } from "./game-state";
import { itemPort } from "./game-inventory";
import { makeDialog } from "./game-dialog";
import { saveState, restoreJack } from "./game-save";
import { playSounds } from "./game-frame";

const MAX_LOG = 400;

/** Resolves when no scene is being loaded (tests, the page's first frame). */
export async function settle(this: GameState): Promise<void> {
  while (this.loadPromise || this.ioPromise) await (this.loadPromise ?? this.ioPromise);
}

/** Scene_Load + the start of Game_Run for scene `name`; the old scene (if any) fades out when REFRESHSCREEN asked for it. */
export async function enter(this: GameState, name: string, restorePose?: SavedPose): Promise<void> {
  const { old, fade } = leavePrevious.call(this);
  try {
    const loaded = await installLoaded.call(this, name, old, restorePose);
    await startLoaded.call(this, name, old, fade, loaded.sc, loaded.it, restorePose);
  } catch (e) {
    this.error = `${name}: ${e instanceof Error ? e.message : String(e)}`;
    this.addLog(`ERROR ${this.error}`);
    this.phase = "playing";
    throw e;
  } finally {
    this.cursor.busy = false;
  }
}

/** The previous scene lets go of the item in hand and of the fade request. */
function leavePrevious(this: GameState): { old: ScenePlayer | null; fade: boolean } {
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
  return { old, fade };
}

/** The loaded scene, its program, its host and the dialog layer. */
async function installLoaded(
  this: GameState,
  name: string,
  old: ScenePlayer | null,
  restorePose?: SavedPose,
): Promise<{ sc: ScenePlayer; it: Interpreter }> {
  const sc = await loadScene.call(this, name);
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
  const phk = scenePak.call(this, sc);
  const program = compileMcc(decrypt(phk.read(`${name}.MCC`)));
  // [engine; approved deviation, ] the city map clicks exactly where a place's caption lights up
  if (name === MAP_SCENE) sc.scene.areas = mapClickAreas(sc.scene.areas, program);
  await loadSound.call(this, name, phk, program.commands);
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
    log: (e) => onLog.call(this, e),
    audio: this.audio,
    runMovie: (film, scene) => {
      this.pendingMovie = { film, scene };
    },
    runFilm: (film, x, y, mode, global = false) => {
      this.bullet.close(); // RUNFILMP closes the bullet menu
      this.pendingFilm ??= { film, x, y, mode, global };
    },
    items: itemPort.call(this, sc),
    autoInc: this.autoInc,
  };
  const host = new SceneHost(env, this.opts.talkTicks ?? TALK_TICKS);
  host.restoringPose = !!restorePose; // g_restoreJackPose: INIT does not place or move Jack
  const it = new Interpreter(program, host, this.vars);
  host.interpreter = it;
  this.dialog = this.dialogAssets ? makeDialog.call(this, name, phk, it, host) : null;
  env.dialog = this.dialog ?? undefined;
  this.host = host;
  this.interpreter = it;
  this.logged.clear();
  this.talkArmed = true;
  this.wasTalking = false;
  return { sc, it };
}

/** The saved or default track, the clock, the tempjs save, then [PRE] and [INIT]. */
async function startLoaded(
  this: GameState,
  name: string,
  old: ScenePlayer | null,
  fade: boolean,
  sc: ScenePlayer,
  it: Interpreter,
  restorePose?: SavedPose,
): Promise<void> {
  // `Scene_SetNumberAndMapFlag`, the scene of a loaded save: the saved track starts here, before the scene's own MUSIC commands
  const saved = this.audio.music.pendingSavedTrack;
  if (saved) await loadTrack.call(this, saved);
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
  if (this.opts.save)
    await this.opts.save
      .sceneStart(saveState.call(this))
      .catch((e) => this.addLog(`! tempjs: ${e instanceof Error ? e.message : String(e)}`));
  this.resetMenuVar();
  it.runSynchronous("PRE");
  if (restorePose && !isNoControlScene(name)) restoreJack.call(this, sc, restorePose);
  it.start("INIT");
  this.autosavePending = !!this.opts.save;
  this.error = null;
  if (fade && old) {
    this.transition = new SceneTransition(old.renderer.framebuffer, sc.renderer.framebuffer);
    this.phase = "fading";
  } else this.phase = "playing";
}

/** The scene's sound list and the tracks its MUSIC commands name (read ahead: a command cannot wait for a file). */
export async function loadSound(this: GameState, name: string, phk: Pak, commands: readonly Command[]): Promise<void> {
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
  for (const c of commands) if (c.code === 0x3f) await loadTrack.call(this, c.n1);
}

export async function loadTrack(this: GameState, name: string): Promise<void> {
  if (this.audio.track(name)) return;
  try {
    this.audio.addTrack(name, await this.files.read(`Music/${name}`));
  } catch {
    // a missing track plays nothing
  }
}

export function scenePak(this: GameState, sc: ScenePlayer): Pak {
  return this.scenePhk.get(sc)!;
}

export async function loadScene(this: GameState, name: string): Promise<ScenePlayer> {
  const phk = new Pak(await this.files.read(`Action/${name}.phk`));
  const ph2 = (await (this.files.exists?.(`Data/${name}.ph2`) ?? Promise.resolve(true)))
    ? await this.files
        .read(`Data/${name}.ph2`)
        .then((b) => new Pak(b))
        .catch(() => null)
    : null;
  const sc = new ScenePlayer(
    { name, resource: this.resource, phk, ph2, global: this.global, globalIcs: this.globalIcs },
    { scripted: true, walkSpeed: this.settings.walkSpeed, shadowTables: this.dialogAssets?.remap },
  );
  // g_jackUniform and the loaded frame set (write the same buffers) outlive scenes
  sc.turning.uniform = sc.jack.uniform = this.dialog?.jackUniform ?? this.jackUniform;
  this.scenePhk.set(sc, phk);
  return sc;
}

export function onLog(this: GameState, e: LogEntry): void {
  if (e.kind === "end" || e.kind === "missing-var") return;
  if ((e.kind === "start" || e.kind === "missing-macro") && /^CO\d+$/.test(e.macro)) return;
  if (e.kind === "unhandled") {
    const key = `${e.macro}:${e.command?.word}`;
    if (this.logged.has(key)) return;
    this.logged.add(key);
  }
  this.addLog(e.kind === "start" ? `▶ ${e.text}` : e.kind === "unhandled" ? `⏭ ${e.text}` : `! ${e.text}`);
}

export function addLog(this: GameState, text: string): void {
  this.log.push({ tick: this.ticks, scene: this.sceneName, text });
  if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
}

/**
 * Step 20 of Game_Run (the macros) is followed by steps 26-31 in the same frame: what the commands (and a click) just
 * started takes its first step now (`ScenePlayer.firstSteps`); a macro it releases runs in the next frame.
 */
export function firstSteps(this: GameState): void {
  const result = this.scene?.firstSteps();
  if (!result || !this.scene) return;
  playSounds.call(this, result);
  for (const ev of this.scene.events) this.release(ev);
}

export function release(this: GameState, ev: SceneEvent): void {
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
 * Game_Run line 467 (the prologue every scene passes, after Save_WriteState, before [PRE]): `MENU = (g_exitToDos == 0)` = 1.
 * SC000D [PRE] does `LET MENU` and nothing else writes the variable; without this reset F1-F4 and the click on Jack stayed dead
 * in every scene entered from the map.
 */
export function resetMenuVar(this: GameState): void {
  this.vars.set("MENU", 1);
}

/**
 * Game_Run ~line 705: a scene without control (the city map SC000D, SC008B) zeroes `g_verbMode` and `g_cursorMode`;
 * so the map is clicked with the pointer (`POKAZANIE- `) and the verb chosen before the map does not come back after it.
 */
export function startNoControl(this: GameState, name: string): void {
  const c = noControlCursor(name, this.cursor.mode, this.verbMode);
  this.cursor.mode = c.mode;
  this.verbMode = c.verbMode;
}
