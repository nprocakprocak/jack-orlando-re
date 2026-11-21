# Pause and running in the background

Code: `packages/engine/src/pause/` (`settings.ts` the option, `policy.ts` the decision, `dom.ts` the browser wiring), `packages/engine/src/core/loop.ts` (`FrameInfo.elapsedMs`), `packages/engine/src/audio/webaudio.ts` (`setSuspended`).

## The original

The game has no pause option. Losing the window always stops everything ([architecture.md](architecture.md), the message loop): `WndProc` `00450d10` on `WM_ACTIVATE` (deactivation) calls `Timer_SetPaused(0)` (the 5 ms counter `g_ticks5ms` stands still), `Input_SetAcquired(0)`, and `Sound_SetPaused(0)` `004719a0` (every channel, including the movie's channel 1). `Sys_PumpMessages` `00451490` spins in `Sleep(10)` until activation. Minimizing (`WM_SIZE`) zeroes `g_appActive`. Time spent paused is not counted, because the clock is stopped. The game does not catch up frames.

`.AVX` movies (`Game_Run` `0043b81c`, `Media_Step` `00467c90`) time frames in `g_ticks5ms` ticks and correct against the sound position (`Media_QueueSound` `004678d0`, `syncAdjust` in `packages/engine/src/video/timing.ts`). When the sound runs ahead, the frame clock is pulled back by `|0xdc − lead|` per frame, so the picture **catches up**. A lateness above 600 ticks the original treats as missing data from the disc (`STALL_TICKS`). In the original the two clocks do not drift, because a pause stops both at once.

## What went wrong before the pause matched the sound

The focus handler stopped the loop on `blur`, but sound paused only on `visibilitychange` (a hidden tab), and `game.advance(dt)` (movies, transitions, music fades) measured `dt` from `performance.now()`. Coming back therefore delivered the whole paused interval at once. Losing focus with the window still visible left the movie picture frozen while the movie sound kept playing, and on return the picture caught up (`Media_QueueSound` plus a jump of the clock). `packages/engine/src/video/pause.test.ts` shows this.

## The option

This option is the engine's. The original has no equivalent.

| Source | Value | Meaning |
|---|---|---|
| `?pause=blur` / `?pause=never` | | wins over `localStorage`; any other value is ignored |
| `localStorage["jack-orlando.pauseOnBlur"]` | `"1"` / `"0"` | the start-screen switch |
| absent | `"1"` | pause by default, as in the original |

`readPauseOnBlur(search, storage)`, `writePauseOnBlur(storage, on)`. A `localStorage` that throws (a private window) counts as empty.

## Policy (`pauseReason`, `PauseController`)

Inputs: window focus, `document.hidden`, the option, and "the browser is throttling the page" (`ThrottleDetector`).

| State | Option on | Option off |
|---|---|---|
| focused, visible, regular `rAF` | playing | playing |
| unfocused, visible, regular `rAF` | **pause** (`blur`) | playing in the background (motion and sound) |
| hidden (`document.hidden`) | **pause** (`hidden`) | **pause** (`hidden`) |
| visible, but `rAF` throttled | **pause** (`throttled`) | **pause** (`throttled`) |

- A hidden page always pauses. `rAF` does not run there, so the picture would stand still while the sound kept playing.
- Throttling: 2 consecutive `rAF` gaps above 250 ms, or a watchdog (`setInterval` 250 ms) that sees no frame for more than 400 ms. The watchdog counts only when it itself arrived on time (the previous call ≤ 400 ms earlier). A long JavaScript task (loading a scene, a collection) delays `rAF` and timers together, and one long `rAF` gap is not enough. Tests: long tasks with focus do not pause. Throttling ends after 3 gaps of ≤ 50 ms in a row. Focus and showing the page clear the history.
- Throttling counts even with focus. A hidden application panel can be `visible` and focused while `rAF` runs at 1 Hz.
- At start the page counts as focused (as `bindFocus` does). A page opened without focus (an embedded preview) behaves like the original window, which starts active.

## A full pause, and no catch-up

`bindPause(window, document, loop, { pauseOnBlur, onChange })`:

- `loop.setActive(false)` (`EngineLoop`) stops the 5 ms counter, the 15 ms logic ticks (scripts, counters, animations, walking), frames, and drawing. Input is detached. After resume the first `step()` only starts the measurement again. The paused time is dropped. Nothing is caught up.
- `FrameInfo.elapsedMs` is game time since the previous frame: the time the loop consumed, without the pause and without what `maxStepMs` (100 ms) cut off. `game.advance(dt)` (`.AVX` and `.FCM` movies, transitions, the 14 ms music tick) should be fed this, not a `performance.now()` difference.
- `onChange(paused)` → `game.audio.mixer.setPaused(paused)` → `WebAudioBackend.setSuspended` → `AudioContext.suspend()` / `resume()`. Music, effects, speech, and movie sound (the movie sink ends at `backend.output`) stop on the same sample. `currentTime` stops too. An unlock gesture during the pause does not resume the context (`unlock()` checks the pause).
- A movie after resume: the frame clock (game time) and the sound position (`currentTime`) stopped together, so `syncAdjust` has nothing to correct. Frames come out at the same game-time moments as with no pause (`packages/engine/src/video/pause.test.ts`, a pause in 3 places in a movie). This matches the original.
- `suspend()` / `resume()` are asynchronous, on the order of a few milliseconds. For those milliseconds `WebAudioMovieSink.playedBytes()` returns `null` (the context is not `running`), so the movie follows the nominal clock. A difference under one frame is then corrected by `Media_QueueSound`, as in the original.

What a pause does not stop: the music stream has its own 50 ms `setInterval` (`startStream`), which keeps polling, but with `currentTime` stopped it adds nothing. Page CSS animations and the system cursor are not part of the game.

**Catch-up that remains, and matches the original:** until throttling is detected (at most about 0.5 s: a 250 ms watchdog plus a 400 ms threshold, or 2 `rAF` gaps), the loop gets at most 100 ms per step, and the sound keeps playing. The movie then catches the sound by that much (`Media_QueueSound`), a few frames faster. Removing that would mean jumping the movie picture to the sound position and skipping frames, and AVX deltas have to be decoded in order.

## Wiring

`bindPause` replaces a focus-only bind and a `visibilitychange` that only paused the mixer. The render path feeds `game.advance(info.elapsedMs)`. If the game is created while already paused, the mixer is paused after `PlayGame` is created. The start-screen switch calls `pause.setPauseOnBlur(on)` after `writePauseOnBlur`. `pause` is a page parameter, not a game variable.
