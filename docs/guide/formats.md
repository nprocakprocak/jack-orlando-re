# Formats

This is a short map of the encodings. The functions that read them are exported from `jack-orlando-re` (see [Package exports](package.md)). Byte-level notes for someone changing a parser are in [docs/dev/formats](../dev/formats/).

Numbers in these files are little-endian. Nothing below is a dump of a game file.

## Archives

`.PAK`, `.PHK`, and `.PH2` are one layout, read by `Pak` in `packages/engine/src/formats/pak.ts`. There is no compression and no cipher on the archive itself.

The header is 16 bytes: the four characters `PAK` and a zero byte, then a count, the offset where file bytes begin, and a reserved word. Each directory entry is an offset, a size, a name length, and the name. Lookup ignores case. If a name is stored more than once, the first entry is the one `Pak.find` returns.

[pak.md](../dev/formats/pak.md)

## Graphics

`.BM` (`decodeBm` in `packages/engine/src/formats/bm.ts`) is an uncompressed picture. The file starts with width and height. The rest is either 16-bit RGB565 pixels, or a 128-color RGB565 palette and one byte per pixel. The file size tells the two apart. A pixel value of 0 is the transparency key when the picture is drawn with a key.

`.PBM` (`decodePbm` in `packages/engine/src/formats/pbm.ts`) is the same header and palette, with the pixels run-length encoded. An even byte is one pixel. An odd byte starts a run: the pixel value is that byte minus one, and the next byte is the count.

A scene object says which decoder to use. Type `8` and type `-8` are `.PBM`. Type `16` is raw 16-bit, unless the name is an `FLX` slot.

`.FNT` (`parseFnt` in `packages/engine/src/formats/fnt.ts`) is a bitmap font: 256 glyph records, then the glyph pixels. The engine draws `JACK.FNT` and `JACKM.FNT` from `Resource/RESOURCE.PAK`.

[bm.md](../dev/formats/bm.md), [pbm.md](../dev/formats/pbm.md), [fnt.md](../dev/formats/fnt.md)

## Sound

`packages/engine/src/formats/sound.ts` reads `.SND`, `.S16`, `.S22`, and `.PSD`. A file is either a raw buffer (a 12-byte header and PCM) or a packed buffer (a 24-byte codec header, then IMA ADPCM or GSM 6.10).

The codec type selects the encoding:

| Type | Encoding |
|---|---|
| `0x32` | IMA ADPCM, mono |
| `0x33` | IMA ADPCM, stereo |
| `0x34` | GSM 6.10 toward 8-bit |
| `0x35` | GSM 6.10 toward 16-bit |

Speech and effects are played at 22050 Hz. Music (`.PMS`, type `0x33`) is played at 44100 Hz. Scene effects are `.PSD` files named by the scene sound list. Scene speech is `.S22`. The voice name in a dialogue file keeps its base name and uses the extension `.S22`.

[sound.md](../dev/formats/sound.md)

## Video

`.FLX` is this game's animation, not an Autodesk FLIC file. `packages/engine/src/formats/media.ts` reads a header and then chunks. Frames are 8-bit deltas with an RGB565 palette. Scene animations and one menu animation use it.

`.AVX` is a movie container, also read by `Avx` in that module. A short header is followed by a block of IMA ADPCM stereo sound, then records that pair one FLX frame with the sound for that frame. Movie sound is 44100 Hz. The player decodes a frame at a time.

Captions in `Movies/*.DLG` are picture records, not a text track. `packages/engine/src/formats/subtitles.ts` reads them. The intro file uses an 8-bit layout. The other caption files use RGB565.

[media.md](../dev/formats/media.md), [subtitles.md](../dev/formats/subtitles.md)

## Text cipher

Scene descriptions, scripts, dialogue, and several global lists are stored with a one-byte cipher. `decrypt` in `packages/engine/src/formats/textcrypt.ts` replaces each byte with `(6 - byte) mod 256`. The same function encrypts. There is no key and no header. The length is the archive entry's size.

Decrypted text is Mazovia (CP437 with Polish letters). Lines end with CR LF. `decodeText` maps the bytes to a string. These extensions are encrypted: `ACE`, `ACI`, `CCG`, `COD`, `DCG`, `DCN`, `FCC`, `FCM`, `ICS`, `MCC`, `PCS`, `SSD`.

`VARIABLE.ALL` and `ELEM.LST` in the resource archive are plain text. They are not passed through the cipher.

[textcrypt.md](../dev/formats/textcrypt.md)

How the decrypted scene files and macro files are structured is [Scripts](scripts.md). Parser notes for those files are [scene.md](../dev/formats/scene.md), [dialog.md](../dev/formats/dialog.md), [text.md](../dev/formats/text.md), and [global.md](../dev/formats/global.md).
