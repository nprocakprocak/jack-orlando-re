# Sound core

A channel mixer on Web Audio. The logic (`mixer.ts`, `prepare.ts`) does not know the DOM or Web Audio. It talks to them through `AudioBackend` (`types.ts`). `webaudio.ts` is the only browser implementation; tests use a fake.

## API

```ts
const backend = new WebAudioBackend(); backend.unlockOnGesture();   // AudioContext after a gesture
const mixer = new Mixer(backend);
const p = mixer.play(ch, prepareSound(new Sound(bytes, "S22")), { volume: gameVolumeToLevel(30) });
await p?.ended;                 // "finished" | "stopped" | "replaced"
mixer.onEnd(e => ...);          // WAITWHILEEFFECT: e.channel / e.reason
await mixer.whenIdle(ch);
mixer.setChannelVolume(5, lvl); // music fade (Game_Tick14ms), only on a channel that is playing
mixer.stop(ch); mixer.stopAll(); mixer.setPaused(true); mixer.setMasterVolume(0.5);
```

- **Music:** `mixer.playStream(5, new PmsStream(bytes), { volume: 0 })` — an incremental stream (`StreamSource` → `AudioBackend.startStream`, queued in Web Audio with 4 s of lookahead every 50 ms). Usually through `MusicPlayer` (`music.ts`): fade in/out every 14 ms (`tick14ms`), script command `0x3e` (`command`), option `MusicVol`.
- **Film:** the film's sound on any free channel, or its own source. `mixer.setPaused` freezes every channel.
- Volume: `play({volume})` and `setChannelVolume` take a **level 0..127**. Game functions take a "game volume" and multiply by 2 (`gameVolumeToLevel`).

## The original mixer

- `Sound_Init`: 7 channel structures of `0x9c` bytes, and a `Sound_MixerTick` thread every 50 ms. Playback is allowed only on channels **1–6** (`Snd_PlayBuffer` returns 1 for any other channel, and also when DirectSound is missing or the size is 0). Channel 0 is not used for playback.
- **A busy channel:** `Snd_PlayBuffer` stops and releases the previous buffer, zeroes the structure, and creates a new buffer. The new sound **interrupts** the previous one. There is no queue and no search for a free channel — the caller picks the channel.
- DirectSound buffer: 16 bit, 22050 Hz, mono, `0x15888` bytes (2 s). Longer sounds and stereo music (`0x2b110` bytes) are topped up from the mixer thread (channels with status `0x40`; channels 5 and 6 also get a second stream with its own pointer — a hypothesis: ADPCM decoded on the fly for music).
- **The end:** the refill counts bytes from the start. With the flag `0x100` (remaining-byte counter at `+0x4c`), running out stops the buffer, clears flags `0x40`/`0x100`, and frees the memory. A loop (`loop_length != 0`) returns to `loop_start` (`Snd_StreamFill`). The channel structure also has 8 position points with callbacks (flag `0x20`). None of the known paths in the game use them, and they are not reproduced.
- **Volume:** `Snd_PlaySound` / `Sound_SetChannelVolume` do `volume << 1`. `Snd_SetVolume` clamps to `0x7f`. `<= 0` becomes `-10000` (silence). Otherwise `IDirectSoundBuffer::SetVolume` gets hundredths of a decibel from `1600.0 · ln(v · 0.007874)`. `levelToGain` = `10^(mB/2000)` — a logarithmic curve, not a linear one. The executable has no separate master volume beyond the channel levels. `setMasterVolume` is an addition of this engine.
- **Pan:** `Snd_PlaySound` sets `pan = 0` for channels 1 and 3 and `0xff` for 2 and 4. For 5 and 6 the variable is **uninitialised** (a bug of the original: a leftover stack value). `0x80` is the centre, and the values are symmetric around `0x80`. Channel 1 is left and 2 is right: every `TALK LEFT` in the scene scripts uses channel 1, and every `TALK RIGHT` uses channel 2 (dialogues: `LEFT` → channel 1, otherwise 2), and the line is heard on the side of the speaking portrait. Channels 3 and 4 use the same pan values as 1 and 2 (a hypothesis: also left/right). The engine centres 5 and 6. That is why the "channel 0" effect (`Sound_PlayIndexed` plays twice, on 1 and 2) sounds stereo.
- `Sound_SetPaused`: `0` stops every channel (a flag that turns the mixer ticks off), `1`/`2` resume.
- The original reports DirectSound errors with `MessageBoxA` ("DSERR_BUFFERLOST", "unlock err").

## Left out or simplified

Buffer refill (the engine plays a finished `AudioBuffer`), flags `0x400`/`0x800`/`0x1000` (DirectSound frequency and pan controls), the frequency shift (always 22050), and the position callbacks.

## Music stereo

`WebAudioBackend` has a separate music bus: the stream (`startStream` — music only) → `musicBus` → `stereoFx` (`StereoOptions`, `settings/stereo.ts`) → `master`. Effects (`start`) go straight to `master`. `Snd_CopyStereo` runs only on channels with the stereo flag (`& 2`); effects and speech are mono. `backend.stereoFx.update(surround, reverse)`. The host assigns `backend.stereoFx` to `game.audio.stereoFx`; `applyConfig` applies the options from the start. Pause (`suspend` of the context) and `setMasterGain` work as before.
