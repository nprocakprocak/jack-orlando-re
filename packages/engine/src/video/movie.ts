// AVX movie player: the logic of Media_Open / Media_Step / Media_Close
// without DOM, canvas or Web Audio. The host calls step(now) in its frame loop and shows
// `screen.pixels`; time is in ticks of 5 ms (the game's clock), `now` any monotonic tick counter.
// src/video/README.md

import { AVX_GAP, Avx, ImaStereoStream } from "../formats/media";
import type { AvxFrame } from "../formats/media";
import type { SubtitleTrack } from "../formats/subtitles";
import type { MovieSoundSink } from "./audio";
import { MODE_OUTRO, MovieBuffer, MovieScreen, OUTRO_FADE_SEGMENT } from "./screen";
import type { MovieMode, OutroImages } from "./screen";
import { INITIAL_FRAME_TICKS, movieFrameTicks, outroVolume, STALL_TICKS, syncAdjust } from "./timing";

export type MovieEnd = "finished" | "aborted";

export interface MovieOptions {
  /** Media_Open mode: 0 RUNAVX, 1 INTRO, 2 OUTRO (`2 * g_gameFinished`) */
  mode: MovieMode;
  /** mode 2 only: OUTRO16.BM, CREDITS.PBM, CYKL1..3.BM */
  outro?: OutroImages;
  /** Movies\<film>.DLG, if the file exists (parseSubtitles(mode === 1)) */
  subtitles?: SubtitleTrack | null;
  /** `g_dialogTextOn` (DialogOnOff). Subtitles are drawn if it is on or when there is no sound. */
  dialogTextOn?: boolean;
  /** channel 1 sink; null = the game without sound (`g_config == 0`): the clock is the nominal one */
  sound?: MovieSoundSink | null;
  /** volume level 0..127 of channel 1 (`<< 1`) */
  level?: number;
}

export interface MovieStep {
  /** a frame was decoded and drawn in this call */
  presented: boolean;
  /** frame number in the whole movie (valid when presented) */
  number: number;
  segment: number;
  /** 0-based index in the segment; the counter of the subtitles is index + 1 */
  index: number;
  /** set once the movie is over (the last frame was drawn, or it was aborted) */
  end: MovieEnd | null;
}

/** Movies end by themselves after the last frame of the last segment (Media_Step returns 0). */
export class MoviePlayer {
  readonly screen: MovieScreen;
  /** resolves when the movie ends: this is "RUNAVX done" for the host */
  readonly ended: Promise<MovieEnd>;
  /** frame clock in ticks: the next frame is due when `now - startTick >= clock` */
  clock = 0;
  frameTicks = INITIAL_FRAME_TICKS;
  /** bytes of PCM handed to the sound sink so far (the write cursor of the ring) */
  written = 0;
  frameNumber = 0;
  resyncs = 0;

  /** index buffer and picture of the decoder ; tests compare it with the screen */
  readonly buffer = new MovieBuffer();
  private readonly frames: Generator<AvxFrame>;
  private readonly ima: ImaStereoStream;
  private readonly level: number;
  private readonly sound: MovieSoundSink | null;
  private startTick = 0;
  private started = false;
  private result: MovieEnd | null = null;
  private resolve!: (e: MovieEnd) => void;

  constructor(
    readonly avx: Avx,
    private readonly opts: MovieOptions,
  ) {
    this.screen = new MovieScreen(opts.mode, opts.outro);
    this.frames = avx.frames(this.buffer);
    this.ima = new ImaStereoStream(avx.codec);
    this.sound = opts.sound ?? null;
    this.level = opts.level ?? 0x7f;
    this.ended = new Promise((r) => (this.resolve = r));
  }

  get isOver(): boolean {
    return this.result !== null;
  }

  /** Media_Step state 5: sound starts, the frame clock is 0 so the first frame is due at once. */
  start(now: number): void {
    if (this.started) throw new Error("movie already started");
    this.started = true;
    this.startTick = now;
    this.clock = 0;
    if (this.sound) {
      const pre = this.ima.decode(this.avx.preroll);
      const pcm = new Int16Array(pre.length + AVX_GAP / 2); // the 8-byte gap is silence here
      pcm.set(pre);
      this.written = pcm.length * 2;
      this.sound.start(pcm, this.level);
    }
  }

  /**
 * One Media_Step: draws at most one frame. `escapeDown` is the state of ESC
 * (`Input_IsKeyDown(1)`, Game_Run): the loop tests it after every step, so a key
 * that is already down ends the movie after its first frame.
 */
  step(now: number, escapeDown = false): MovieStep {
    if (!this.started) throw new Error("movie not started");
    const out: MovieStep = { presented: false, number: -1, segment: -1, index: -1, end: this.result };
    if (this.result) return out;
    const timeLeft = this.clock - (now - this.startTick);
    if (timeLeft < STALL_TICKS) {
      // the game waits for disk data here with the sound muted; the browser has none to wait for,
      // so the schedule just restarts (a hidden tab, a long pause)
      this.startTick = now;
      this.clock = 0;
      this.resyncs++;
    } else if (timeLeft < 2) {
      this.present(out);
    }
    if (!this.result && escapeDown) this.finish("aborted");
    out.end = this.result;
    return out;
  }

  /** Media_Close without waiting for the end (also what ESC does). */
  abort(): void {
    if (!this.result) this.finish("aborted");
  }

  private present(out: MovieStep): void {
    this.buffer.runs.length = 0;
    const r = this.frames.next();
    if (r.done) {
      this.finish("finished");
      return;
    }
    const af = r.value;
    const h = af.header;
    const counter = af.index + 1; // g_segFrameCounter after the decode
    if (af.index === 0) this.frameTicks = movieFrameTicks(h.fps);
    this.screen.drawFrame(af, this.buffer.runs);
    const sound = this.sound;
    if (sound && this.opts.mode === MODE_OUTRO && af.segment === OUTRO_FADE_SEGMENT) {
      sound.setLevel(outroVolume(this.level, h.frames, counter));
    }
    // Media_DrawSubtitles; the counter (1-based, no value skipped) is what SubtitleTrack expects
    const track = this.opts.subtitles;
    if (track && (this.opts.dialogTextOn || !sound)) {
      const sub = track.step(af.segment, counter);
      if (sub) this.screen.drawSubtitle(sub);
    }
    if (sound) {
      const played = sound.playedBytes();
      if (played !== null) this.clock += syncAdjust(this.written, played);
      const pcm = this.ima.decode(this.avx.audioChunk(af.record));
      sound.push(pcm);
      this.written += pcm.length * 2;
    }
    this.clock += this.frameTicks;
    this.frameNumber++;
    out.presented = true;
    out.number = af.number;
    out.segment = af.segment;
    out.index = af.index;
    if (counter === h.frames && af.segment + 1 === this.avx.segments) this.finish("finished");
  }

  private finish(how: MovieEnd): void {
    this.result = how;
    this.sound?.stop();
    this.resolve(how);
  }
}
