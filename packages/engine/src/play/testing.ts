// Stand-ins shared by play tests. The sound backend has no output: voices end by a clock the test advances
// (`advance(seconds)`), so WAITWHILEEFFECT, speech lengths and channel use behave as with a sound card.
import type { AudioBackend, PreparedSound, StreamSource, Voice, VoiceParams } from "../audio/types";
import { AreaState } from "../areas";
import { compileMcc, Interpreter, type LogEntry } from "../script";
import type { ScenePlayer } from "../scene";
import { PlayGame } from "./game";
import type { AutoIncClock } from "./host";
import { SceneHost, type HostEnv, type ItemPort } from "./host";

export interface FakeVoice {
  /** "sound" (a buffer) or "stream" (music) */
  kind: "sound" | "stream";
  params: VoiceParams;
  /** seconds on the backend clock at which it ends, Infinity = loops / streams */
  end: number;
  stopped: boolean;
  ended: boolean;
  /** frames of the sound (0 for streams) */
  frames: number;
}

export class TimedBackend implements AudioBackend {
  now = 0;
  readonly voices: FakeVoice[] = [];
  master = 1;
  suspended = false;
  private readonly callbacks = new Map<FakeVoice, () => void>();

  start(sound: PreparedSound, params: VoiceParams, onEnded: () => void): Voice {
    const frames = sound.channels[0].length;
    return this.add(
      {
        kind: "sound",
        params: { ...params },
        end: sound.loopLength ? Infinity : this.now + frames / sound.rate,
        stopped: false,
        ended: false,
        frames,
      },
      onEnded,
    );
  }

  startStream(_source: StreamSource, params: VoiceParams, onEnded: () => void): Voice {
    return this.add(
      {
        kind: "stream",
        params: { ...params },
        end: Infinity,
        stopped: false,
        ended: false,
        frames: 0,
      },
      onEnded,
    );
  }

  private add(v: FakeVoice, onEnded: () => void): Voice {
    this.voices.push(v);
    this.callbacks.set(v, onEnded);
    return {
      stop: () => {
        v.stopped = true;
      },
      setGain: (g) => {
        v.params.gain = g;
      },
      setPan: (p) => {
        v.params.pan = p;
      },
    };
  }

  setMasterGain(gain: number): void {
    this.master = gain;
  }

  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
  }

  /** Moves the clock; voices that ran out report their end. */
  advance(seconds: number): void {
    if (this.suspended) return;
    this.now += seconds;
    for (const v of this.voices) {
      if (v.stopped || v.ended || v.end > this.now) continue;
      v.ended = true;
      this.callbacks.get(v)?.();
    }
  }

  /** Voices that were started and not stopped or ended. */
  get playing(): FakeVoice[] {
    return this.voices.filter((v) => !v.stopped && !v.ended);
  }
}

/** A PlayGame shell with only the fields the helpers touch (no files, no audio device). */
// Tests call methods the class keeps private, so the stand-in stays untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function shell(fields: Record<string, unknown>): any {
  return Object.assign(Object.create(PlayGame.prototype), {
    menuCursorSaved: null,
    moviePause: null,
    ...fields,
  });
}

/** Calls a method the shell does not expose (`keyFrame`, `applyLoaded`, `stepFilm`, `stepMovie`). */
export const callPlay = (g: unknown, name: string, ...a: unknown[]) =>
  (g as Record<string, (...x: unknown[]) => unknown>)[name](...a);

const bytes = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const VARS = new Map([
  ["LAST", 0],
  ["A", 0],
  ["B", 0],
  ["SLAP", 0],
  ["SHOOT", 0],
  ["PX", 0],
  ["PY", 0],
  ["R", 9],
  ["JACKISWOJ", 0],
]);

/** The few things of ScenePlayer the host touches in these tests, recording calls. */
function fakeScene() {
  const calls: string[] = [];
  const anim = {
    active: true,
    index: 0,
    delay: 0,
    stop() {
      this.active = false;
    },
  };
  const shifty = { shadowDx: 0, shadowDy: 0, checkDistance: false };
  const scene = {
    calls,
    shifty,
    scene: { areas: [{ name: "DYWAN", exit: false, triangles: [[0, 0, 300, 0, 0, 300]] }] },
    world: {
      walk: [],
      perspective: {},
      objects: [
        { x: 100, y: 100, quad: [0, 0, 50, 0, 50, 50, 0, 50], center: [25, 25], valid: true },
        { x: 300, y: 100, quad: [0, 0, 50, 0, 50, 50, 0, 50], center: [25, 25], valid: false },
      ],
    },
    walker: { x: 100, y: 200, dir: 1, mirror: 1 },
    turning: { pointRotate: false, pointRotateSaved: false, uniform: false },
    persons: {
      find: (n: string) => (n === "BOB" ? 0 : n === "ANN" ? 1 : -1),
      get: (n: string) => (n === "SHIFTY" ? shifty : undefined),
      persons: [],
    },
    jack: { uniform: false },
    pose: () => ({ x: 300.7, y: 420.2 }),
    hasWalkArea: true,
    scrollDir: 0,
    brightness: 1,
    marginL: 120,
    marginR: 120,
    bgWide: true,
    faceBeforeWalk() {}, // not what these tests are about
    walkPlan(plan: { path: { x: number; y: number }[]; direct: boolean }, forced: number | null) {
      calls.push(`plan ${plan.path.map((p) => `${p.x},${p.y}`).join(">")} ${plan.direct} ${forced}`);
      return this.walkStarts;
    },
    walkJackTo(x: number, y: number, forced: number | null) {
      calls.push(`walk ${x},${y},${forced}`);
      return true;
    },
    jackInsertion(name: string, dir: number, count?: number) {
      calls.push(`ins ${name} ${dir} ${count ?? "-"}`);
      return name !== "NOPE";
    },
    personInsertion(p: number, name: string, dir: number, count?: number, fresh?: boolean) {
      calls.push(`pins ${p} ${name} ${dir} ${count ?? "-"} ${fresh ? "fresh" : "-"}`);
      return name !== "NOPE";
    },
    startGlobalInsertion(n: string, f: number, m: number) {
      calls.push(`gins ${n} ${f} ${m}`);
      return true;
    },
    showAnimFrame(n: string, i: number) {
      calls.push(`frame ${n} ${i}`);
      return n !== "NOPE";
    },
    setAnimDarkness(n: string, f: number) {
      calls.push(`dark ${n} ${f}`);
      return false;
    },
    brightenObject(n: string, f: number) {
      calls.push(`bright ${n} ${f}`);
      return true;
    },
    clearAnimBuffer(n: string) {
      calls.push(`clear ${n}`);
      return false;
    },
    moveObjectPoint(n: string, dx: number, dy: number) {
      calls.push(`movep ${n} ${dx},${dy}`);
      return true;
    },
    setPersonLightScale(p: number | null, f: number) {
      calls.push(`light ${p} ${f}`);
      return true;
    },
    insReleaseEarly: false,
    walkStarts: true,
    standJack() {
      calls.push("stand");
    },
    turnWaits: true,
    lookAt(x: number, y: number, wait = true) {
      calls.push(`look ${x},${y}${wait ? "" : " nowait"}`);
      return this.turnWaits;
    },
    stayJack(name: string) {
      calls.push(`stay ${name}`);
      return this.turnWaits;
    },
    placeAgainstObject(p: number | null, o: string, over: boolean) {
      calls.push(`depth ${p} ${o} ${over}`);
    },
    setClip(n: string, c: unknown) {
      calls.push(`clip ${n} ${JSON.stringify(c)}`);
      return n !== "NOPE";
    },
    placeUnderPerson(p: number | null, o: number | null) {
      calls.push(`under ${p} ${o}`);
    },
    placeObjectOver(a: string, b: string) {
      calls.push(`over ${a} ${b}`);
    },
    setJackPosition(x: number, y: number) {
      calls.push(`pos ${x},${y}`);
    },
    setJackTempoFixed(f: boolean) {
      calls.push(`tempo ${f}`);
    },
    setScroll(x: number) {
      calls.push(`scroll ${x}`);
    },
    objectAnim: (n: string) => (n === "ANI" ? anim : null),
    startObjectAnim(n: string, a: unknown) {
      calls.push(`anima ${n} ${JSON.stringify(a)}`);
      return true;
    },
    setObjectPosition(n: string, x: number, y: number, rel = false) {
      calls.push(`obj ${n} ${x},${y} ${rel}`);
    },
    setObjectVisible(n: string, v: boolean) {
      calls.push(`vis ${n} ${v}`);
    },
    setShadow(p: number | null, n: number) {
      calls.push(`shadow ${p} ${n}`);
    },
    fadeShadowOut(p: number | null, n: number, w: number) {
      calls.push(`fadeout ${p} ${n} ${w}`);
    },
    fadeShadowIn(p: number | null, n: number, w: number) {
      calls.push(`fadein ${p} ${n} ${w}`);
    },
    setSpecShadow(p: number, o: string) {
      calls.push(`spec ${p} ${o}`);
      return o !== "NOPE";
    },
    showShadow(p: number, x: number, y: number, f: number) {
      calls.push(`show ${p} ${x},${y} ${f}`);
    },
    hideShadow(p: number) {
      calls.push(`hide ${p}`);
    },
    setShadowStatus(p: number, on: boolean) {
      calls.push(`status ${p} ${on}`);
    },
    shadowBy(o: string, dx: number, dy: number, n: number) {
      calls.push(`by ${o} ${dx},${dy} ${n}`);
      return o !== "NOPE";
    },
    putShadowOnBackground(x: number, y: number, f: number) {
      calls.push(`put ${x},${y} ${f}`);
    },
    showExtraShadow(x: number, y: number, f: number) {
      calls.push(`extra ${x},${y} ${f}`);
    },
    setAnimShadow(a: string, p: number | null, sh: number | null, clear: boolean) {
      calls.push(`animshadow ${a} ${p} ${sh} ${clear}`);
      return a !== "NOPE";
    },
    setShadowOne(o: string) {
      calls.push(`one ${o}`);
      return o !== "NOPE";
    },
  };
  return { scene, anim };
}

export function setup(text: string, talkTicks = 3, items?: ItemPort, autoInc?: AutoIncClock) {
  const { scene, anim } = fakeScene();
  const log: LogEntry[] = [];
  const out = {
    goto: [] as string[],
    fade: 0,
    answers: [] as [number, number][],
    films: [] as [string, number, number, number, boolean | undefined][],
  };
  const env: HostEnv = {
    scene: scene as unknown as ScenePlayer,
    areas: new AreaState(),
    gotoScene: (n) => out.goto.push(n),
    requestFade: () => out.fade++,
    clickX: () => 0,
    answer: (id, asked) => {
      out.answers.push([id, asked]);
      return 7;
    },
    log: (e) => log.push(e),
    runFilm: (film, x, y, mode, global) => out.films.push([film, x, y, mode, global]),
    items,
    autoInc,
  };
  const host = new SceneHost(env, talkTicks);
  const it = new Interpreter(compileMcc(bytes(text)), host, VARS);
  host.interpreter = it;
  return { host, it, scene, anim, log, out };
}

/** One game frame + one logic tick. */
export function step(s: ReturnType<typeof setup>): void {
  s.it.tick();
  s.it.logicTick();
  s.host.tick();
}
