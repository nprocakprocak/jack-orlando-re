# Music (.PMS) — a stream on channel 5

Code: `packages/engine/src/audio/music.ts` (`PmsStream`, `MusicPlayer`). The mixer is `playStream` and `AudioBackend.startStream` in `packages/engine/src/audio/`. The channel mixer, volume curve, and pan are [audio.md](audio.md). The file format is [sound.md](../formats/sound.md).

## How the game plays music

- **Start:** `Music_Start` `0040bb60(path, name, ?, fade_in_step)` remembers the name (`DAT_0087123c`), calls `FUN_00473e90(5, file, 0, 0, 0x1016, 0xac44, 0)`, sets the volume to 0, and sets `DAT_008f692e = 1` (fade-in). `FUN_00473e90` accepts channels 4..6 (a busy channel is stopped), allocates a buffer of 0xac440 B plus a read buffer (`flags & 3` × 0xac00 × 3), opens the file, reads 0x18 B of codec header into the decoder state (`0xa005c0 + (6-channel)*0x48`), reads `0xac440/4` B of data, decodes it (`FUN_00471ee0` → `Ima_DecodeStereo` with `param_2 = 1`), then `Snd_PlayBuffer`.
- **Rate: 44100 Hz.** `0xac44` from the call reaches `Snd_PlayBuffer` as `rate` (the DirectSound format and `FUN_00470cc0`). Flags `0x1016`: 16-bit, stereo (`&3 = 2`), `4` = a stream from a file, `0x1000` = a rate change. The DirectSound buffer is 0xac440 B = **4.0 s**.
- **Refill:** the mixer thread calls `Snd_StreamPosTick` `00473200` every 50 ms (for channels 5 and 6 through `00474410`). When the play cursor has passed at least `0x15800` B (about 0.5 s; `(flags&3) * 0xac00`), it refills exactly that much (or twice that, when the lateness is more than 2 portions) through `FUN_00471b60`: it reads `n/4` B from the file and decodes into the buffer at the write cursor.
- **Loop:** `loop_start = loop_offset × 4` PCM bytes, `loop_length = unpacked − loop_start` (`FUN_00473e90`). At the end, `Snd_StreamPosTick` cuts the portion at the end of the data, rewinds the file (`FUN_00459090`, `loop_offset + 0x18`), and keeps filling from `loop_start`. The decoder itself saves the IMA state (predictors and indexes of both channels) at `pos == loop_offset` and restores it at `pos == packed_size`. **The wrap is a bit-exact repeat of the first pass**, with no damaged predictor. Checked on all 24 files.
- **`loop_offset == 0` means the whole piece loops** (18 of 24 files; non-zero: Tr13, Tr16, Tr17, Tr20, Tr202, Tr25). That differs from sound buffers (`loop_length 0` means no loop). For music, `loop_length = unpacked`. A file with no loop would be `loop_offset == packed_size` (`loop_length == 0`: the rest of the buffer is silence, and the channel ends with `Snd_EndChannel` after the data). No file is like that.
- **End / a new piece:** there is no queue. A new piece on channel 5 cuts the old one (`Snd_StopChannel` in `FUN_00473e90`). `Music_Stop` `0040bc00` is stop plus volume 0.
- Decoder state is global per channel (`0x48` B). There is no decoding on the game thread. In the engine, `PmsStream.read` decodes when the backend needs frames (a 4 s lookahead).

## Volume and fade (`Game_Tick14ms` `00426c10`, every 14 ms)

Variables: `DAT_007a8bf4` the current volume (game units; the channel level is ×2, `Sound_SetChannelVolume`), `DAT_007a8bf6` the step, `DAT_009fa962` the `MusicVol` option, `DAT_008f5dd0` the script multiplier (starts at 1.0), `DAT_00503b64` "there is sound". Branches, in order:

1. `DAT_008f692c == 1` (fade-out): `step == 0` or `volume − step < 1` → 0 and state 2; otherwise `−= step`.
2. `DAT_008f692e == 1` (fade-in): `step == 0` or `MusicVol × multiplier ≤ volume + step` → set `ftol(MusicVol × multiplier)` and finish; otherwise `+= step`.
3. `DAT_0071a16c == 1` and volume > 5 (duck down, `Music_DuckDown` `00402fb0`) → down toward `DAT_0065210c`.
4. `DAT_006d38d5 == 1` and volume > 5 (`Music_DuckUp` `004030a0`) → up toward `DAT_0065210c`.

Ducking works only with the option `MusDownOnOff` (`DAT_009fa96e`). The target `DAT_0065210c` is computed by floating-point code the recovered listing does not show (`ftol` with no argument). The engine receives it from the caller.

## Where music starts

| Place | What |
|---|---|
| Script command `MUSIC NAME-x n m` (opcode `0x3f` in [scripts.md](scripts.md), `case 0x3e` in `Script_ExecStep` `0041a330`; the opcode table is one higher than the case label) | `name`, fade-out step `n` = `[0x29]`, fade-in step `m` = `[0x2a]`. The same name as the current piece does nothing. A different name: when the fade-out step is not 0 and no fade is running, it starts a fade-out and **repeats the command** (`PC −= 1`) until the fade ends (state 2); then `Music_Start`. When there is no sound (`g_config == 0` / `DAT_00503b64 == 0`) it only remembers the name. This is `MusicPlayer.command`. |
| `FUN_00406420` (hypothesis: scene load; the caller was not found) | when the scene's music name (`DAT_005640c8`) differs from the current one: `Music_Start(name, 0, 1)` — fade-in step 1. |
| `FUN_0040a0b0` (options) | `MusicVol` < 5 → `Music_Stop` plus muted; above 5 after a mute → start the current piece (or `TR02-22.PMS` when the name is the marker at `004f7194`). This is `MusicPlayer.setMusicVolume`. |
| `Game_Run` `0042b6d0` | when `DAT_008f6914 != 0`: `Music_Start(…"TR02-22.PMS")` — the default piece at the start of the game. The condition was not fully traced. |
| `Music_Stop` `0040bc00` | called from `Script_ExecStep`, `Game_Run`, `FUN_00409090`, and the options. What the script side does was not fully traced. |
| `Launcher_PlayIntro` → `FUN_0046a240` | launcher and intro music: `FUN_00473e90(5, file, 0, 0, 0x1016, 0xac44, 0x7f)` and a fade-in loop on the calling thread (`Timer_Sleep(10)`). |

The file path is `MUSIC\` plus the name (`FUN_00406380`).

## A new piece has no audible fade-in

`Music_Start` `0040bb60` starts the stream silent (`Snd_SetVolume(5, 0)`), stores `m` as the step (`DAT_007a8bf6`), and sets `DAT_008f692e = 1`. The **initial value of `DAT_007a8bf4` is not 0**. The recovered listing drops the argument of `__ftol()`. The bytes (`66 a1 62 a9 9f 00 89 45 bc db 45 bc d8 0d d0 5d 8f 00 e8 .. 66 a3 f4 8b 7a 00`) are `fild MusicVol; fmul [0x8f5dd0]; call __ftol; mov [0x7a8bf4], ax`, that is `ftol(MusicVol × multiplier)` = the full target. The first tick of `Game_Tick14ms` (the fade-in branch: `target <= volume + step`) therefore sets the full level at once. A new piece is silent for at most 14 ms and then plays **with no audible fade-in**, whatever `m` is (0, 1, or 2). That matches play. An earlier reading, and the engine, assumed a start from 0 and a rise of about 0.5 s. `MusicPlayer.play` sets `volume = trunc(MusicVol × scale)`. The same `Music_Start` handles loading a save.

**Fade-out** of the old piece is real. The start (`Script_ExecStep` `case 0x3e`, `DAT_007a8bf4 = __ftol()`; the bytes at `0x41f267` are the same `MusicVol × multiplier` pattern) and steps of `n` per 14 ms tick (for example 35 → 0 is about 0.5 s at step 1). Values of `n` in the 43 scene `MUSIC` commands: 1 (24 times), 2 (18 times), 0 (once, `SC001`). Values of `m`: 1 (40 times), 2 (twice), 0 (once, `TR29`).

The fade-out steps are linear in game units, and `Snd_SetVolume` is logarithmic (level 70 is about −9.5 dB, level 10 is −34 dB, level 2 is −66 dB), so the first ticks are what you hear. The music disappears much faster than a linear 0.5 s. That is the observation that music at the end of a scene goes quiet very quickly. The engine adds nothing beyond that curve. See [audio.md](audio.md).

## The loop seam

A listener does not hear a click at the loop. The code matches the engine's model: `loop_offset` is in source bytes (`e0 = loop_offset·4` PCM bytes, seek `+0x18`), the IMA state is saved **before** the group at `loop_offset`, and the tail up to `unpacked_size` is filled in full. Pieces with a large jump (Tr205: the end is about 0, the loop start is about 6107, RMS of the first 0.2 s is about 9600; Tr22: the end is silence, the start is 1484 at RMS 11100) end in silence or a quiet tail and start with a loud attack. That is an ordinary start of the sound, not a click in a continuous signal (hence predictor values in the header on the order of thousands). The jump is in the data, masked by the music. The engine changes nothing. The tempo is the 44100 Hz from the code.

## What the engine matches

- `PmsStream` plays the decoder's loop (state saved and restored), not a refill in portions. The stream of frames is the same, because each refill is a continuous fragment. The portion size and the 4 s buffer in `WebAudioBackend.startStream` match the constants from the executable (50 ms / 0.5 s / 4 s).
- `MusicPlayer.tick14ms` sets `volume = target` when the fade-in reaches the target. The executable leaves `DAT_007a8bf4` at the last value (inaudible, and it matters only for ducking after a fade-in with step 0).
- The initial value of `DAT_007a8bf4` after `Music_Start` is `ftol(MusicVol × multiplier)`. The channel starts silent (`Snd_SetVolume(5, 0)`) until the first tick. The engine does the same.
- The loop seam: the decoder itself is seamless, but a few pieces jump where the end meets `loop_start`.

## Night music after the beating (SC005B → SC007 → SC008)

After the beating, night music used to start later in the engine than in the original. `Game_Run` `0042c836`…`0042c86d` runs `[PRE]` in a loop `while (macroActive[g_macroStarted]) Script_ExecStep(g_macroStarted)` (bytes `66 a1 78 f6 88 00 50 e8`: `mov ax,[0x88f678]; push eax; call` — the index is read again on every iteration). `Script_FindMacro` `0040d8b0` sets `g_macroStarted` (`0x88f678`) on **every** macro start (`-1` when there is no macro). `SC008 [PRE]` ends (`LAST = 7`) with `ACTIVEMACRO MUS20` (`MUSIC TR20-22.PMS 1 1`), so the loop moves on to `MUS20` and runs it **in full before `Scene_RefreshBackground`** `0040dff0` (the day-to-night dissolve, about 3.4 s, logic stopped). The old piece (`TR22`, from `SC005B`) fades out (about 0.5 s; `Game_Tick14ms` keeps running in the background — the caller was not found — and the loop repeats the command until the fade ends), `TR20` starts, and only then does the dissolve start. The rest of `[PRE]` (empty here) stays active and runs in the frames. The engine used to start `MUS20` as an ordinary macro in the frames, only after the dissolve (logic is stopped in the `fading` phase), so the night piece came in about 3.4 s plus a 0.5 s fade-out later, and the day piece played through the whole dissolve.

The fix: `Interpreter.runSynchronous` loops on the "most recently started macro" (as `g_macroStarted`; a missing macro ends the loop), and the `MUSIC` command in synchronous mode (`SceneHost`, `ctx.synchronous`) runs the fade-out ticks at once. The one departure: in the original the fade-out takes about 0.5 s of real time before the dissolve. The engine has no clock in the `[PRE]` loop, so the old piece is cut. The new piece starts at once at full volume, as in the original (there is no fade-in). Removing the departure would need a clock in the `[PRE]` loop (`packages/engine/src/play/game.ts`). It applies to every scene with `ACTIVEMACRO` in `[PRE]` (SC005B `MUS22`, SC009 `MUS26` / `30` / `17`). Tests: `packages/engine/src/play/game.test.ts`, `packages/engine/src/script/interpreter.test.ts`.

## Loading a save

`Save_LoadState` `00409090` reads the saved piece's name into `0x5640c8`. If it differs from the current one (`0x87123c`) it calls `Music_Stop`. The new piece starts only in `Scene_SetNumberAndMapFlag` `00406420` when the saved scene loads (`g_gameLoaded`): `Music_BuildPath` plus `Music_Start(name, fade-in step 1)`, before `PRE` / `INIT`, so a later `MUSIC` in the scene is already compared with the saved name. The same piece does nothing. It keeps playing. In the engine (`MusicPlayer.loadSaved` / `startSaved`, `PlayGame.applyLoaded` plus `enter`): `applyLoaded` used to only stop the music and leave the old name, and the piece was supposed to start on the scene's `MUSIC` command. If the saved scene has none (the arrest motif from SC026 arrives through an earlier scene), the result was silence, and loading that same piece again saw "the same name" and also played nothing. The saved piece now plays at once at full volume (`Music_Start`; there is no fade-in), and the old one is cut (`Music_Stop`). The name switches at once, and the file is loaded and started before the scene scripts. Tests: `packages/engine/src/audio/musicload.test.ts`.
