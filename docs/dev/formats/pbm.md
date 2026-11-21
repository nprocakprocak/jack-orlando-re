# .PBM format

An 8-bit picture with a 128-color RGB565 palette and pixels packed by a simple RLE. Unpacked, it has exactly the `pal8` layout of [`.BM`](bm.md). Used for sprites and animation frames (characters, close-ups, faces). Parser: `packages/engine/src/formats/pbm.ts` (`unpackPbm`, `decodePbm`, `verifyPbm`, `isPlaceholder`, `tailPixels`).

Confirmed on 18372/18372 files: 1 loose, 1422 in `.PAK`, 9613 in scene archives `Action\*.PHK`, and 7336 in `Data\*.PH2`. In 18354 files the RLE stream emits exactly `width*height` pixels and ends with the file. The 18 exceptions (16 with extra bytes, 2 stand-ins) are in [Deviations](#deviations-in-scene-archives).

## File layout

All numbers are little-endian.

```c
struct Pbm {
  uint16_t width; // +0
  uint16_t height; // +2
  uint16_t palette[128]; // +4 RGB565; palette[0] == 0 (transparent) in every file
  uint8_t rle[]; // +0x104 to the end of the file
};
```

Color and transparency are as in [bm.md](bm.md#color-and-transparency): RGB565, color 0 is the transparency key.

## RLE

Decoder: `Pbm_Unpack` (`0046c980`). It copies the first `0x41` dwords (header plus palette, 0x104 bytes) into the destination, then unpacks `width*height` pixel bytes after them:

```
n = width * height
while n > 0:
  b = next byte
  if b & 1: # run
  count = next byte
  emit (b - 1) count times
  n -= count
  else: # literal
  emit b
  n -= 1
```

- An output byte is a **byte offset into the palette** (color = `*(u16 *)(buf + 4 + byte)`), so it is always even. The oddness of an input byte is free and means a run. `0046ee70` draws this (pixels from `buf + 0x104`, color 0 skipped).
- `count` may be 0 (emits nothing) and up to 255.
- The game does not know the stream length. It stops when it has written `n` pixels. A run that passes `n` writes past the buffer in the game (the `while (n != 0)` loop in `0046c980` does not notice a wrap after a run). The parser reports that as `overruns`. A 0×0 image would loop the game decoder. The parser reports `empty image`.
- The result of `0046c980` is `0x104 + width*height` bytes. Callers allocate `(w*h/2)*2 + 0x108` or `+ 0x10c` (`004486d0`).
- A file with no odd byte is simply uncompressed pixels (for example `Movies\CREDITS.PBM`, 640×480, size `0x104 + 640*480`).

`verifyPbm` reports: file too short, empty image, truncated stream, run past the image, bytes after the stream that are not a complete RLE stream (below), and `palette[0] != 0`.

## How the game loads animation frames

**Always by name, never by entry index.** The PAK layer has no index access. Every open goes through `Pak_OpenFile` with a name (`Pak_LoadFile` / `Pak_FileSize` / `Pak_Exists`: `00457f20`, `00457eb0`, `00458030`). The only functions that touch the entry table are the `Pak_*` functions and `Pak_Exists`.

Frame names come from lists in encrypted text files (cipher `b = ~(b - 7)` on each byte, `Text_Decrypt` = `00405d70`; see [textcrypt.md](textcrypt.md)):

- `GLOBAL.ICS` in `GLOBAL.PAK`, read by `Ics_LoadSection` (`004069f0`): sections `[NAME]`, each line `FILE.PBM` plus 7 numbers (frame anchor and parameters), optionally `EFFECT`. For example `FUN_0041a330` calls `FUN_00403110("SPSTL1", …)` → section `[SPSTL1]` → `SPSTL11.PBM` … `SPSTL20.PBM`.
- `GLOBAL.FCM` in `GLOBAL.PAK`, read by `Fcm_LoadSection` (`0040ee20`): sections `[NAME]`, a count, then frame names (for example `[PODKOWA]`, `100`, `BGPODK.PBM`, `PODK1.PBM` ×6, `PODK7.PBM`, …).
- Jack's own frames in `Game_Main` (`0044d1d0`) are built by `MakeFrameName(prefix, n, ext, digits)` (`00409750`: `prefix` + `n`, with a leading zero when `digits == 2 && n < 10`, + `ext`), for example `SH_FR01.PBM`…`SH_FR12.PBM`.

**Why names repeat in the PAK.** The frame list itself repeats a name when the animation holds a frame: in `GLOBAL.FCM`, `PODK1.PBM` occurs 6 times; in `GLOBAL.ICS`, `SPSTL10.PBM` occurs 6 times. The packer wrote one archive entry per list position, so `GLOBAL.PAK` has 6 identical `PODK1.PBM` entries and then `PODK7.PBM` (the seventh list position). `PODK2`–`6.PBM` never existed and nothing asks for them. The game takes the first entry of a given name. Every copy is identical, so the result is the same. Checked on the data: all 1648 `.PBM`/`.BM` references in `GLOBAL.ICS` (1020 distinct names) exist in `GLOBAL.PAK`. The order of `SPSTL*` entries in `GLOBAL.PAK` matches `GLOBAL.ICS`.

For the engine: load an animation from the name list in `.ICS` / `.FCM` / the scene script, and resolve names with `Pak.find()` (first entry).

## Deviations in scene archives

Two cases, both checked on every file and handled in `packages/engine/src/formats/pbm.ts` (`tailPixels`, `PLACEHOLDER_NAME`).

### Bytes after the stream: `SC082` (16 files)

`Action\SC082.PHK:GZGR01`–`12.PBM` (11 files; `GZGR03` is missing, `GZGR04` is there twice) and `Data\SC082.PH2:GNOB13`–`17.PBM` (5 files), 6×19 or 8×19 px. After `width*height` pixels, 2–17 bytes remain.

- **How the game treats them:** those bytes are never read. `GZGR*` are frames from section `[GANGSTER]` in `SC082.PCS` (lines `FILE.PBM` plus 3 numbers). That layout is read by `0044a000`, called from `Scene_Load` (`0044ba80`). The loader reads the whole file into a buffer the size of the file (`new((size/2)*2 + 2)`, then `Pak_LoadFile` of the whole entry). `Pbm_Unpack` (`0046c980`) stops after `n = width*height` pixels and ignores the rest. There is no overflow and no error, only unused data. Other paths that draw a raw `.PBM` buffer (`Sprite_Set` without `Pbm_Unpack`) were not fully traced. The working assumption is that they also read only `w*h` pixels.
- **What the bytes are:** in each of the 16 files the tail is a **complete, valid RLE stream** that ends exactly at the end of the file and encodes 2–18 further pixels (up to about 2 rows at a width of 6–8). The likely cause is an encoder that wrote a few pixels too many (for example from the size before a crop).
- **Verify rule:** bytes after the stream are an error, **unless** they are a complete RLE stream through the end of the file. Then the file is valid, and the decoder skips them, as the game does. The fingerprint reports the count (`tailPixels`). Garbage or a truncated run after the stream is still reported. The test that names these 16 files will notice any new one.

### `PUSTY.PBM` — a 1-byte stand-in (2 files)

`Action\SC076.PHK:PUSTY.PBM` and `Action\SC089.PHK:PUSTY.PBM` are 1 byte: `0x91`.

- **Where the game uses it:** as an animation frame in the scene `.ACI` lists (`SC076.ACI`, `SC089.ACI`). The `.ACI` section loader (`00447c20`) reads `FILE.PBM x y` in order. For each frame it does `new((Pak_FileSize/2)*2 + 2)` (here 2 bytes) and `Pak_LoadFile` (1 byte), and stores the pointer in the frame table `DAT_0085e040`. These frames occur in `REC` sequences (in `SC089.ACI`, indices 23, 91, 143, 158), so they are displayed.
- **How the game treats it:** there is no special case for the name or the size. Drawing (`Script_ExecStep` `0041a330` case `0x1b`, `Scene_RefreshBackground` `0040dff0`) either calls `Pbm_Unpack` on that buffer (copying 0x104 header bytes out of a 2-byte allocation) or passes the buffer to `Sprite_Set` (`00478910`), which reads `width = *(u16 *)buf` and `height = ((u16 *)buf)[1]`. The result depends on uninitialized heap memory. **The behavior is undefined.**
- **Intent (hypothesis):** the name means an empty frame, a gap in the animation.
- **Handling:** only the pair *name `PUSTY.PBM` and contents exactly `91`* is a stand-in. `verifyPbm` returns an empty list for it, `decodePbm` yields an empty 0×0 image, and the fingerprint is `{ placeholder: true, size: 1 }`. Any other too-short file (including a `PUSTY.PBM` with different contents) is still `too short`. The engine skips this frame when drawing.
