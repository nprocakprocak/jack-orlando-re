# Sound in the scene scripts

Code: `packages/engine/src/sfx/` (`SfxPlayer`, `SceneSounds`). The mixer is `packages/engine/src/audio/` ([audio.md](audio.md)). Music is [music.md](music.md). The sound format is [sound.md](../formats/sound.md). The commands are in [scripts.md](scripts.md).

## Where the sounds come from: the scene list

`Sound_LoadSceneSfx` `0044ad00` reads the name list `<scene>.SSD` from the scene archive (encrypted text). For each name it loads **`<name>.PSD`** (IMA ADPCM, type `0x32`), decodes it (`Sound_Unpack`), and keeps the buffer in `0x7b3a90[i]`. The name goes back to the `.SND` form and into `0x7c73a0[i]` (14 bytes). It also finds `KROK1.SND` and `KROK2.SND` (`g_sndStep1/2`, default −1). In the scripts a sound is an **index on this list**, looked up by name (`Sound_FindSceneSfx` `00407b30`, `strcmp`, the first match, −1 when missing). Index −1 is silently ignored by `Sound_PlayIndexed`. In the data, every SSD entry of every scene has a `.PSD` in the same PHK, and every `EFFECT` / `EFFECTVOLUME` / `WALKEFFECT` / `ANIMAEFFECT` / `WAITWHILEEFFECT` names a sound from its own scene's list. Speech (`.S22`, `TALK`) is a separate path (`Sound_PlayTalk` `00407750`) and does not use this list.

The engine: `loadSceneSounds(ssd, readPsd)` → `SceneSounds` (`names`, `sounds`, `find`, `step1/2`). `SfxPlayer.loadScene(bank)` sets the list and clears the scene tables.

## One entry: `Sound_PlayIndexed` `004075d0(channel, sound, volume, flag)`

Everything that plays an effect in the scripts (`EFFECT`, `ANIMAEFFECT`, `.ICS` frames, footsteps) ends here.

1. Nothing happens when the sound index is below 0, sound is off in the machine (`0x851d58`, set from `0x898102` in `Game_Run`), or **the volume is above 64** (an unsigned 16-bit compare, so a negative value also drops out). The engine: `playIndexed`.
2. The volume is doubled (still ≤ 64). A channel ≥ 11 becomes `channel − 10`, that exact channel, and a **reservation** (`0x722f64[channel] = 1`). A channel ≤ 10 goes to `FUN_00407050`, which picks a free channel (below).
3. The final volume is `volume · SFXVol / 64` (the option `SFXVol` from `0x9fa964`, default `0x20`, range 0..64). `Snd_PlaySound` doubles it and clamps to 127 (`gameVolumeToLevel`). At the default SFXVol a script volume of 32 gives level 64 of 127.
4. The logical channel becomes the physical one through `FUN_00402e60`: with the option `RevStereoOnOff` (`0x9fa968`) the pairs 1↔2, 3↔4, and 5↔6 are swapped. Then `Snd_PlaySound`: a busy channel is interrupted.
5. It remembers `0x871390[sound] = channel` (the **logical** channel), `0x88f214[channel] = sound`, `0x723c10[channel] = volume`.

### Choosing a channel (`FUN_00407050`): the channel in the script is only a wish

A request for channel 1 or 3 walks the order **1, 3, 2, 4**. Any other request (2, 4, 5…10) walks **2, 4, 1, 3** (tables `0x503ba4`, `0x503ba8`). The first channel that is not playing (buffer status 0x40), is not reserved (`0x722f64`), is not carrying speech (`0x85e034`, set by `Sound_PlayTalk` and cleared by `Talk_FaceStep`), or has the pair marker (`0x88f634`) is chosen. When nothing fits, the requested channel is kept and whatever is playing on it is interrupted. Then, if the result is reserved or is speaking, it is swapped for the first unreserved and non-speaking channel on the same list. **An `EFFECT` on channel 4 therefore plays on 2 when 2 is free.** Channels 5–10 also land in 1–4 (channel 5 is the music, but it is never chosen here while any of 1–4 is free). Only channels 11–14 are distinguished exactly, and they become 1–4. A reservation (channels 11–14; in the scripts: 13 ×45, 14 ×58, 11 ×10, 12 ×6) keeps the channel out of allocation until `UNLOCKCANAL n` (`0x86`, unused in the data), the channel stops playing (`FUN_0042b070`, once per pass of `Game_Run`, channels 1–4), or the scene starts (`Game_Run` `0042b6d0` clears the reservations and the speech marks of 1–4).

Flag **1** (footsteps) changes two things. When nothing better than the request was found, **nothing plays** (a step interrupts nothing), and the chosen channel gets the pair marker (`0x88f634`), which is not cleared (flag 0 clears the marker on selection). The other half of the pair (left and right) can then take the same channel. What the marker was for is a hypothesis.

## A scene change stops channels 1–4

The end of `Scene_Load` `0044ba80` (after `Scene_LoadAci`) calls `Snd_StopChannel(1..4)`. That is why an `EFFECT` loop (the snoring in `SC044`) goes quiet on leaving the scene. Channels 5 and up (the music) stay. It is also called for the first scene, with no effect. The engine: `SfxPlayer.loadScene` stops channels 1–4 in the mixer and clears the record of which sound is playing on which channel. Other loops started from macros take the same path. The only stop is per channel, not per sound.

## Commands (`Script_ExecStep`, `case = code − 1`)

| Command | What it does |
|---|---|
| `EFFECT sound channel _ volume` (0x1e, case `0x1d`) | `a[0]` is the channel, `a[1]` the sound index, `a[2]` the volume (the compiler copies `a[3]` into `a[2]`). Channel 0 calls `Sound_PlayIndexed(1)` and then `(2)` at the same volume (stereo with no pan). Otherwise one call (flag 0). The volume can also come from a variable (`ctx.arg`) |
| `EFFECTVOLUME sound _ volume` (0x20, case `0x1f`, `0041cbf0`) | `a[0]` is the volume, `a[1]` the sound. Volume 0 calls `Snd_StopChannel` of the sound's channel. Otherwise `Sound_SetChannelVolume(channel, volume)` (doubled, up to 127; **without** SFXVol and without the limit of 64). The channel comes from `0x871390`. It does not check that the sound is still playing there. One use in the data |
| `WAITWHILEEFFECT sound` (0x67, case `0x66`) | When sound is on: `ch = 0x871390[sound]`. If the physical channel is playing **and** `0x88f214[ch] == sound`, the macro's counter is decremented (the command repeats on the next tick). It ends when the sound reaches the end, or when another sound takes the channel, or when the channel is interrupted. With sound off it does not wait. There is no time limit |
| `UNLOCKCANAL n` (0x86, case `0x85`) | `0x722f64[n] = 0` |
| `WALKEFFECT person frame sound …` (0x42, case `0x41`) | **a registration**. The sound plays later |
| `ANIMAEFFECT anim picture channel sound …` (0x54, case `0x53`) | **a registration** |
| `MUSIC`, `MUSICVOLUME` | already in `MusicPlayer.command`. The host calls them the same way as the commands here |

`SfxPlayer.command(cmd, env)` runs `EFFECT`, `EFFECTVOLUME`, `WAITWHILEEFFECT` (a result of `"repeat"` means wait), `UNLOCKCANAL`, `WALKEFFECT`, and `ANIMAEFFECT` (other codes return `undefined`). `env` supplies person and animation indexes and the argument values (variables).

### `WALKEFFECT`: a step sound on a walk frame

- **Jack** (`a[3] == 0x66`): `WALKEFFECT JACK <0|1> sound` sets `g_sndStep1` (when `a[0] == 0`) or `g_sndStep2` (otherwise). 34 such lines in the data (0 and 1, 17 times each).
- **Another person**: `WALKEFFECT person frame sound n1 n2 n5`. The frame is `a[0]` (0..17). `a[1]` is stored in `0x6d5fb0` and **never read**. `a[2]` is the **switch**: ≥ 1 stores the sound (`0x8713f8[person·18+frame]`) and the volume `a[5]`; ≤ 0 clears it (−1). In the data (160 lines) `a[1]` is in {1, 2, 3, 4, 11, 12, 13}. It looks like a channel number, but steps always play as the pair 1+2. `a[2]` equals `a[5]` in 121 lines (for example 64/64, 20/20, 0/0). In the rest they differ. The tables are 17 persons × 18 frames, cleared at the start of the scene. **Sound index 0 is a sound.** The switch is `a[2]` (`< 1` clears). The index itself is `a[3]` in the disassembly. In SC001 `KROK1.SND` is the first entry of the list (index 0), used by POL2 and the inspector. A `persons` module that treated `sound < 1` as "off" made those steps silent. POL1 had `KROK1L` / `KROK1P` at indexes 2 and 3 and did play. Two persons stepping in one frame: below.
- **Playing** (`Game_Run` `0043487b`, when a person's walk frame is shown): a pair of `Sound_PlayIndexed` with flag 1. Channel 1 gets `volume·scale·(640 − x + scroll)/(scroll + 640)`. Channel 2 gets `volume·scale·x/(scroll + 640)` (`scale` is `g_personScale`, `x` is `g_personX`, `scroll` is `0x8f690c`, truncated like `__ftol`). `SfxPlayer.walkStep`.
- **Jack's steps**: `Jack_PlayStep` `00427a10(scale)`. The sound is `g_sndStep2`, then `g_sndStep1`, alternating (`g_stepToggle`; at the start of a scene it is 0, so it starts with `KROK2`). A pair with flag 1, channel 2 then 1, volume `64·scale` split the same way (`g_jackX`). Called when Jack's walk frame is **0** (`KROK1` is set) or **6** (`KROK2` is set) (`Game_Run` `00431c6d`), and once in mode 2 (`004311da`, scale/2, flag `0x7c7a50`). `SfxPlayer.jackStep`, `jackStepFrame`.
- The pan divides the world x by `scroll + 640`. In a scrolled scene the sound leans to the **right** (at the left edge of the screen, `x = scroll`, the right channel gets `scroll/(scroll+640)` instead of 0; the middle of the screen is already above 0.5; only the right edge is correct). The sign and `x` as a world coordinate were checked on the disassembly of `00427a10` and `004348bb`. Play matches the formula: steps are heard a little in the right speaker even at the left edge, and Jack at the left edge sounds different when the screen is scrolled right than when it is scrolled left. At `scroll = 0` it is correct.
- **Two persons at once.** The pair marker (`0x88f634`) after one person's step makes channels 1 and 2 "available" even while they are playing, so the second person's step in the same window **cuts** the first instead of going to 3 and 4 (`00407050`). The engine keeps this. In SC001 the policemen rarely land on the same frame (steps about every 32 ticks, POL1 and POL2 offset).

### `ANIMAEFFECT`: a sound on an animation picture

`ANIMAEFFECT anim picture channel sound …` (up to 30 entries per animation, with no range check): `a[0]` is the picture number, `a[1]` the channel (0 means 1 and 2), `a[3]` the animation, `a[4]` the sound, `a[5]` the REC sequence, `a[6]` the volume (`a[2] == a[6]`). On every change of an object's animation frame (`Game_Run` `00436555`, on the tick when the delay counter reaches 0) `DAT_006da430` is the current picture number (modes 1 and 2: `g_objAnimImage`; otherwise the position from `g_objAnimRecPos` / `0x871ad4`). The **first** entry with that picture and the sequence `g_objAnimRec[anim]` is played through `Sound_PlayIndexed` like `EFFECT` (channel 0 → 1 and 2, otherwise one call), and the search stops. `SfxPlayer.animFrameShown(anim, image, rec)`. The host calls it when the frame changes. For REC modes `image` should be the same number as `0x6da430`. The exact definition of the number in REC and FLX modes is a hypothesis.

### Insertion frames (`.ICS`)

The frame fields ([global.md](../formats/global.md): effect `+0x1c`, channel `+0x1e`, volume `+0x20`): at the start of an insertion frame (`Game_Run` `00432951`, `00434922`, and the rest) if the effect is ≥ 0, channel 0 calls `Sound_PlayIndexed(1)` and `(2)`, otherwise one call (flag 0). `SfxPlayer.insertionFrame(sound, channel, volume)`. A scene frame's sound name comes from the SSD list. A global one comes from `GLOBAL.PAK`.

### Reservation and interrupts (ambient on channels 11–14)

An effect on channel 11–14 keeps the channel out of allocation. `FUN_00407050` skips reserved channels, and a reserved result is swapped for an unreserved one, so **steps and `EFFECT` on channels ≤ 10 do not interrupt that sound**. Only the next effect on the same channel 11–14 interrupts it (usually on purpose: the script turns the sound off that way), or speech in the extreme case (`Sound_PlayTalk` uses its own choice `00407480`; when neither channel of the pair is free, the requested channel is kept: 1 or 2). Example: **SC044**. `EFFECT 044-02.SND 14 0 30 30` (5 s, channel 4) plays when the drunk falls asleep. `EFFECT 044-02.SND 14` with no volume cuts it (volume 0 on the same channel), and the drunk's `ANIMAEFFECT … 14` (`044-01A/B/C`, `044-03`) also plays on channel 4. Play matches: the footsteps do not interrupt the snoring, and talking to him does, because the talk macros play the same effect at volume 0. Ambient sounds with a reservation are not interrupted by walking.

## Wiring in the host

```ts
const sfx = new SfxPlayer(mixer, { sfxVolume, swapChannels });
sfx.loadScene(loadSceneSounds(ssdBytes, (f) => pak.read(f)));
// script commands: sfx.command(cmd, { person, anim, arg }) → "done" | "repeat" | undefined
// MUSIC / MUSICVOLUME → MusicPlayer.command
// every pass: sfx.tick()
// a walk: sfx.walkStep(person, frame, scale, x, scroll)
// Jack: if (sfx.jackStepFrame(f)) sfx.jackStep(scale, jackX, scroll)
// object animations: sfx.animFrameShown(anim, picture, rec)
// insertions: sfx.insertionFrame(sound, channel, volume)
// speech: sfx.setTalkChannel(channel, true or false)
```

## The sea noise in SC094, the quietest sound in the game

`[MORZE]` (`ACTIVEMACRO` from `[INIT]` of SC094 and SC089): `EFFECT PORT.SND 13 0 1 1` and `14`, channels 3 and 4, script volume **1** in SC094 (4 in SC089). The macro starts, `EFFECT` reaches `playIndexed`, and `PORT.SND` (a loop of the whole buffer, `loopLength` 206160) plays on channels 3 and 4 for the whole stay in the scene and is not interrupted. The hypothesis that "volume 1 rounds to zero" is wrong (`004075d0`): `1·2 = 2`, `2·SFXVol(32)/64 = 1` (`>> 6`), `Snd_PlaySound` shifts left by 1, and the level is **2** (with `SFXVol` ≥ 32; only `SFXVol` below 32 gives 0, the same in the executable). SC094 is the only scene with an `EFFECT` of volume 1. Volume 2 belongs only to `MEWY.SND` (SC089, SC094) and `095-02.SND` (SC095).

Where the silence comes from: level 2 is **very** little in the executable. `Snd_SetVolume` `00470c10` computes the DirectSound attenuation as `__ftol(1600.0 · ln(level · 0.007874))` hundredths of a dB. The bytes: `fild [ebp+0xc]`, `fmul qword [0x4fdba8]` = **0.007874** (not exactly 1/127), `FUN_004899e4` is `ln` (`fldln2; fxch; fyl2x`), `fmul qword [0x4fdb98]` = **1600.0**, `__ftol` (truncation toward zero). A level above 0x7f becomes 0x7f. A level below 1 becomes −10000 (`0xffffd8f0`, silence). The table: level 1 → −7750, 2 → −6641 (**−66 dB**), 8 → −4423 (−44 dB), 64 → −1096, 126 → −12, 127 → 0.

`levelToGain` (`packages/engine/src/audio/mixer.ts`) is `10^(mB/2000)`. `levelToAttenuation` gives hundredths of a dB. Before that change the curve was linear (level 2 → −36 dB, 8 → −24 dB, louder than the executable).

Everyone goes through `Snd_SetVolume` (`Music_Start`, `Music_Stop`, the launcher's start and fade, `Media_DecodeVideo`, `Media_Step`, `Snd_PlayBuffer`, `Sound_SetChannelVolume`), so **one curve** serves the effects, the dialogue voices (channels 1–4), the `.PMS` music (channel 5; `Mixer` → `levelToGain`), and the movie sound (channel 1, `packages/engine/src/video/audio.ts` → `levelToGain`). The option sliders (SFXVol, music) are unchanged. Only the mapping from level to gain changes. The audible effect: quiet sounds (the sea in SC094) and low music levels during a fade are quieter than a linear curve.

## Departures

- The mixer plays finished buffers. DirectSound `GetStatus` is replaced by `Mixer.isPlaying`, so the "end" of a sound is immediate at the end of the samples (the original: up to 50 ms later, the mixer thread).
- Effects on channels 5–6 (only 1–4 are the default targets): if nothing in 1–4 is free, a request for 5 or 6 plays on 5 or 6, as in the original (and it would interrupt the music on 5; it does not occur in the data).
- A volume change from `EFFECTVOLUME` works only on a channel that is playing (`Mixer.setChannelVolume`).

## Not settled

The pan of steps in a scrolled scene is the formula above. Whether an `EFFECT` on channel 3 or 4 is actually heard on the left or the right, matching the selection lists, was not checked by ear.
