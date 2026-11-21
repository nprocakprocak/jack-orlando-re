# Movies and scene animations

`.AVX` movies and `.FLX` scene animations. No DOM and no Web Audio. The movie player draws the picture and the captions. Sound goes through `MovieSoundSink` (`audio.ts`). The longer account of the original player is [docs/dev/engine/video.md](../../../../docs/dev/engine/video.md).

| File | Contents |
|---|---|
| `timing.ts` | Frame clock in ticks of 5 ms: `movieFrameTicks`, `syncAdjust`, `outroVolume` |
| `screen.ts` | `MovieScreen`: the persistent 640×480 picture, captions, and the outro images |
| `movie.ts` | `MoviePlayer`: `Media_Open` / `Media_Step` / `Media_Close` |
| `audio.ts` | `MovieSoundSink` and `WebAudioMovieSink` |
| `flx.ts` | `FlxAnimation`: one `.FLX` frame per `step()` (`ANIMA` modes 5 and 6) |
| `synthetic.ts` | Tiny `.FLX` and `.AVX` bytes for tests |

## Movies

```ts
const p = new MoviePlayer(new Avx(bytes), {
  mode: 0, // 0 RUNAVX, 1 INTRO, 2 OUTRO
  subtitles: dlg ? new SubtitleTrack(parseSubtitles(dlgBytes, mode === 1), mode === 1) : null,
  dialogTextOn: true, // captions also when sound is null
  sound: new WebAudioMovieSink(backend.ctx), // null = silent, nominal clock
  level: 0, // 0..127, channel 1
  outro, // mode 2 only: OUTRO16.BM, CREDITS.PBM, CYKL1..3.BM
});
p.start(now); // now = ticks of 5 ms
const s = p.step(now, escapeDown); // at most one picture frame; s.end = "finished" | "aborted"
draw(p.screen.pixels); // 640×480 RGB565; the picture persists between steps
await p.ended;
```

Captions are picture records in `Movies/*.DLG`, read by `parseSubtitles`. The intro is `Movies/INTRO.AVX` with `Movies/INTRO.DLG` (8-bit). A script film `NAME.AVX` is `Movies/NAME16.AVX` and `Movies/NAME16.DLG`. A missing or damaged caption file means no captions.

`PlayGame` opens these files in `play/film.ts` and steps the player from `advance(dtMs)`.

## Scene animations

`new FlxAnimation(flx, loop, restart?)`. `loop` is mode 6. `step()` once per animation tick (the caller owns `ANIMA` / `ANIMADELAY`) returns `{ index, sprite, rect, finished }`. `index` is the frame at which `ACTIVEMACROANIMA` fires. `sprite` sits at the object position plus `(x, y)`. Mode 5 finishes on the last frame. Mode 6 wraps to `restart` (record 0 of the object in the game).

## Tests

`movie.test.ts`, `flx.test.ts`, `timing.test.ts`, and `pause.test.ts`. They build bytes with `synthetic.ts`.
