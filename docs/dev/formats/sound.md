# Sound: .SND, .S16, .S22, .PSD

Parser: `packages/engine/src/formats/sound.ts` (`Sound`, `decodeIma`, `decodeGsm`, `SOUND_RATE`, `TYPE_IMA_MONO`, `TYPE_IMA_STEREO`, `TYPE_GSM8`, `TYPE_GSM16`). Confirmed on all 12 files in `GLOBAL.PAK` / `RESOURCE.PAK` and all 8771 sounds in the scene archives. The GSM decoder matches Microsoft GSM 6.10 (WAV49 framing) on every `.S22` in `GLOBAL.PAK`.

## Where the sounds are

| Place | Files | Encoding |
|---|---|---|
| `GLOBAL.PAK` | `N010` / `N020` / `N030.S22` | GSM 6.10 → 16-bit (type `0x35`) |
| `GLOBAL.PAK` | `N010` / `N020` / `N030.SND` | GSM 6.10 → 8-bit (type `0x34`) — unused, below |
| `GLOBAL.PAK` | `001-08-2.SND`, `001-08-2.S16` | raw 8-bit / 16-bit buffer |
| `RESOURCE.PAK` | `SFX.SND`, `TALK.SND` | raw 8-bit buffer — unused |
| `RESOURCE.PAK` | `SFX.S16`, `TALK.S16` | raw 16-bit buffer (samples for the volume sliders) |
| `Action\*.phk` | 7905 × `*.S22` | GSM 6.10 → 16-bit (type `0x35`) — speech in scenes |
| `Action\*.phk` | 866 × `*.PSD` | IMA ADPCM mono (type `0x32`) — scene effects |
| `Music\*.pms` | 24 files | IMA ADPCM stereo (type `0x33`) — music |

`Data\*.ph2` and `Action\*.phk` are archives in the [.PAK](pak.md) format (magic `PAK\0`). `.ph2` contains no sound. No file outside the two main archives is `.SND` or `.S16`.

The codecs come from a PWav SNDLIB build. The GSM decoder is a rework of **libgsm** (Jutta Degener, Carsten Bormann). Each function below corresponds to a libgsm function. The identifying strings sit at `0x0051b570` and `0x0051b678`.

## The sound buffer (what the game plays)

The player `FUN_004748e0` receives a **sound buffer** in memory:

```c
struct SoundBuffer { // little-endian
  uint32_t size; // PCM bytes to play
  uint32_t loop_start; // loop offset in PCM bytes
  uint32_t loop_length; // loop length in bytes; 0 = no loop
  uint8_t pcm[]; // 16-bit signed, mono, 22050 Hz
};
```

- `FUN_004748e0(channel, buf, volume)` calls `FUN_004738d0(channel, buf + 12, size, loop_start, loop_length, flags = 0x1811, rate = 0x5622, ...)`.
- `FUN_004738d0` builds a `WAVEFORMATEX`: `nChannels = flags & 3` (= 1), `nSamplesPerSec = 22050`, `wBitsPerSample = 16` **fixed**, bytes per sample `(flags & 0x18 | 0x10) >> 3` (= 2). The DirectSound buffer is `0x15888` bytes (2 s mono; `0x2b110` for stereo). Longer sounds are streamed (`FUN_00472c20`).
- Loop: when `loop_length != 0`, `FUN_00472c20` returns to `loop_start` after the buffer and plays `loop_length` bytes. In every game file both loop fields are **zero**.
- Conclusion: the engine plays only **16-bit mono 22050 Hz**. 8-bit files (`.SND`) cannot be played correctly by this executable. They are leftovers, likely from an older 8-bit mode. Their sample rate is **unknown**. Treating them as 22050 Hz is a guess.

Duration as the game computes it: `size / 44100.0` seconds (`FUN_00407750`, that is 22050 Hz × 2 bytes).

## Raw file (.S16, some .SND)

The file is exactly a sound buffer: `size == file length − 12`. The game loads it whole (`RESOURCE.PAK:SFX.S16` and `TALK.S16` through `FUN_00416a10` in `Game_Main`) and plays it without decoding. In `.SND` the PCM is unsigned 8-bit (silence = `0x80`). In `.S16` it is signed 16-bit.

## Packed file (.S22, .PSD, some .SND, .PMS)

```c
struct CodecHeader { // offset 0, 0x18 bytes — copied by FUN_00402a60
  uint32_t type; // 0x32..0x35, see the table
  uint32_t packed_size; // codec data bytes (= file length − data offset)
  uint32_t unpacked_size; // IMA: PCM bytes to decode; GSM: unused
  uint32_t loop_offset; // IMA: loop offset in the codec data (music stream)
  int16_t predictor; // IMA: initial predictor (left channel)
  uint8_t index; // IMA: initial step index (both channels)
  uint8_t pad;
  int16_t predictor_r; // IMA stereo: right-channel predictor
  uint16_t pad2;
};
// type != 0x33: the next 12 bytes are a SoundBuffer header (size, loop_start, loop_length),
// copied to the start of the output; codec data from 0x24
// type == 0x33: no SoundBuffer header, codec data from 0x18
```

| `type` | Decoder | Output | Files |
|---|---|---|---|
| `0x32` | `FUN_00486160` IMA ADPCM mono | 16-bit | `*.PSD` |
| `0x33` | `FUN_004862b0` IMA ADPCM stereo | 16-bit, L/R interleaved | `Music\*.pms` |
| `0x34` | `FUN_00484f00` GSM 6.10 | unsigned 8-bit | `N0x0.SND` |
| `0x35` | `FUN_004853b0` GSM 6.10 | 16-bit | `*.S22` |

`FUN_00402a60(src, dst)` zeroes a `0x48`-byte state at `0x005531b0`, copies the 0x18-byte header into it, copies the `SoundBuffer` header to `dst`, and decodes into `dst + 12` (for `0x33`: into `dst`). Nothing checks the type beyond that `if`. Any other value yields a header and no PCM. How the game picks a file:

- `FUN_00407750` (for example `N010.SND` from `FUN_00423fb0`) **replaces the extension with `S22`** (`FUN_0047efc0(name, "S22")`, the string at `0x004f711c`), looks in the scene archive (`DAT_0089c6f0`), and if it is missing looks in the second archive (`DAT_007ca0d0`). That is why `N0x0.SND` is never loaded.
- `FUN_0044ad00` reads the name list from the scene archive, replaces the extension with `PSD` (`0x004f8bd8`), decodes, and keeps the buffers. After changing the name back to `SND` it remembers the indexes of `KROK1.SND` / `KROK2.SND` (Jack's footsteps).

Observations checked by `verify`:

- `.PSD`: `unpacked_size == 4 × packed_size == size`. `loop_offset` is `packed_size` (756 files) or `packed_size + 4` (110). The loop never runs. `predictor` / `index` are non-zero in 181 files.
- `.S22`: `packed_size % 65 == 0`, `unpacked_size == size`, `size` is at most the decoded length.
- `N0x0.SND` (type `0x34`): `unpacked_size` **differs** from `size` (for example `0x6e00` vs `0x6f1a`). The field is unused for GSM, so this is not an error.
- `.PMS`: `unpacked_size == 4 × packed_size`. `loop_offset` is 0 or the music loop point.

### IMA ADPCM (`FUN_00486160`, `FUN_004862b0`)

Standard IMA/DVI with tables at `0x00500ae8` (indexes) and `0x00500b08` (89 steps):

```
diff = step >> 3; if (c & 4) diff += step; if (c & 2) diff += step >> 1;
if (c & 1) diff += step >> 2; if (c & 8) diff = -diff;
pred = clamp16(pred + diff); index = clamp(index + index_table[c], 0, 88)
```

The data layout is **not** Microsoft IMA ADPCM (no blocks with headers). It is a stream of 32-bit words, 8 samples each, **low nibble first**. Mono: each word → 8 samples (16 output bytes; `unpacked_size` drops by `0x10`). Stereo: a left-channel word, then a right-channel word, output interleaved L, R (32 bytes; the counter drops by `0x20`). Initial state: `predictor`, `index` (right channel: `predictor_r` and the same `index`). Decoding runs until the counter hits zero. **`unpacked_size` must be a multiple of 16 (stereo: 32)**, or the game writes past the buffer. Decoding consumes `unpacked_size / 4` source bytes.

Loop (`param_2 != 0`, the music stream from `FUN_00471ee0`): when the source position reaches `loop_offset`, the decoder remembers its state; when it reaches `packed_size` it restores that state and rewinds the source to `loop_offset`. `FUN_00402a60` calls the decoders with `param_2 = 0` (no rewind).

### GSM 6.10, WAV49 frames (`FUN_00484f00`, `FUN_004853b0`)

Data is blocks of **65 bytes**, as in Microsoft `WAVE_FORMAT_GSM610` (0x31). Each block is two GSM frames of 260 bits = 320 samples. Bits are read from the least significant (`FUN_00483fa0` is the first frame, `FUN_00484200` the second, from bit 260). A frame is `LARc[8]` (6, 6, 5, 5, 4, 4, 3, 3 bits), then 4 subframes: `Nc` 7, `bc` 2, `Mc` 2, `xmaxc` 6, `xMc[13]` of 3 bits each.

- Block count = `packed_size / 65` (integer division), **zero when `packed_size ≤ 0x40`**. Output is always `blocks × 320` samples. The game plays only `size` bytes from the buffer header.
- Decoder state (`0x284` bytes, `FUN_00484c20`: zeroes, `nrp = 40`) is new for each file.
- Steps per frame (as `Gsm_Decoder` in libgsm): `FUN_00484450` RPE decode, `FUN_004846c0` long-term synthesis, `FUN_00484780` LAR decode and interpolation (sample ranges 0–12, 13–26, 27–39, 40–159) with `FUN_00483460` (LARp→rp) and the filter `FUN_00484b00`, then `FUN_00484a50`: de-emphasis (`msr * 28180`), a doubling, and `& 0xFFF8`. Tables `B` / `MIC` / `INVA` at `0x00500a52` / `0x00500a66` / `0x00500a8e`, `QLB` at `0x00500aa8`, `FAC` at `0x00500ad8` — the same values as libgsm.
- `GSM_MULT_R` in the executable saturates the product to `0x3fffffff` before `>> 15`. The result matches libgsm.
- Type `0x34`: each 16-bit sample keeps the high byte minus `0x80` (`(s >> 8) ^ 0x80`), unsigned 8-bit.

## Open

- The sample rate of the 8-bit `.SND` files (the game does not play them) is unknown.
- The role of `SFX.S16` / `TALK.S16` (hypothesis: the preview for the effect and speech volume sliders). Where the game uses `DAT_009e1bdc` / `DAT_009d3630` was not checked.
- The IMA decoder was not compared with an independent implementation. The algorithm is the standard one, and the TypeScript decoder follows it.
