# Video: .AVX movies and .FLX animations

Parser: `packages/engine/src/formats/media.ts` (`Avx`, `Flx`, `FrameBuffer`, `decodeFrame`, `ImaStereoStream`, `parseFlxHeader`, `verifyMedia`). Decoding is frame by frame. The player is `packages/engine/src/video/`.

**FLX is the game's own format, not Autodesk FLIC** (a different signature `"FLX\0"`, different chunks, no 128-byte FLIC header). **AVX is a container**: a header, 2.5 s of sound, then records of "an FLX frame plus that frame's sound". The picture in both is an 8-bit index buffer, encoded as a delta, with a 256-color RGB565 palette (exception: `INTRO.AVX` uses RGB888).

## Where the files are

| Files | Count | Who plays them |
|---|---|---|
| `Movies\*.AVX` | 20 | `Media_Open` `00468960` / `Media_Step` `00467c90` / `Media_Close` `00469180` |
| `Movies\*.DLG` (`INTRO`, `MUN16`, `PLA16`, `OUTRO16`, `kraty16`) | 5 | movie captions — [below](#captions-moviesdlg) |
| `Movies\CREDITS.PBM`, `CYKL1`–`3.BM`, `OUTRO16.BM` | 5 | background and the end-credits animation (mode 2) |
| `menu.PAK:D1.FLX` | 1 | `Menu_FlxStep` `004692b0` (launcher) |
| `*.FLX` in `Action\*.PHK` | 61 (53 distinct) | scene animations, modes 5/6 of `ANIMA` (`Game_Run`, `Script_ExecStep`) |

`Music\*.pms` (music, IMA stereo `0x33`) is [sound.md](sound.md). `Soundtrack\*.mp3` is ordinary soundtrack audio. The executable does not use it (no `.mp3` string).

## Movies: who, when, which mode

`Media_Open(path, mode)` — `mode` (`DAT_009fc064`) selects the player variant:

| `mode` | Who | What |
|---|---|---|
| 0 | `RUNAVX film scene` (`Game_Run` `0043b81c`) | `Movies\<film without extension>16.AVX` (the string `16.AVX` at `0x4f7f14`) |
| 1 | `Launcher_PlayIntro` `00469f40` | `MOVIES\INTRO.AVX`, at startup |
| 2 | `RUNAVX OUTRO.AVX` | `mode = 2 * g_gameFinished` — `OUTRO16.AVX` with the end credits |

In `Game_Run`, before a movie: `Media_Open`, then a loop of `Media_Step` until it returns ≤ 0, or `Sys_PumpMessages` ≠ 0, or `Input_IsKeyDown` (**a key can abort the movie**), then `Media_Close`. Mode 2 also loads `credits.pbm`, `cykl1`–`3.bm`, and `<film>.BM` from the movie directory. Every mode loads `<film>.DLG` when it exists (`File_Exists`).

## AVX — the container

```c
struct AvxHeader { // offset 0, 4 bytes
  uint16_t segments; // FLX segment count (DAT_009e6818); 1, INTRO 43, OUTRO 20
  uint8_t unk2; // 4, INTRO 10 — the game does not read it
  uint8_t bits; // 16; Media_Step case 1: any other value is an error
};
// offset 4: 0x1aec0 bytes of preroll:
// CodecHeader 0x18 B (sound.md, type 0x33 IMA stereo) + 0x1aea8 B of IMA data
// offset 0x1aec4: blocks through the end of the file
struct AvxBlock { uint32_t size; /* including this field */ AvxRecord records[]; };
struct AvxRecord { uint32_t length; /* excluding this field */
  [FlxHeader 0x14 B — only in the first record of a segment]
  FlxFrame frame; // chunks as in .FLX, no chunk 3
  uint32_t sound_size; // including this field
  uint8_t ima[sound_size - 4]; }; // IMA stereo, continuation of the stream
```

The state machine `Media_Step` (`DAT_009fc080`): 1 reads the 4-byte header; 2 reads the preroll in 32 KB pieces; 3 decodes the preroll (`Ima_DecodeStereo`, `0x6baa0` B of PCM = 2.5 s) and reads the block size (`Avx_ReadBlockSize` `00467af0`); 4 reads the block in 32 KB pieces; 5 starts the sound (`Snd_PlayBuffer(1, ring, 0xd7550, …, 44100 Hz)`, a 5 s ring buffer) and the picture. Then, each tick, when the frame time has elapsed: `Media_DecodeVideo` `00466b50`, `Media_DrawSubtitles` `00467500` (when dialogue text is on, `g_dialogTextOn` = `g_config+4`, or when there is no sound), `Media_QueueSound` `004678d0`, and a refill of the block (`Avx_ReadMore` `00467b80`, pieces of 0x800 B, only when there is time before the next frame).

Checked on all 20 files: blocks and records fill the file to the byte, the FLX header is exactly at the start of each segment, the segment count equals `segments`, and there are no records after the last frame of the last segment (`Media_Step` returns 0). Each record's sound is a multiple of 8 bytes. Blocks: 1–20 per file, the largest 10 MB (`INTRO`).

Segments in the data: the other `*16.AVX` files are one segment of **1024×480**, 11–24 fps. `INTRO.AVX` is 43 segments of 640×480 (16/18/20 fps), an RGB888 palette (`pal16 = 0`), **276 palette changes**. `OUTRO16.AVX` is 20 segments of 1024×480 at various fps (among them 20, 8, 6). Width 1024 is the screen-buffer width. 640 columns are visible (`Media_Redraw` `00467360` draws 0x280 columns from a buffer of width 0x400; in mode 1, 0x280).

### Time and sound

- A frame lasts `200 / fps` (integer division) ticks of 5 ms (`DAT_009e678c`). 12 fps → 16 ticks = 80 ms (actually 12.5 fps).
- Sound: 44 100 Hz, stereo, 16-bit. A record carries one frame of sound (for example 3528 frames = 80 ms). The PCM stream is the preroll (2.5 s) plus **an 8-byte gap** (the write into the buffer starts at `0x6baa8`, not `0x6baa0`; those 2 frames are uninitialized memory — the parsers emit silence) plus the sound of the later records. Picture frame *i* is shown at `i × frame time`, while the sound plays from zero in the buffer, so the sound data of record *i* plays 2.5 s later than its picture.
- Sync: `Media_QueueSound` measures how far the write is ahead of playback (`(write − play) / 2000`) and shifts the frame clock so the lead stays near `0xdc` = 2.5 s. When the picture is more than 3 s late (`-600` ticks), the sound is muted until more data arrives.
- After the last frame the movie ends and `Media_Close` stops the channel, so the last 2.5 s of sound in the file never play. In the data that tail is almost always a decay or silence (death and arrest movies: RMS falls from about 400 to about 30, peak ≤ 2200 of 32767; `INTRO` ≤ 563; `KRATY16` / `MUN16` / `PLA16` are silent). It is audible only in `OUTRO16.AVX`, where the tail is still music (RMS about 5000). That matches play: the death movies do not sound cut off.
- The IMA decoder keeps state between calls (structure `0x9e6820`, source-byte counter `+0x18`). The `CodecHeader` fields mean something else here than in music: `unpacked_size == 4 × packed_size`, but `packed_size` is **not** the length of the sound in the file, and `loop_offset` is garbage (for example `0xee7757c0`; 0 in `OUTRO16`). The decoder still uses them: when the counter reaches `packed_size` it restores the state saved at `loop_offset` (here, zeroes from `memset`). In `KRATY16`, `MUN16`, and `PLA16` the sound is longer than `packed_size` and **the predictors reset** (sound of 25.2 s / 26.4 s; the reset clicks up to 30 000) — but that is in the tail the game no longer plays. The parsers reproduce this (`ImaStereoStream`).

## FLX — the header

```c
struct FlxHeader { // 0x14 bytes
  char magic[4]; // "FLX\0"
  uint16_t frames; // frame count (end of the animation or segment)
  uint16_t width; // width = the buffer's row stride
  uint16_t height;
  uint16_t fps; // movies: frame time 200/fps × 5 ms; scenes and the menu do not read it
  uint8_t unk_c; // 1 in FLX, 0 in AVX — the game does not read it
  uint8_t mode; // scenes: 2 = framed frames (below), 3 = a fade variant; data: 0, 1, 2
  uint8_t pal16; // 1 = palette of 256 × RGB565, 0 = 256 × RGB888 (only INTRO.AVX)
  uint8_t unk_f; // 0
  uint16_t x, y; // position in the scene — the game does not read it (.ACI supplies the position)
};
```

`x, y` is probably the position from the authoring tool. In `D1.FLX` it is (309, 39), exactly where `Menu_FlxStep` draws the animation (constants `0x135, 0x27` in the code).

`Script_ExecStep` and `Game_Run` read only `frames`, `width`, `height` (`+4/+6/+8`) and `mode` (`+0x0d`). In movies, `Media_DecodeVideo` also reads `fps` and `pal16`. One INTRO header has the bytes `"BCA\0"` at `+0x10` (leftover from a tool).

## FLX — frames and chunks

After the header, frames. Each frame is a run of chunks ending in a picture chunk (type 0/1/2):

```c
struct Chunk { uint8_t type; uint8_t pad /* 0 */; uint32_t size; /* the whole chunk */ uint8_t data[]; };
```

| type | size | meaning |
|---|---|---|
| 4 | 6 + 512 (6 + 768) | palette: 256 × `uint16` RGB565 (or 256 × R, G, B → `FUN_00470400`) |
| 3 | 14 | rectangle `int16 x, y, w, h` — the region changed in this frame (scenes) |
| 2 | any | RLE-packed delta (data from `+6`) |
| 1 | any | unpacked delta — the delta record starts at **`+2`** (its size field equals the chunk `size`) |
| 0 | 6 | no change (the frame is repeated) |

Order inside a frame: `[4] [3] picture` — checked on every file. A palette appears only on the first frame of each FLX (and of each `*16.AVX` segment). AVX has no chunk 3. The game does not check the order. `Media_DecodeVideo` skips one chunk of type > 2. A scene handles 4, 3, 2, 1, 0 in order. The menu (`Menu_FlxStep`) processes one chunk per call (one chunk per tick).

### The delta record (`Delta_ApplyIdx` `00470350`, `Delta_Apply16` `0046ffa0`, `Delta_ApplyScreen` `00470020`)

```c
struct Delta { uint32_t size; /* the whole record */ uint32_t start; /* pixel index */
  struct { uint8_t skip, count; uint8_t pixels[count]; } pairs[]; };
```

`pos = start`. For each pair, `pos += skip`, then `count` index bytes from `pos`. The loop runs while the pointer is `< record + size`. A pair with `count ≠ 0` that has no bytes left ends the loop (the check is *after* the advance of 2). Pixel addresses are linear. The row stride is `width`. Variants: `00470350` writes indexes (the movie buffer `DAT_009e6788`), `0046ffa0` writes `palette[index]` straight into a 16-bit buffer (scenes, menu), `00470020` / `004701a0` write to the screen (a movie), the second of those with the caption background.

Original quirks, reproduced by the parsers and counted as `overruns`:

- **Type 1 reaches 2 bytes past the chunk.** The record starts at `+2`, and its `size` is the chunk size. In 2907 FLX chunks those 2 bytes are `[type, 0]` of the next chunk, read as a pair `skip = type, count = 0`, which does nothing. In 14 chunks the last run ends exactly on them: **two pixels receive indexes from the next chunk's header** (the type and 0). The tool that wrote the file lost 2 bytes (two-byte delta). In `INTRO.AVX`, 14 runs go further still, past the end of the delta record (they read the record's sound; the first is in frame 2353).
- **A run past the end of a packed record** reads old bytes of the unpack buffer (`DAT_009fc060`, never zeroed) — one place in `INTRO.AVX`. The parsers keep such a persistent buffer.
- A write past `width × height` (only after such a run) lands in the invisible part of the movie buffer (`0x12c000` B). It is allowed up to that limit.

### RLE of chunk 2 (`Rle_Unpack` `0046c840`)

Copies the 8-byte delta header (`size`, `start`), then unpacks `size − 8` bytes: `0xFF v n` means byte `v` repeated `n` times; any other byte is a literal. The unpacked record is an ordinary delta. In the data the packed bytes end exactly with the chunk.

### Picture: palette and buffer

- Movies: the state is an 8-bit index buffer. In mode 1 a palette chunk redraws the whole frame (`FUN_004703b0`, 480 rows), so the picture is `palette[index]`. Modes 0 and 2 draw only the changed pixels (in the data there is one palette per segment, so the result is the same). The index buffer is not zeroed before a movie (`operator_new`). The first frame of a segment covers it anyway.
- Scenes and the menu: `Delta_Apply16` writes colors straight into a 16-bit buffer that was zeroed when the animation started (`memset(g_bigBlock, 0, …)` in `Script_ExecStep`). Unchanged pixels are 0 (transparent). Parsers: `FrameBuffer` with `rerender` false for FLX and true for AVX.
- Scenes, `mode ≠ 2`: the rectangle from chunk 3 is the frame's region (`x, y ≥ 0`, `x + w ≤ width + 1`, `y + h ≤ height` — in `31_SAM3.FLX` 13 rectangles stick out by 1 column). The game copies it with `Blit_Copy16(x, y, w, h, …)` into a sprite drawn at `object + (x, y)`.
- Scenes, `mode == 2` (24 files, 21 names, including all of `SC000D`): **framed frames**. The frame picture sits in the top-left of the buffer (`w × h`, stride `width`), and the rectangle's `x, y` is its position (up to 640×480, also stored in `DAT_005640c4` / `DAT_00723d9c`). Checked: `w ≤ width`, `h ≤ height`.
- Empty rectangles (`w ≤ 0` or `h ≤ 0`) do occur: `31_SAM3` frame 0 is `(639, 378, −638, −377)`, an inverted empty rectangle from the tool; `CIEZ.FLX` frame 139 has `h = −96`.

## Captions: Movies\*.DLG

`.DLG` files next to the movies (not scene dialogue) are **captions as finished pictures**. `Media_Open` loads one whole into `DAT_009e6810` (0x64000 B). `Media_DrawSubtitles` `00467500` draws it (`Blit_Keyed16`), in every mode only when `g_config+4 == 1` or the game is running without sound. `g_config+4` (`0x9fa95c`, name `g_dialogTextOn`, default 1 in `Sys_InitConfigAndCd`) is the dialogue-text option (`FUN_00409c60`, references to `0x9fa95c` at `00409df7` and `00409f81`). The same byte is checked on entry by the line-drawing functions `FUN_0040d250` (`0040d267`) and `FUN_0040d4b0` (`0040d4bd`). Turning dialogue text off hides spoken-line captions (answer options stay) and hides movie captions. Records run to the end of the file (checked on all 5 files — they fill the file to the byte):

```c
// INTRO.DLG (mode 1): 39 records
struct SubIntro { uint16_t w, h, x, y, first, last, segment; uint8_t color[3]; uint8_t pad[7];
  uint8_t pixels[w*h]; }; // 0x18 B header
// the rest (modes 0/2): MUN16 7, PLA16 7 (identical to MUN16), OUTRO16 11, kraty16 6
struct Sub16 { uint16_t first, last, x, y, unk /* 0 */, w, h; uint16_t pixels[w*h]; }; // RGB565, 0 = transparent
```

In INTRO the pixels are bytes 0, 128, 255 through the small palette `DAT_009f83d0`: `color` (RGB888 → RGB565) goes into entry 255 (`0x9f85ce`), entry 0 is `0x0001` (near-black outline, not zero), and the rest of the palette is zero, so 128 → 0 = transparent. The key of `Blit_Keyed16` is 0. A caption is visible from frame `first` to `last` (segment frame counter `DAT_009fac98`; in INTRO also the segment number). The `.DLG` format is [subtitles.md](subtitles.md).

## Engine API

`new Avx(bytes)` and `new Flx(bytes)` yield frames (`FrameBuffer` is RGB565 `width × height`). `Avx` sound goes through `ImaStereoStream`. Decoding does not hold the whole movie, only the record index.

## Checks

82 files (20 AVX, 62 FLX). Tests: `packages/engine/src/formats/media.test.ts`.

## Open

- `unk2` in the AVX header (4 or 10), `unk_c`, and `x`/`y` in FLX. No read was found.
- Scene `mode == 3` (a fade through `FUN_00427950`) does not occur in the data.
- The meaning of `DLG.unk` (always 0).
- Mode 2 (OUTRO): the order of the end-credit drawing (`CYKL1`–`3` every 3 frames in segments 7–18, `CREDITS.PBM` in segment 4, volume in segment 19) is described from the code only. The player is `packages/engine/src/video/`.
