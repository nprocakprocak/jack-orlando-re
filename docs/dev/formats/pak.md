# .PAK format

Archives with no compression and no encryption: a header, a directory of entries, then file bytes one after another. Parser: `packages/engine/src/formats/pak.ts` (`Pak`). Confirmed on every archive of the Steam release.

| Archive | Entries | Contents |
|---|---|---|
| `GLOBAL.PAK` | 1891 | pictures (`.PBM` ×1771, `.BM` ×107), sounds (`.SND`, `.S16`, `.S22`), `GLOBAL.CCG/.ICS/.FCM/.SSD/.MCC` |
| `MENU.PAK` | 57 | menu pictures (`.BM`), one `.FLX` animation |
| `RESOURCE\RESOURCE.PAK` | 589 | pictures, fonts `JACK.FNT`/`JACKM.FNT`, `VARIABLE.ALL`, `ELEM.LST`/`ELEM.GER`, `TEKST.COD`, `*.SFB`, `CM*.BIN` |
| `Action\*.PHK` | 135 archives | scene files: `.BM`/`.PBM`, `.S22`/`.PSD`, `.CCG`, `.MCC`, `.ICS`, `.FCM`, `.FLX`, and others |
| `Data\*.PH2` | 94 archives | scene pictures `.PBM` |
| `MUSIC16.PAK` | — | looked up by `Launcher_Run` (`0046b020`); **absent** in the Steam release (music sits loose in `Music\*.pms`) |

`.PHK` and `.PH2` are the same format as `.PAK` with a different extension. `Pak` reads all of them.

## File layout

All numbers are little-endian.

```c
struct PakHeader { // offset 0, 16 bytes
  char magic[4]; // "PAK\0" — the game compares strcmp(magic, "PAK")
  uint32_t count; // directory entries
  uint32_t data_start; // offset of the first data byte = end of the directory
  uint32_t reserved; // always 0
};

struct PakEntry { // count times, immediately after the header; variable length
  uint32_t offset; // absolute offset of the file bytes
  uint32_t size; // size in bytes
  uint32_t name_len; // name length INCLUDING the terminating NUL (max 0x104)
  char name[name_len];// for example "GLOBAL.CCG\0" — uppercase, no paths, ASCII only
};
```

Observations from the real files:

- Data follows directory order with no gaps: `entry[i+1].offset == entry[i].offset + entry[i].size`. The first entry starts at `data_start`. The last entry ends at the end of the file.
- **Names repeat** (562 names in `GLOBAL.PAK`, 1 in `RESOURCE.PAK`), always with identical bytes. The game scans the directory linearly and takes the **first** entry.
- The duplicates come from animation lists. The game loads frames **by name**, from the lists in the encrypted files `GLOBAL.ICS` / `GLOBAL.FCM` (and the same files in scenes). A list repeats a frame name when the character holds still (`PODK1.PBM` ×6, then `PODK7.PBM`), and the packer wrote a separate entry for each list position. `PODK2`…`PODK6` never existed. There is no access by index. Details: [pbm.md](pbm.md).

## How the game uses it

Name lookup is **case-insensitive**. The requested name goes through `_strupr` (`FUN_00489170`, which modifies the caller's buffer). Names in the archive are already uppercase.

The engine keeps two static tables:

```c
struct PakArchive { // 10 slots from 0x009ce3e0, 0x124 bytes each
  PakHeader hdr; // +0x000 "PAK" in hdr.magic means the slot is taken
  int fd; // +0x010 handle from _open(path, O_RDONLY|O_BINARY)
  int file_pos; // +0x014 cached _lseek position; -1 = unknown
  char path[0x104]; // +0x018
  bool (*on_error)(int code, const char *what); // +0x11c true = retry
  PakEntryMem *entries; // +0x120 count × 0x110
};

struct PakEntryMem { // 0x110 bytes — PakEntry with the name in a MAX_PATH buffer
  uint32_t offset, size, name_len;
  char name[0x104];
};

struct PakFile { // 100 slots from 0x009c74f0, 0x11c bytes each
  PakEntryMem entry; // +0x000 copy of the entry; entry.size != 0 means taken
  uint32_t pos; // +0x110 read position from the start of the file
  uint32_t archive; // +0x114 PakArchive slot index
  uint8_t *buffer; // +0x118 destination of the next reads
};
```

Error codes passed to `on_error` (default handler `PTR_FUN_00504a68`):

| Code | Meaning |
|---|---|
| -1 | short read (`_read` returned fewer bytes) |
| -2 | `_lseek` failed |
| -3 | no file of that name in the archive |
| -4 | archive will not open / bad header / no free slot |
| -5 | close failed |
| -6 | bad handle (`"OpenPakFile"`, `"ReadPakFile"`, `"ReadPakText"`, `"ClosePak"`) |
| -7 | read past the end of the file |

## Procedure map

| Address | Name | What it does |
|---|---|---|
| `004562d0` | `Pak_Open(path, on_error)` | opens an archive, loads the directory, returns the slot index |
| `00456870` | `Pak_Close(archive)` | closes files open in it, then the archive |
| `004569f0` | `Pak_CloseAll()` | closes everything and zeroes both tables |
| `00456ad0` | `Pak_OpenFile(archive, name)` | finds the name, takes a `PakFile` slot, returns its index |
| `00456810` | `Pak_CloseFile(file)` | frees the `PakFile` slot |
| `00456e60` | `Pak_ReadFile(file, buffer, size)` | reads `size` bytes from the current position (`size == 0` only sets the buffer) |
| `004579f0` | `Pak_ReadText(file, buffer, max, lo, hi)` | reads a token: skips bytes outside `[lo, hi]`, stops on the first such byte, writes NUL |
| `00489170` | `_strupr` | MSVC runtime |
| `00457eb0` | `Pak_FileSize(archive, name)` | entry size, −4 when missing |
| `00457f20` | `Pak_LoadFile(archive, name, dest, max)` | loads the whole file (or `max` bytes) in 64 KiB pieces |
| `00458030` | `Pak_Exists(archive, name)` | 1 when the name is in the directory |
| `007ca0d0` | `g_pakGlobal` | slot of `GLOBAL.PAK` |
| `0086f980` | `g_pakResource` | slot of `RESOURCE\RESOURCE.PAK` |
| `0046a900` | `Menu_OpenPak` | opens `MENU.PAK` |
| `0044d1d0` | `Game_Main` | game `main`: opens `RESOURCE.PAK` and `GLOBAL.PAK`, loads resources, starts the first scene |
| `0046b020` | `Launcher_Run` | start screen Intro/Start/Load/Quit |
| `00408950` | `Res_Load` | raw bytes of any archive file (not a `.BM` parser) |
| `00416a10` | `Res_LoadAlloc` | like `Res_Load`, with a buffer allocation |

Debug lines are printed by `printf` (`00487230`) when `g_debug` (`008f6875`) `!= 0`. In the Steam build that flag is always 0.
