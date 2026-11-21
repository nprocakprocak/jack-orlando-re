# Movies and scene animations

The player for `Movies\*.AVX` and the stepper for scene animations `*.FLX`. The logic (`packages/engine/src/video/timing.ts`, `screen.ts`, `movie.ts`, `flx.ts`) knows neither the DOM nor Web Audio. Sound goes through `MovieSoundSink` (`packages/engine/src/video/audio.ts`). Tests use `FakeMovieSink`. The file format is [media.md](../formats/media.md). Captions are [subtitles.md](../formats/subtitles.md).

## API

```ts
const p = new MoviePlayer(new Avx(bytes), {
  mode: 0, // Media_Open: 0 RUNAVX, 1 INTRO, 2 OUTRO (2 * g_gameFinished)
  subtitles: dlg ? new SubtitleTrack(parseSubtitles(dlgBytes, mode === 1), mode === 1) : null,
  dialogTextOn: true, // DialogOnOff; captions also when sound == null
  sound: new WebAudioMovieSink(backend.ctx), // null = play with no sound
  level: 0, // 0..127, the volume of channel 1 (DAT_009fa962 << 1)
  outro, // mode 2 only: OUTRO16.BM, CREDITS.PBM, CYKL1..3.BM
});
p.start(now); // now = ticks of 5 ms (any monotonic counter)
const s = p.step(now, escapeDown); // each frame: at most 1 picture frame; s.end = "finished" | "aborted"
draw(p.screen.pixels); // 640x480 RGB565, 0 = black; the screen state persists
await p.ended; // the movie ends as an event (RUNAVX continues the scene)
```

`FlxAnimation(new Flx(bytes), loop, restart?)`: `step()` once per animation tick (the caller sets the `ANIMA` / `ANIMADELAY` delay) returns `{index, sprite, rect, finished}`. `index` is the frame number at which `ACTIVEMACROANIMA` macros fire. `sprite` sits at `object + (x, y)`.

## From the original

- **The movie loop** (`Game_Run` `0043b81c`..`0043b84f`): `Media_Open`, then `Media_Step` until it returns ≤ 0, or `Sys_PumpMessages` ≠ 0, or `Input_IsKeyDown(1)` — **Esc** (DIK_ESCAPE; `push 1` at `0043b83a`) — checked after every step, so a held Esc aborts after the first frame. Then `Media_Close`, then `Timer_Sleep(0x32)` (50 ms, not reproduced). The mode is `byte [0x5348c0] * 2` (`g_gameFinished`, set when the movie name is `OUTRO.AVX`). Before the movie, music (channel 5) is muted in a loop on `DAT_007a8bf4`.
- **This is not `RUNFILMP`.** `RUNFILMP` (`0x23`) starts `Film_Play`, the short `.FCM` / `CM*.BIN` films with Jack's face ([global.md](../formats/global.md)). `.AVX` movies are the command **`RUNAVX`** (`0x83`: a film and a scene). The second argument, the scene name, is never read.
- **The frame clock** (`Media_Step`): a frame is due when `clock − (ticks − start) < 2`. After it is drawn, `clock += 200/fps` (computed in `Media_DecodeVideo` on the first frame of a segment, so that frame already has the new tempo). The first frame comes out at once (`clock = 0`). A lateness above 600 ticks the original treats as missing data from the disc (it mutes the channel and refills bytes). A browser does not wait on a disc, so `MoviePlayer` restarts the schedule (`resyncs`). That is a departure.
- **Sync with the sound** (`Media_QueueSound`): before the frame's sound is added, `lead = (write − play) / 2000`. `clock += |0xdc − lead|` when `lead > 0xdc`, and `−=` when it is less. The write starts at `0x6baa8` = 441 000 B (2.5 s), so the first frame corrects nothing. On all 20 movies with an ideal sound card the total time differs from the nominal time by under 1%. When `AudioContext` is suspended (no gesture), the sink returns `null` and the nominal clock applies.
- **Captions:** after `Media_DecodeVideo`, before `Media_QueueSound`. The counter is the frame index + 1. They are drawn onto the persistent screen with key 0. Nothing erases them except a later picture delta or, in INTRO, a repaint after a palette chunk (`FUN_004703b0`). `Media_DrawSubtitles` `00467500` and `Delta_ToScreen` `00470020` write the same `g_targetPixels` (the surface `g_ddsTarget`, `Video_LockTarget` `00451a90`). The code does not erase a caption at `last` and does not restore the background. Measured on the data, ignoring pixels a later caption legally covers in that frame: in `MUN16` / `PLA16` the delta of frame `last` overwrites the whole rectangle (0 pixels left). In `kraty16` one caption leaves 4 pixels and another leaves 59 across 2 frames. In INTRO a caption stays 1–7 frames after `last` (one of them until the end of the segment, 20 frames), until a delta overwrites it or the next caption covers it. One caption in segment 17 (frames 1–35, rectangle 91,74, 218×44, a frame of 80 ms) stays 5 frames (0.4 s). On frame 40 the next caption comes in and, in the same frame, the delta clears the top rows of the old one. A listener's report that a caption disappears as soon as the line is finished, with no leftover, and that the next one replaces it, matches the model. A 0.4 s delay before the replacement is hard to notice. An earlier count of 29 frames had included pixels of the next caption. The presentation path was checked in the code and does not explain a missing trace. `WinMain` calls `Video_SetMode(1 or 2, 640, 480, 16, 0x400, 0x1e0, 0)`. The fifth argument is not 0, so `g_ddsTarget` is the work surface `g_ddsWork`, 1024×480 (`00453040`, hence the stride of 1024 in movies), not the primary and not the back buffer. `Video_Present` `00452310` only copies it with `Blt` onto the primary (a window: into the client rectangle; full screen without flag 4: the whole thing) and does not copy back. `Flip` runs only with flag 4, which `WinMain` does not set. After the present it calls `g_onPresent` (in INTRO, `FUN_0046bea0`, turned off by `_DAT_00504adc = 0` in `Media_Step`). The work surface is therefore persistent, which matches the measurement.
- **The picture:** a delta writes `palette[index]` straight to the screen (columns at or past 640 of the 1024-wide buffer are outside the view). INTRO (mode 1): a palette chunk repaints the whole screen.

## OUTRO (mode 2) — what is the movie, and what is code

| Effect | Source |
|---|---|
| a shrinking circle, then a black screen | **frames of the movie**: segment 19 (30 frames of 80 ms = 2.4 s) is a two-color mask. Index 0 (the hole) shrinks to a circle. The rest is near-black. After frame 28 everything is black. Checked on the data (the count of non-zero pixels grows 0 → 117 900 → 291 672 → 307 200) |
| the fade to silence | **code**: `Media_DecodeVideo` in segment 19 (`0x13`) calls `Snd_SetVolume(1, ftol(level · (frames − counter) / frames))` after every frame (`00467170`..`004671b2`, level = `DAT_009fa962 << 1`). Linearly to 0 on the last frame |
| the sound tail (2.5 s) | it does not play, but the volume reaches 0 exactly when the movie ends, so the cut is not heard |
| the background | `OUTRO16.BM` (640×480) in buffer `DAT_009fa92c`. On the first frame of segment 4, `CREDITS.PBM` is pasted into it **with no key** (`FUN_0046ec80`). Index 0 in a delta is a background pixel (`Delta_ToScreenOverBg` `004701a0`) |
| the film strip on the left | `CYKL1`–`3.BM` (8-bit, color 0 transparent) at `x = 0x23`. In segment 7, `CYKL1` goes into the background. In segments 7–18, after every frame, `CYKL[counter % 3]` goes to the screen (`FUN_0046dc40`) |
| segment 7, frames 1–0x4a | the delta goes into the index buffer but **not to the screen** (`Media_DecodeVideo`). The background stands still |

The end captions (`OUTRO16.DLG`, 11 records) take the same path as in the other movies. The film strip (`CYKL1`–`3`, every frame, `counter % 3`, segments 7–18; `Media_DecodeVideo` `00466b50`) animates smoothly.

## Scene FLX animations (`FlxAnimation`)

The equivalent of the `g_flxData` / `g_flxPos` block in `Game_Run` (`0042b6d0`): one picture per animation tick. The counter grows by 1 per frame (including frames with no change). At `== frames`, mode 5 finishes (activity 0, the macro is released). Mode 6 returns to the start of **record 0 of the object** (`DAT_0085e044[anim * 300]`, not the current record — hence the `restart` parameter) without clearing the buffer. The sprite is the rectangle from chunk 3, cut from the buffer: mode 2 from (0, 0), the others from (x, y), placed at `object + (x, y)`. A type-0 frame does not change the sprite. Mode 3 (a fade through `FUN_00427950`) does not occur in the data and is not reproduced.

## Outside this module

- The studio logos (`LOGOTT.BM`, `LOGO.BM`, `LOGOJW.BM`, with a fade `Blit_MixStep565`) in state 5 of `Media_Step`, only when `DAT_009fc088` / `DAT_009fa96a` ≠ 0 (the launcher start, `Launcher_Run` `0046b020`). That is part of the launcher. See [launcher.md](launcher.md).
- `Sys_PumpMessages` (closing the window) is the host.
- The sound stream does not go through the mixer, which plays only finished buffers. `WebAudioMovieSink` schedules an `AudioBufferSource` on its own `GainNode`. The game connects it to `backend.output` (the master node), so the master volume and a pause (`AudioContext.suspend`) cover the movie too.

## Pause

Details: [pause.md](pause.md).

- `MoviePlayer.step(now)` receives game time, which stands still during a pause (`FrameInfo.elapsedMs` of the loop, not `performance.now()`). `AudioContext.suspend()` stops the movie sound on the same sample. After resume both clocks continue from the same place. Frames come out at the same game-time moments as with no pause (`packages/engine/src/video/pause.test.ts`). This is the original behavior (`WM_ACTIVATE` → `Timer_SetPaused(0)` plus `Sound_SetPaused(0)`).
- When the picture stands still and the sound keeps playing (sound not paused, or throttling before it is detected, at most about 0.5 s), `Media_QueueSound` (`syncAdjust`) pulls the frame clock back and the picture catches up, as in the original. A lateness above 600 ticks: `MoviePlayer` restarts the schedule (`resyncs`). The original waits for the disc. That departure is described above.
- `WebAudioMovieSink.playedBytes()` returns `null` when the context is not `running` (also for the few milliseconds of `resume()`). The movie then follows the nominal clock.
