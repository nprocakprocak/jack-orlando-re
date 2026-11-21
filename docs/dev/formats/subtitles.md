# Movie captions: Movies\*.DLG

`.DLG` files in `Movies\` (not scene dialogue) are **captions stored as finished pictures** for `.AVX` movies ([media.md](media.md)). Five files: `INTRO.DLG`, `MUN16.DLG`, `PLA16.DLG`, `OUTRO16.DLG`, `kraty16.dlg` (lowercase in the name; Windows does not distinguish case). The other 15 movies have no captions.

Parser: `packages/engine/src/formats/subtitles.ts` (`parseSubtitles`, `SubtitleTrack`, `isIntro`, `verifySubtitles`).

## Loading and which layout **[code]**

`Media_Open` `00468960` zeroes `g_movieSubs` (`009e6810`, `0x64000` B). If a file exists with the movie's name and the extension `.DLG`, it loads that file there in full. A file larger than `0x64000` B would not fit (the parser rejects it). No file means a zero buffer, which means no captions. After the last record the game therefore reads zeroes: `first = last = 0`, never equal to the frame counter (which is ≥ 1).

**The movie mode picks the layout** (`g_movieMode`), not the file contents. Mode 1 (`INTRO.AVX`) reads the 8-bit layout. Modes 0 and 2 read RGB565. The parser picks by name: `INTRO.DLG` → 8-bit, the rest → RGB565.

## Record layouts

Records sit one after another through the end of the file (checked: they fill all 5 files to the byte). Everything is little-endian.

```c
// INTRO.DLG (mode 1): 39 records, header 0x18 B
struct SubIntro { uint16_t w, h, x, y, first, last, segment; // 0, 2, 4, 6, 8, 10, 12
  uint8_t color[3]; // 0xe: R, G, B
  uint8_t pad[7]; // 0x11; pad[0] = 0xff on white captions, otherwise 0
  uint8_t pixels[w*h]; }; // 0x18

// MUN16 7, PLA16 7 (identical to MUN16), OUTRO16 11, kraty16 6; header 0xe B
struct Sub16 { uint16_t first, last, x, y, unk /* always 0 */, w, h;
  uint16_t pixels[w*h]; }; // 0xe, RGB565, 0 = transparent
```

In RGB565, `Media_DrawSubtitles` `00467500` draws pixels directly (`Blit_Keyed16` `0046de50`: color 0 is skipped; only negative coordinates are clipped, not the right or bottom edge — the data fits in 640×480).

**INTRO — 8 bits through a palette.** Pixels are the bytes `0`, `128`, `255` (checked on all 39 records). When a record is shown the game converts `color` (`Pal_FromRgb888` → `Pal_Rgb888To565` `00470400`, `R&F8 <<8 | G&FC <<3 | B>>3`) into entry 255 of palette `g_subPalette` (`009f83d0`, 256 words, `0x9f85ce`), sets entry 0 to `0x0001` (a near-black outline, **not** the transparency key), leaves the rest at zero (`Media_Open` zeroes 0x200 B), then `Pal_MapRow` `004703b0` turns the bytes into RGB565 words in `g_subPicture` (`009faca0`, `0x19000` B, so `w*h ≤ 0xC800`; the largest record is 386×44). So `0 → 0x0001` (outline), `255 → color`, and any other value (for example 128) → 0 = transparent. Colors: yellow `ffff00`, white `ffffff`, green `2cd90d`. The parser returns the mapped RGB565 immediately. Entry 0 = `0x0001` is near-black in RGB565. In 555 mode (`g_videoIs555`) the game computes the color differently (`Pal_Rgb888To555`). The parser assumes 565, like the rest of the project.

## Timing: the state machine

`Media_Step` `00467c90` calls `Media_DrawSubtitles` after every picture frame (when `g_dialogTextOn == 1` or the game is running without sound — [media.md](media.md)). State: `g_subCurOffset` (`009fa934`, byte offset of the current record), `g_subVisible` (`009fa93c`), the segment frame counter `g_segFrameCounter` (`009fac98`), and the segment number `g_segIndex` (`009fac90`).

The counter is **1-based** after `Media_DecodeVideo` `00466b50`: the first frame of a segment is 1 (zeroed at the segment header, then `+1` after each frame). On every call, in this order:

1. If a caption is visible **and** the counter equals `last` (INTRO: also the record's `segment` equals `g_segIndex`) → hide it and advance to the next record.
2. If none is visible **and** the counter equals `first` (INTRO: also the segment) → show it.
3. If one is visible → draw it (INTRO: the picture from `g_subPicture`) at `(x, y)`.

Consequences (`SubtitleTrack` reproduces them):

- A caption is visible for frames `first ≤ k < last` (it disappears on frame `last`).
- The tests are **equality**, not `≥`. If the counter skipped `last`, the caption would stay on screen and block the later records. The player must therefore hand in every counter value. A timeline built from the real movies never does that.
- Step 1 runs before step 2. A record that starts exactly on the previous record's `last` (OUTRO: 415, 415) replaces it in the same frame, with no gap.
- In modes 0 and 2 **the segment is not checked**. The counter starts at 1 in each segment, and the record index only increases. `OUTRO16.DLG` records 0–7 are in segment 0 (frames 10…515), records 8–10 in segment 1 (frames 5, 50, 114). The other movies have one segment.
- INTRO is sorted by `(segment, first)`. That is a requirement of this machine.

On the real movies (segment lengths from the FLX headers) every caption in all 5 pairs is shown and then hidden. None is left hanging after the movie ends.

## Contents

- `MUN16.DLG` and `PLA16.DLG` are byte-identical (131 642 B). The movies `MUN16.AVX` (5 021 505 B) and `PLA16.AVX` (5 069 442 B) each have 1 segment and 611 frames, the same sound preroll, and identical sound in all 611 records (the hash of the concatenated IMA fragments matches). Only the picture differs. The captions fit both movies in time.
- The two movies share the spoken lines and differ in what Jack wears: a coat in one, the uniform in the other. The data does not say which file is which.
- The pictures are the Polish edition. Another language needs new `.DLG` files. This note does not reproduce the caption text.
- Picture heights: 16–20 px (one line), 40–44 px (two), 68 px (`OUTRO16`).

## Engine API

`parseSubtitles(bytes, isIntro(name))` → `Subtitle[]` (`pixels` is a `Uint16Array` of RGB565, 0 = transparent). `new SubtitleTrack(subs, intro).step(segment, frame)` → the caption to draw after that frame, or `null`. The player calls `step` after every drawn frame with the segment number and the segment frame counter counted from 1, and draws the result with color key 0 at `(x, y)`, the same way `Blit_Keyed16` does. Draw only when `DialogOnOff` (`g_config+4`) is on, or when there is no sound.

## Checks

Rules: records fill the file, `first < last`, the picture fits in 640×480, `unk == 0`, no picture is entirely transparent, and INTRO bytes are in `{0, 128, 255}` and the records are sorted. Tests: `packages/engine/src/formats/subtitles.test.ts`.

## Open

- `pad[0] = 0xff` in INTRO on white captions (13 of 39 records, exactly the white ones). The game does not read it. Likely a trace of the authoring tool.
- `unk` in the RGB565 layout (always 0). No read was found.
- 555 mode (`g_videoIs555`) was not checked.
