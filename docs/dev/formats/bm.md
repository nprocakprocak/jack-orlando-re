# .BM format

An uncompressed bitmap in one of two variants: **16-bit RGB565** or **8-bit with a 128-color RGB565 palette**. The file has no type field. The variant follows from the file size. Parser: `packages/engine/src/formats/bm.ts` (`decodeBm`, `verifyBm`).

Confirmed on every bitmap in the loose files, `.PAK` archives, and scene archives `.PHK` / `.PH2`: 2263 files.

| Variant | Count (PAK + loose) | Examples |
|---|---|---|
| `rgb565` | 377 | `CD00.BM`, `KOLT01.BM`, `HAF000.BM`, `Movies\OUTRO16.BM` (640×480) |
| `pal8` | 18 | `CIEN1.BM` (shadow), `MASKA01`–`09.BM`, `M00`–`M04.BM`, `Movies\CYKL1`–`3.BM` |

## File layout

All numbers are little-endian.

```c
struct BmHeader { // offset 0, 4 bytes
  uint16_t width;
  uint16_t height;
};

// rgb565: file size == 4 + 2*width*height
uint16_t pixels[height][width]; // RGB565, rows from the top

// pal8: file size == 4 + 256 + width*height
uint16_t palette[128]; // offset 4, RGB565; palette[0] == 0 in every file
uint8_t pixels[height][width]; // offset 0x104: BYTE OFFSET into the palette (always even)
```

- An 8-bit pixel is a **byte offset**, not an index. The color is `*(uint16_t *)(file + 4 + byte)`, that is `palette[byte / 2]`. The blitter `0046ee70` reads it that way (`sVar2 = *(short *)((int)param_7 + bVar1 + 4)`, pixels from `param_7 + 0x104`). Every pixel byte in the game files is even. The parser rejects an odd offset.
- The 8-bit layout is exactly a decoded [`.PBM`](pbm.md). A `.PBM` is the same picture with the pixels packed by RLE.
- Size distinguishes the variants as long as `width*height != 256` (both formulas then give the same size). No game file has 256 pixels. In the game the variant follows from the call site: a given buffer always receives the same kind of picture (for example `CIEN1.BM` → `DAT_006d38d8`, drawn as a shadow). Which blitters read `pal8` without RLE was not traced at every call site.

## Color and transparency

- **RGB565** (`0xF800` red, `0x07E0` green, `0x001F` blue). Evidence:
  - `00453040` (DirectDraw mode setup) first looks for a 16-bit mode with masks `R=0xF800, G=0x07E0, B=0x1F`. Only if that mode is missing does it accept 555 (`0x7C00/0x3E0/0x1F`) and set `DAT_009c544c = 1` (555 mode — conversion at draw time, not studied).
  - Draw functions use the 565 masks (`0046e1a0`: `& 0xf800`, `& 0x7e0`, `& 0x1f`; `0046e2b0`: tables for `(c & 0x7e0) >> 4`).
  - On the data: 376 of 377 `rgb565` files use bit 15, so the stored pixels are not 555.
- **Color 0 is transparent** in the keyed blitters: `0046d250` (16-bit, `if (*src != 0) *dst = *src`) and `0046ee70` (8-bit, `if (color != 0)`). Whether a given picture is drawn keyed or opaque depends on the call site. `rgb565ToRgba` treats color 0 as transparent.
- Expansion to 8 bits per channel repeats bits: `r8 = r5<<3 | r5>>2`, `g8 = g6<<2 | g6>>4`.

## Loading

A `.BM` is read whole into a buffer. Nothing parses it at load time.

| Address | Procedure | What it does |
|---|---|---|
| `00408950` | `Res_LoadFile(name, dest)` | `Pak_LoadFile` of `RESOURCE.PAK` into a static buffer |
| `00416a10` | `Res_LoadAlloc(name, &ptr)` | size from `Pak_FileSize`, `new((size & ~1) + 2)`, then `Pak_LoadFile`; returns the size. Used for `.PBM` |
| `00457f20` | `Pak_LoadFile(archive, name, dest, max)` | `Pak_OpenFile` plus reads of 64 KiB (`max == 0` means the whole file), then `Pak_CloseFile`; `-4` when the file is missing |
| `00457eb0` | `Pak_FileSize(archive, name)` | entry size, or `-4` |
| `00458030` | `Pak_Exists(archive, name)` | 1 when the name is in the directory |

`Game_Main` (`0044d1d0`) loads `CD00.BM`…`CD38.BM` into buffers spaced `0x708` bytes apart from `DAT_007b63d8` (the buffer is at least the 1744-byte file), plus cursors `WSK*.BM`, `KOLT01`–`04.BM`, and `CIEN1.BM`. Animation frames and duplicate names are in [pbm.md](pbm.md#how-the-game-loads-animation-frames).

## Scene archives `Action\*.PHK` and `Data\*.PH2`

Scene archives use the **`.PAK` format** and hold most of the game's pictures. Every `.BM` in them parses. `.PBM` deviations (bytes after the RLE stream, the `PUSTY.PBM` stand-in) are in [pbm.md](pbm.md).
