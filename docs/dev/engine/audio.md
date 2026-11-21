# The sound mixer

`packages/engine/src/audio/` is the channel mixer. `mixer.ts` and `prepare.ts` know neither the DOM nor Web Audio. They talk to them through `AudioBackend` (`types.ts`). `webaudio.ts` is the only browser implementation. Tests use a stand-in.

```ts
const backend = new WebAudioBackend(); backend.unlockOnGesture(); // AudioContext after a gesture
const mixer = new Mixer(backend);
const p = mixer.play(ch, prepareSound(new Sound(bytes, "S22")), { volume: gameVolumeToLevel(30) });
await p?.ended; // "finished" | "stopped" | "replaced"
mixer.onEnd(e => ...); // WAITWHILEEFFECT: e.channel / e.reason
await mixer.whenIdle(ch);
mixer.setChannelVolume(5, lvl); // a music fade (Game_Tick14ms), only on a channel that is playing
mixer.stop(ch); mixer.stopAll(); mixer.setPaused(true); mixer.setMasterVolume(0.5);
```

- **Music:** `mixer.playStream(5, new PmsStream(bytes), { volume: 0 })` is an incremental stream (`StreamSource` → `AudioBackend.startStream`, queued in Web Audio with 4 s of lookahead every 50 ms). Usually through `MusicPlayer` (`music.ts`): fade in and out every 14 ms (`tick14ms`), script command `0x3e` (`command`), the `MusicVol` option. See [music.md](music.md).
- **A movie:** movie sound on any free channel, or its own source. `mixer.setPaused` freezes every channel. See [video.md](video.md).
- Volume: `play({volume})` and `setChannelVolume` take a **level 0..127**. Game functions take a "game volume" and multiply by 2 (`gameVolumeToLevel`).

## The original mixer

- `Sound_Init` `00474500`: 7 channel structures of `0x9c` B from `0xa00668`, thread `Sound_MixerTick` `00474470` every 50 ms. Playback is allowed only on channels **1–6** (`Snd_PlayBuffer` `004738d0` returns 1, an error, for the others, and also when DirectSound is missing or the size is 0). Channel 0 is not for playback.
- **A busy channel:** `Snd_PlayBuffer` calls `FUN_00471950` → `FUN_00471800` (Stop, release the buffer, zero the structure) and creates a new buffer. A new sound **cuts** the previous one. There is no queue and no search for a free channel. The caller picks the channel.
- The DirectSound buffer is 16-bit, 22050 Hz, mono, `0x15888` B (2 s). Longer sounds and stereo music (`0x2b110` B) are refilled by `FUN_00471fe0` from the mixer thread (channels with status `0x40`; channels 5 and 6 also through `FUN_00474410` → `FUN_00473200`, a second stream with its own pointer — decoding ADPCM on the fly for music).
- **The end:** `FUN_00471fe0` counts bytes from the start. With flag `0x100` (the remaining-byte counter at `+0x4c`), when it runs out it calls `FUN_00472b20` (Stop, clear flags `0x40` / `0x100`, free the memory). A loop: `loop_length != 0` returns to `loop_start` (`Snd_StreamFill`). A channel structure also has 8 position points with callbacks (flag `0x20`). They are unused on the paths known here, and they are not reproduced.
- **Volume:** `Snd_PlaySound` / `Sound_SetChannelVolume` do `volume << 1`. `Snd_SetVolume` `00470c10` clamps to `0x7f`. `<= 0` becomes `-10000` (silence). Otherwise `IDirectSoundBuffer::SetVolume(__ftol(1600.0 · ln(v · 0.007874)))` (hundredths of a dB; the executable bytes were checked). `levelToGain` = `10^(mB/2000)`, a logarithmic curve, not a linear one. The executable has no separate master volume beyond the channel levels. `setMasterVolume` is an addition of the engine.
- **Pan:** `Snd_PlaySound` gives `pan = 0` for channels 1 and 3, and `0xff` for 2 and 4. For channels 5 and 6 the variable is **uninitialized** (an original bug, a leftover from the stack). `FUN_00470af0`: `0x80` is the center, values symmetric around `0x80`. Channel 1 is left and channel 2 is right. All 2930 `TALK LEFT` in the scene scripts use channel 1, and 2503 `TALK RIGHT` use channel 2 (dialogue: `LEFT` → channel 1, otherwise 2), and a line is heard on the side of the speaker's portrait. Channels 3 and 4 have the same pan values as 1 and 2 (likely also left and right). The engine centers 5 and 6. That is why a "channel 0" effect (`Sound_PlayIndexed` plays twice, on 1 and 2) sounds stereo.
- `Sound_SetPaused` `004719a0`: `0` stops every channel (it sets `DAT_00a00ab4`, which turns the mixer ticks off). `1` and `2` resume.
- DirectSound errors are reported with `MessageBoxA` (`"DSERR_BUFFERLOST"`, `"unlock err"`).

## Left out

Buffer refill (the engine plays a finished `AudioBuffer`), flags `0x400` / `0x800` / `0x1000` (frequency and pan controls), the frequency offset (`FUN_00470cc0`, always 22050), and the position points with callbacks.

## Music stereo

`WebAudioBackend` has a separate music bus. A stream (`startStream`, music only) goes to `musicBus`, then `stereoFx` (`StereoOptions`, `packages/engine/src/settings/stereo.ts`), then `master`. Effects (`start`) go straight to `master`. `Snd_CopyStereo` `00471430` runs only on channels with the stereo flag (`& 2`). Effects and speech are mono ([gui.md](gui.md)). `backend.stereoFx.update(surround, reverse)`. The game applies the options from the start. A pause (`suspend` of the context) and `setMasterGain` work as before. "Pseudo surround" and the stereo swap are applied from the start in the engine. In the original they take effect only after a toggle in the session.
