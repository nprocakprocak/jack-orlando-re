# Encrypted text files (Text_Decrypt)

Scene descriptions, scripts, and some global files are stored as text encrypted with a simple byte cipher. This note covers only the cipher, the character encoding, and the list of encrypted files. Syntax of each file is in [text.md](text.md), [global.md](global.md), and [scene.md](scene.md).

Implementation: `packages/engine/src/formats/textcrypt.ts` (`decrypt`, `encrypt`, `decodeText`, `decryptText`, `isEncryptedName`, `checkText`, `MAZOVIA`, `ENCRYPTED_EXTENSIONS`).

## Cipher

`Text_Decrypt(buf, len)` (`00405d70`, called through the thunk `004012c1`) rewrites the buffer in place, byte by byte:

```
b = ~(b - 7) // 8 bits, no carry between bytes
```

- There is no key, header, or checksum. The length is the archive entry size (`Pak_FileSize`). Every loader stores it in `g_textLen` (`008a17a4`).
- `~(b − 7) = −(b − 7) − 1 = 6 − b (mod 256)`, so the cipher is an **involution**: the same operation encrypts and decrypts (`encrypt == decrypt`). Checked for all 256 values.
- `JackOrlando.exe` has no encrypt function (the game only reads these files). No other `~b + 7` pattern shows up in the program.

Example: `'[' (0x5B)` → `6 − 0x5B = 0xAB`. A scene file that starts with the graphics-section header begins with the bytes `AB C0 BA …`.

## Encoding and line endings

Checked on all 1416 encrypted files (3.04 MB of text):

- Line endings are only `CR LF` (306 866 lines, no lone `CR` or `LF`). Every file ends with `CR LF`. The only other control character is `TAB` (indentation in `.MCC`). There are no `NUL` bytes. No file is empty.
- Polish letters use **Mazovia** (CP437 with Polish letters), **not** cp1250. Bytes:

 | byte | char | | byte | char | | byte | char |
 |---|---|---|---|---|---|---|---|
 | `86` | ą | | `95` | Ć | | `A2` | ó |
 | `8D` | ć | | `98` | Ś | | `A3` | Ó |
 | `8F` | Ą | | `9C` | Ł | | `A4` | ń |
 | `90` | Ę | | `9E` | ś | | `A5` | Ń (absent from the data) |
 | `91` | ę | | `A0` | Ź | | `A6` | ź |
 | `92` | ł | | `A1` | Ż | | `A7` | ż |

  Besides those, only `82` = `é` (CP437) appears, in the credits file. Other bytes `80–FF` decode as CP437 (the full `MAZOVIA` table in the code).
- Deviations (author typos; they do not change behavior): comments in `.MCC` (text after `/`) contain single bytes from other code pages — `SC054.MCC` `B9` (ą in cp1250), `SC067.MCC` and `SC117.MCC` `BE` (ż in CP852), `SC075.MCC` `A9` (ę in CP852), `SC080.MCC` `88`. In the dialogue file `SC205.DCN` / `SC205.DCG` one word uses `9F` where `A6` (ź) belongs. `checkText` allows exactly those cases (`.MCC` comments and the known odd bytes). Any other byte outside the table is an error.
- The game does not convert the text. Bytes go straight to the font, so glyphs `*.FNT` for `80–FF` should match Mazovia. See [fnt.md](fnt.md).

The tokenizer scene loaders use on the decrypted buffer, `Text_NextToken` (`00405f00`), skips bytes `<= 0x20` and returns a run of bytes `> 0x20` (position in `g_textPos` `00851d2c`). For it, line endings and spaces are equivalent, and bytes `>= 0x80` are ordinary characters. That is why dialogue files (`.DCN`) store spaces as `_`. The meaning of the other characters is in [scene.md](scene.md) and [dialog.md](dialog.md).

## Encrypted files

All 13 functions that call `Text_Decrypt`:

| Loader | Address | Archive | File |
|---|---|---|---|
| `Ics_LoadSection` | `004069f0` | `GLOBAL.PAK` (`g_pakGlobal`) | `GLOBAL.ICS` |
| `Fcm_LoadSection` | `0040ee20` | `GLOBAL.PAK` | `GLOBAL.FCM` |
| `Gui_ShowAbout` | `0040af60` | `RESOURCE.PAK` (`Res_Load`) | `TEKST.COD` (lines of the about window) |
| `Scene_LoadCcg` | `004486d0` | `SCxxx.PHK` (`g_pakAction`) | `<scene>.CCG` |
| `Scene_LoadDcn` | `00440520` | PHK | `<scene>.DCN` |
| `Scene_LoadFcc` | `00440010` | PHK | `<scene>.FCC` |
| `Scene_LoadPcs` | `0044a000` | PHK | `<scene>.PCS` |
| `Scene_LoadAce` | `004475e0` | PHK | `<scene>.ACE` |
| `Scene_LoadAci` | `00448410` | PHK | `<scene>.ACI` |
| `Sound_LoadSceneSfx` | `0044ad00` | PHK | `<scene>.SSD` |
| `Scene_LoadIcs` | `0044af70` | PHK | `<scene>.ICS` |
| `Scene_LoadFcm` | `0044b430` | PHK | `<scene>.FCM` |
| `Script_CompileMacros` | `00440cb0` | PHK | `<scene>.MCC` |

- Scene loaders get a name built in `Scene_Load` (`0044ba80`): the scene name plus an extension from the short-string table `004f8c30`…`004f8c54` (`SSD FCC PCS FCM ICS DCN DCG MCC ACE ACI`). Call order: CCG, DCN, FCC, PCS, ACE, ACI, SSD, ICS, FCM, MCC.
- `.CCG` and `.MCC` are required (no `Pak_Exists` check; an empty `.CCG` ends the game with a length-error message). The other loaders check `Pak_Exists` first and skip a missing file.
- `.DCG`: `Scene_Load` builds `<scene>.DCG` (buffer `0088f624`), but no function uses that name. In the data every `.DCG` is byte-identical to that scene's `.DCN` (132/132). Likely a language variant or a working copy. It uses the same cipher.

File counts (repeated names inside one archive counted once; the first wins):

| Where | Encrypted files |
|---|---|
| `GLOBAL.PAK` | `GLOBAL.CCG`, `GLOBAL.ICS`, `GLOBAL.FCM`, `GLOBAL.SSD`, `GLOBAL.MCC` |
| `RESOURCE\RESOURCE.PAK` | `TEKST.COD` |
| `Action\*.PHK` (135) | `.CCG` 135, `.MCC` 135, `.SSD` 134, `.ACE` 132, `.DCN` 132, `.DCG` 132, `.ACI` 97, `.ICS` 94, `.PCS` 64, `.FCC` 62, `.FCM` 23 — and in every PHK a copy of `GLOBAL.CCG` and `GLOBAL.MCC` (identical to those in `GLOBAL.PAK`) |
| `Data\*.PH2` | none (only `.PBM` pictures) |

1416 files in all. Rule: **a file is encrypted if and only if its extension is one of `ACE ACI CCG COD DCG DCN FCC FCM ICS MCC PCS SSD`**. Checked on every file in `*.PAK` / `*.PHK` / `*.PH2`: every file with those extensions decrypts to text, and no file with another extension looks like encrypted text (the rest are pictures, sound, `.FLX`, binary `.000`…/`.115` from PHK, and the plaintext `VARIABLE.ALL`, `ELEM.LST`, `ELEM.GER`).

- `GLOBAL.CCG`, `GLOBAL.MCC`, `GLOBAL.SSD`: the code never names them (neither as a string nor when building a name). Hypothesis: leftovers of the authors' tools, or loaded by `Scene_Load` when a script sets the scene name to `GLOBAL`. They are encrypted like scene files.

Plain text files (read without `Text_Decrypt`): `VARIABLE.ALL` (`Var_LoadAll` `0044a600`) and `ELEM.LST` (`00429ce0`, `Game_Main`) in `RESOURCE.PAK`, and `ELEM.GER` (byte-identical to `ELEM.LST`). Loose `Movies\*.DLG` files are binary, not text ([subtitles.md](subtitles.md)).

## Checks

`checkText` requires CR LF, only `TAB` as a control character, bytes `80–FF` from the Mazovia table except the deviations above, and a trailing `CR LF`. A file that was not encrypted fails this check (after a "decrypt" it has high bytes instead of ASCII).

A fingerprint is the size, the line count, the count of bytes `>= 0x80`, and a hash of the decrypted bytes and of the text (UTF-8 after Mazovia decoding). For a PHK it is a dictionary by file name.
