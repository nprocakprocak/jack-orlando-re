# Saving and loading

How the original saves and loads, from the player's side: the Windows file dialogs, F2, F3, F5, and F6, the autosave, the launcher, and the dead slot window from an earlier version. The bytes of a `.SAV` are in [save.md](../formats/save.md).

Code: `packages/engine/src/save/` (`state.ts` turns a `SaveState` into bytes and back, `manager.ts` is `SaveManager`, `quick.ts` builds the names, `files.ts` is the picker, `store.ts` is a virtual directory, `slots.ts` is the ten slots, `textfield.ts` is the description field). The logic has no DOM and no clock. Tests use an invented store.

## 1. Paths and names

| File | Who writes it | Name |
|---|---|---|
| a manual save (F2, the save entry of the menu) | `Menu_Save` `0040b330` | whatever the dialog picks. With no extension the dialog appends **`.SAV`** or **`.SVL`** (`lpstrDefExt`) |
| a quick save (F5) | `Game_Run` `0042d260` | `SAVEGAME\` plus the quick-save prefix, a space, `RRRR-MM-DD HH-MM`, and `.sav` (`Save_MakeQuickName` `00408320`) |
| the autosave | `Game_Run` `0043b2b7` | `SAVEGAME\` plus the autosave prefix and `.sav` |
| the state from the start of the scene | `Game_Run` `0042bc4f` | `SAVEGAME\tempjs` (no extension) |

The directory is always `g_installDir` (`0x9fa980`) plus `SAVEGAME`.

The easy version (`g_easyVersion`, the registry value `EasyVer`) uses `.svl` / `.SVL` and the filter `(*.SVL)` instead of `.sav` / `(*.SAV)` in every one of those places (`004080e0`, `00408200`, `00408320`, `0043b2ff`). See [easy.md](easy.md).

The prefixes depend on `g_language` (`Game_Main` `0044d1d0`). The Polish build uses a quick-save prefix and an autosave prefix of its own (`g_quickSaveName` `0x722d28`, `g_autosaveName` `0x8977d8`). The English and German builds use their own prefixes for the quick save, and both use the same autosave prefix. The engine writes the Polish prefixes, so a file can be exchanged with that build: `Szybki Zapis RRRR-MM-DD HH-MM.sav` and `AUTO - ZAPIS.sav`. The dialog titles are separate string constants for the Polish build (encoded for the Windows dialog) and, for the other languages, entries of `g_guiStrings` (`0x8a8ae0`, a stride of `0x50`). See [gui.md](gui.md).

The case of the extension matches the files a window writes (`.SAV`) and the autosave (`.sav`).

## 2. The file dialogs (F2, F3, and the menu)

### 2.1 `SaveDlg_SaveFile` `00408200` and `SaveDlg_OpenFile` `004080e0`

One function in two versions: `(title, directory, result)`, an `OPENFILENAMEA` of size `0x4c` (the old layout, with no `pvReserved`), `hwndOwner` is `g_hwnd`.

| Field | Save (`00408200`) | Load (`004080e0`) |
|---|---|---|
| `lpstrFilter` | `"(*.SAV)"` and `*.SAV`, one entry, the description is the pattern itself. The easy version uses `(*.SVL)` | the same |
| `lpstrFile` / `nMaxFile` | `g_saveDlgPath` `0x551570`, cleared (the name field is **empty**), 250 bytes | the same |
| `lpstrInitialDir` | `g_saveDirBuf` `0x88f4d0`, the install directory plus `SAVEGAME` | the same |
| `lpstrDefExt` | `SAV` or `SVL` | the same |
| `Flags` | `0x8402c`, which is `EXPLORER`, `SHAREAWARE`, `ENABLEHOOK`, `NOCHANGEDIR`, and `HIDEREADONLY` | `0x8482c`, the same plus `PATHMUSTEXIST` |
| hook | `SaveDlg_SaveHook` `00407f40` | `SaveDlg_OpenHook` `00407d40` |

The result is `eax` from `GetSaveFileNameA` or `GetOpenFileNameA` (the function has no `return`, but `eax` reaches the caller). 0 means cancel, Esc, or the window was closed.

What shows in play:

- **No overwrite question** (`OFN_OVERWRITEPROMPT` is not set). Picking an existing file in the save dialog overwrites it with no warning.
- **No `FILEMUSTEXIST`** on the load dialog. Instead the hook on `CDN_FILEOK` (`-606`) calls `File_Exists` and, when the file is missing, rejects the choice (`SetWindowLongA(DWL_MSGRESULT, 1)`). The dialog stays open, with no message. `Menu_Load` checks `File_Exists` once more.
- Both hooks, on `WM_INITDIALOG` (`0x110`) and on a private message `0x40a`, center the dialog on the game: the point `(320, 240)` measured from the top-left of the game window's client area, and in full screen (`g_videoFlags & 2`) from `(0, 0)` of the screen. The window handle goes to `g_fileDialogHwnd` `0x9c54a4`. The game's window procedure sends it `0x40a` (center again), and the game's mouse handling is suspended while it is non-zero. After the return the caller clears `g_fileDialogHwnd`.

### 2.2 `Menu_Save` `0040b330`

The directory buffer is the install directory plus `SAVEGAME`. After `Timer_Sleep(200)`, `SaveDlg_SaveFile` runs. The dialog handle is cleared. If the player confirmed: when the scene is not saveable or Jack has not been placed, `Save_CopyTemp` writes the state from the start of the scene. Otherwise `00408560(path, 0)` writes the current state.

After a cancel, nothing happens (the game returns to the scene, or the menu stays open). After a save there is **no** message and no bar. A write error, if it is reported at all, comes from the file code. The string table has entries for a failed open, a failed write, and a failed read. Who displays them was not traced.

### 2.3 `Menu_Load` `0040b430`

After `Timer_Sleep(200)` and the same directory, `SaveDlg_OpenFile` runs. If the player confirmed and the file exists, `00409090` sets `g_gameLoaded` to 1.

`00409090` rejects a file of the other version **silently**. Byte 15 of the 0x50-byte header (`'l'` from the light-version header, `'n'` from the normal one) must match `g_easyVersion`. A mismatch returns without setting `g_gameLoaded`. A file with no game header is not checked past that one byte. The header strings themselves are in [save.md](../formats/save.md).

### 2.4 Who opens the dialogs, and what happens next

| Entry | Address | Before the dialog | After the dialog |
|---|---|---|---|
| F2 (`0x3c`) | `0042d7e5` | `Timer_Sleep(200)`. The item in the hand goes back (`Item_PutBackToBar` when `g_itemInHand`). `g_cursorMode` is 0. `Cursor_EnableDraw`. `Sprite_Remove` of the frame sprite. Effects pause (`Snd_TogglePauseFx`) | effects resume. The game continues in the same scene |
| F3 (`0x3d`) | `0042d8c4` | the same as F2 | if `g_gameLoaded`: `Cursor_ResetMode`, `0x86f985` is 1, the cursor sprite is removed, `SceneObj_RefreshAll`, and **`g_sceneChange` is 1**. Otherwise, if `g_newGameRequest`, the same plus `g_sceneName` becomes `SC001.CCG` and `0x79dfc8` is 0. Otherwise the sound resumes |
| the menu's save | `Menu_InGameOptions` `0040b580` | | the menu stays open |
| the menu's load | `Menu_InGameOptions` | | `g_gameLoaded` ends the menu loop. `Game_Run` (the cleanup at `0042eb34`) sets `g_sceneChange`. See [gui.md](gui.md) |
| the launcher's load | `0x6d504c` then `00438003` | the first frame of the starting scene. The music path is `TR02-22.PMS`. `g_cursorMode` is 0. No extra `Timer_Sleep` (only the one inside `Menu_Load`), and no effect pause | the same as F3. After a cancel the game **stays in SC001**. That is an ordinary new game |

The shared conditions of F2 and F3 (`0042d7fa`…`0042d877`): the bullet menu is closed, both faces are −1 (no conversation), `g_optionsRequest` is 0, the variable at the index in `0x7cde80` is not 0, `0x870cf8` is 0, the bar is hidden (`g_topBarY` is below `−0x48`, which it always is), the notice bar is hidden, and no macro is active. A failed condition means the key is ignored.

The launcher: `g_launcherResult` of 3 (the load button) makes `Game_Main` set `g_loadOnStart` `0x6d504c` to 1 before `Game_Run`. The start is always `SC001` ([architecture.md](architecture.md)), and the load dialog opens on the first frame, before the player does anything.

The `g_newGameRequest` branches after F3 and after the launcher's load are **dead** in this build. `Menu_Load` does not set the flag, and `Game_Run` clears it at the start of a scene (`0042be07`). They belong to the slot window `004098f0`, which has a new-game button (section 5).

## 3. The current state, or the copy from the start of the scene

A manual save (F2, the menu) and a quick save (F5) choose:

- `00408560(path, 0)`, the current state, when `g_sceneSaveable` (`0x87165e`) **and** `g_jackPlaced` (`0x7c7dff`);
- `Save_CopyTemp(path)` `00407bb0` otherwise: a copy of `SAVEGAME\tempjs`, the state written on entering the scene (`00408560(tempjs, 1)` during scene init, `0042bc3a`…`0042bc7a`).

`g_sceneSaveable` is set to 1 at the start of every scene. The script command `SAVEABLE n` (`Script_ExecStep` case `0xa1`, [scripts.md](scripts.md)) changes it. `Game_Run` forces it to 0 for `SC000C.CCG`, `SC002.CCG`, and `SC005B.CCG` when `LAST` is 0 (`0042c961`).

`g_jackPlaced` is 0 at the start of a scene and 1 the first time Jack is drawn (`Jack_Stand` `004150f0`, `004146e0`, `00415960`). Until Jack is standing in the scene (for example during the opening insertion), a save is also the copy from the start of the scene.

After a load of the current state (`g_restoreJackPose` is not 0), the scene's `PRE` runs in full, and in `INIT` `Script_ExecStep` `0041a330` skips the commands that place or move Jack (`SETPOSITION`, `INITFIRST`, `WALKTO`, `WALKTODIR`, `RUNINSERTION`, `PUNDERP`, and `PUNDERE` for `JACK`, and `STAY` and `ROTATETO` for every target). Jack stays where he was saved. A save during the walk out of the alley of SC006 at night is a copy, and Jack walks out of the alley. A save after he has stopped is the current state, and Jack stands.

For the player, a save in a scene "with no save" **is not blocked and is not reported**. It simply writes the state from the entry to the scene. Loading that file starts the scene over.

`Save_CopyTemp` writes its own header: a copy of the words "Jack Orlando" overwrites only the first 13 bytes of a buffer that still holds the rest of the header from the last `00408560`, and it writes 0x50 bytes. Copies therefore start with that short prefix and a truncated remainder of the normal header (the autosave, for example). Current-state saves have the full normal header (`start` saves, and `tempjs`). Because `tempjs` is written on entry to every scene, the rest of the buffer always comes from it, and byte 15 (`'n'` or `'l'`) matches. The exact header bytes are in [save.md](../formats/save.md).

## 4. F5, F6, and the autosave

### 4.1 F5 (`0x3f`) at `0042d260`

There are no shared conditions with F2 and F3. Only the key is checked, in the key step of the loop ([game_loop.md](game_loop.md)).

1. If the notice bar is hidden: `g_noticeAuto` is 1, and `Notice_Show(0x1cc, g_quickSaveName)` shows the quick-save caption at `y = 460`. The bar opens and closes by itself.
2. `Save_MakeQuickName` `00408320` builds the prefix, a space, `RRRR-MM-DD HH-MM`, and `.sav` (`GetLocalTime`, leading zeros, a hyphen as the separator, a space before the date and before the time. The easy version uses `.svl`).
3. The path is the install directory, `SAVEGAME`, and that name. The write is the choice in section 3.

The name has no seconds. Two F5 presses in the same minute overwrite the same file. Old quick saves **are not deleted**. The directory grows.

**The engine puts the held item away before every save, including F5.** The original F5 drops the item. `serializeSave` calls `putHandAway` (`Item_PutBackToBar`: the first free slot. A full coat means the item is lost, as on F2). The file stays in the original format.

### 4.2 F6 (`0x40`) at `0042d34d`

1. `_findfirst` / `_findnext` on the install directory, `SAVEGAME`, the quick-save prefix, and `*.*` (with no `_findclose`).
2. For each file: the slice of the name from `strlen − 20` up to the first dot (`RRRR-MM-DD HH-MM`), as a number of minutes: `(year−1900)·365·1440 + month·30·1440 + day·1440 + hour·60 + minute` (`atoi` on the slices from `Str_Substr` at 0, 5, 8, 11, and 14). The **first** file with the greatest value wins (the comparison is `>`).
3. A second `_findfirst` walks to the file at that index, then `File_Exists` and `00409090`.
4. If `g_gameLoaded`: `Cursor_ResetMode`, `0x86f985` is 1, the cursor sprite is removed, `SceneObj_RefreshAll`, and `g_sceneChange` is 1. No file means nothing, with no message.

The quirks.

- A month counts as 30 days, so the 31st of January equals the 1st of February. The hour then decides, and a save on the 31st at 23:00 "wins" over a save on the 1st at 10:00.
- The pattern `*.*` also catches files of the other version (`.svl` in the normal game). If the newest is the other version, `00409090` rejects it and F6 does nothing.
- The autosave and the manual saves do not take part. F6 loads only files with the quick-save prefix.

A result of 0 does not win. The engine keeps this date algorithm, including the 30-day month.

### 4.3 The autosave, `0043b2b7`

At the end of the **first frame** of every scene (the flag `0x5348bf`, cleared after the write of `tempjs` at `0042bc80`, and set here): `Save_CopyTemp` of the install directory, `SAVEGAME`, the autosave prefix, and `.sav` or `.svl`. It is always a copy of `tempjs`, with no bar and no check of `g_sceneSaveable`. One file, overwritten on every scene change, including after a load. It is loaded only through the F3 dialog or the menu.

## 5. The slot mode is a dead window, `004098f0`

### 5.1 What is left in the code

`SaveDlg_SlotLoadWindow` `004098f0` **has no callers**.

- A GUI window of 460×400, centered (`Gui_CreateWindow(0, 0, 0x1cc, 400, 1)`), a label from `g_guiStrings[7]` at the top (`Gui_AddLabel`, `y` is `0x10`). The string ends with `=?`, and `=` is an empty glyph. See [fnt.md](../formats/fnt.md).
- 10 slot buttons: `x` is 36 (`Gui_CenterOffset(460, 386) − 1`), `y` is `60 + i·28`, 386×24, the text is `g_guiStrings[9 + i]` (`0x8a8db0 + i·0x50`), and the name is a digit plus `_Load`.
- A new-game button (`g_guiStrings[36]`, `NewGame`, at `(20, 350)`, 220×32) and a cancel button (`g_guiStrings[19]`, `LoadCancel`, at `(340, 350)`, 100×32).
- After `Gui_RunWindow`: `NewGame` sets `g_newGameRequest` to 1, calls `Cursor_LoadSet1`, `Inventory_Clear`, `Var_LoadAll`, and loads the civilian walk frames (the same as the menu, [gui.md](gui.md)). Cancel or Esc returns `0xb`. A slot **loads nothing**: `g_slotWindowPicked` is 1, and the result is `0xb`. The result is the slot's character only when `g_gameLoaded` is already set, which this function cannot do (`g_gameLoaded` is 0 on entry).

Scaffolding in the **live** code that only makes sense with this window:

- `Menu_InGameOptions` sets `g_menuOpenForSlots` `0x89c5b8` to 1 and `g_menuWindowId` `0x723c6c`, clears `g_menuClosedBySlots` `0x88f675` and `g_slotWindowPicked` `0x79dee8`, and the menu loop also ends when `g_slotWindowPicked` is set. After the loop it closes the window only when `g_menuClosedBySlots` is 0. A slot window called from the menu used to close the menu itself (`Gui_CloseWindow(g_menuWindowId)`, `g_menuClosedBySlots` is 1). So **the menu's load entry used to call `004098f0`**.
- The "new game" branches after F3 and after the launcher's load (section 2.4). The slot window had a new-game button. The file dialog does not.
- `g_guiStrings[7]` and `[8]` exist in three languages. `[8]`, the save-slot title, is only written in `Game_Main`. **Nothing reads it.** The save-to-slot window was removed entirely.
- `Game_Main` sets the slot descriptions `g_guiStrings[9..18]` to empty strings in every language. The only other read and write is **slot 0 (`0x8a8db0`) as the buffer of a save file's header**: `00408560` and `Save_CopyTemp` write 0x50 bytes from it, and `00409090` reads 0x50 bytes into it. A save header is therefore exactly the size and the place of a slot description.
- The GUI text field (button type 1): `Gui_AddTextField` `0045f8d0` and the edit loop `Gui_EditTextField` `00461c20` (from `Gui_RunWindow`) work, but only two dead debug windows use them, one titled for a path and one for a password (`00406dd0`, `00429b50`). Editing: characters from the keyboard up to a limit, Backspace (8), code 7 clears the field, a blinking cursor, and Enter or Esc ends it.

The slot window does not know the easy version.

### 5.2 A trace in the data

A file `Jacksave.00a` (1135 bytes) has a header that is a menu caption in Mazovia instead of the format magic, the scene `SC032.CCG`, and the music `TR03-22.PMS`. The name `Jacksave` does not occur in this build's executable. Byte 15 of the header is 0, so the normal version accepts the file from the F3 dialog when the name is typed. The filter `*.SAV` does not show it. There are no `*.00x` files in this build's code.

### 5.3 A reconstruction

An earlier version had 10 slots in files named `Jacksave.00` plus a character.

- **Load:** on opening the window, each slot's 0x50-byte header was read into `g_guiStrings[9 + i]` (today `00409090` reads a header into slot 0, which is the relic). The slot button loaded the slot's file (the code between `Gui_RunWindow` and the check of `g_gameLoaded` was removed), then the window returned the slot's digit.
- **Save:** a window titled from `g_guiStrings[8]` and the same 10 buttons. After picking a slot the player typed a description in a text field (type 1, the only sensible user of that field besides the debug windows). The description went to `g_guiStrings[9 + i]` and into the file as the header. The German title's wording suggests that a name followed the title.
- `Jacksave.00a`: the suffix is a letter, not a digit. It may be a numbering `0…9, a…` (hexadecimal, `a` as an 11th place, for example an autosave), or another version. The header caption may have been typed by a player, or it may come from an old layout of the string table (today that caption is index 26).

What **is not** in the code, and cannot be recovered from it: the save-to-slot window, the pattern of the slot file names, the behavior of an empty slot, and the look of the description field.

### 5.4 The save-slot window, from an earlier version

An earlier version, seen in a recording, had a save window. This is an observation, not code. This build's executable has no save-to-slot window, so the engine reconstructs it from that observation and takes the rest from the GUI windows ([gui.md](gui.md)) and from the load window `004098f0`.

- The window is a GUI window like the F4 menu: a darkened scene underneath, and a frame (`Gui_CreateWindow`).
- The title is string 8, yellow, the large font, centered at the top.
- Under the title, 10 slot buttons, one under another, the full width of the window, with the slot's description at the left edge. The descriptions are white with a blue outline, in the small font. In the recording they are short labels a player typed, not numbers.
- A cancel button in the bottom-right corner. There is no OK button.
- Typing a description: a click on a slot presses it like a button, and a blinking underscore appears after the description. The player types a new description and confirms with **Enter**, which saves the game. That matches the GUI text field (`0045f8d0` / `00461c20`).
- No confirmation. After the save, no message says that it worked.

Decisions that are not facts from this executable (the save window is not in it), and that the engine follows:

- **Esc during editing** cancels the edit (the old description stays) and returns to the list. The next Esc, on the list, closes the window.
- **Enter** saves the game into the slot, the blink disappears, and the window **stays open** on the list (no confirmation).
- **The blinking underscore:** about 100 ms visible and 133 ms hidden (a period of about 0.23 s, about 4.3 Hz), measured from a 30 fps recording of the earlier version. Approximate (`BLINK_ON_MS`, `BLINK_OFF_MS`).
- **An empty slot** shows a short empty-slot label in parentheses. Angle brackets were the first choice, but in both fonts of the executable the characters `<`, `>`, and `[` are an empty glyph of 6×1, and `]` draws like `/`. `(` and `)` exist.
- Unsettled, from the recording: after a click on a slot the old description disappears before the new one is typed. That may be the player pressing Backspace.

The maximum length of a description is unknown. The engine uses 79 characters, which is 0x50 bytes of header including the NUL. Only ASCII and the Polish letters. Code 7 (the clear-field code in `Gui_EditTextField`) is skipped. A click on another slot moves the edit. An empty description becomes the scene name. An empty slot in the load window does nothing. A save into a slot uses the same "current state or the `tempjs` copy" rule, and puts the hand away, as F2 does. A slot is an ordinary `.SAV` in the `SLOTS` store (`slot<N>.sav` or `.svl`). The description is the 0x50-byte header. In the easy version byte 15 of the header is `'l'` (descriptions of up to 15 characters), so the original would accept the file too. A load from a slot does not check byte 15.

## 6. What the engine does

### 6.1 The default mode, file dialogs

- **F2 and the menu's save:** `showSaveFilePicker` (the filter `*.SAV` or `*.SVL`, the description `(*.SAV)`, and a **suggested name**. The original suggests none. The engine suggests `Jack Orlando.SAV`. The extension is appended when it is missing). The fallback is a download of a file whose name was typed in a plain window in the GUI style. There is no overwrite question of our own (the browser asks anyway). A cancel is nothing. Before the dialog the item in the hand goes back, the cursor goes to mode 0, and the effects pause. After it, they resume.
- **F3, the menu's load, and the launcher's load:** `showOpenFilePicker`, or an `<input type=file>`. A file of the other version is rejected silently. After a load, `g_sceneChange`. Load from the start screen starts `SC001` and opens the load dialog on the first frame. A cancel is a new game.
- **The choice of the current state or the `tempjs` copy** is section 3. The engine keeps an in-memory snapshot from the entry to the scene, the flag `sceneSaveable` (the command `SAVEABLE`, plus the three scenes forced off), and `jackPlaced`.
- **F5, F6, and the autosave** use a virtual directory `SAVEGAME`. The names match the original, so the files can be exchanged. F6 uses the same date algorithm, including the 30-day month. The quick-save bar is `Notice_Show(0x1cc)`.
- The key conditions of F2 and F3 are section 2.4. F5 and F6 have none of them.
- The file dialogs block the game. The original stands inside the modal `GetSaveFileNameA` (the game loop does not run). The engine pauses the logic and the effect sound for the duration of the picker's wait.
- A truncated file: the original reads it silently. The engine returns `{ ok: false, reason: "format" }`.
- An old file with 225 variables: the original overwrites `g_varCount` and loses 22 variables. The engine keeps every variable and fills the missing ones from the initial values (`loadedVars`). The engine **does not write** files whose `var_count` is not 247.

### 6.2 The legacy mode, slots

Faithful from the code: the load window `004098f0` (the layout, the texts, the buttons, NewGame and cancel, closing the menu, and the "new game" branches after F3 and the launcher). Reconstructed, and marked as a departure: ten slots, the save window of section 5.4, and the description field. F5, F6, and the autosave do not change. F2, F3, the menu, and the launcher open the slot windows instead of the pickers. The start screen chooses the mode (`packages/engine/src/start/modes.ts`, files or slots).

`SaveState` is what the host gathers: the scene, the track, the variables (500 places, `varCount` is 247), the inventory, Jack's pose (`g_jackSaved*`), `AUTOINCRANGE`, and the flags `sceneSaveable` and `jackPlaced`. `readSave` returns a `LoadedState`: the variable values (`loadedVars` fills the gaps from `VARIABLE.ALL`), the named variables (`JACKISWOJ`, `GUN`, `LAST`, `MARZECZY`, from which the host picks the uniform frames, the cursor set, and the coat region), `applyInventory`, the scene, Jack's position (only when `restorePose`), and `AUTOINCRANGE`. After a load the host does a full entry to the scene (`PRE` and `INIT`), as the original does.

```ts
const manager = new SaveManager({ store, slots, picker, light: easyVersion });
await manager.sceneStart(state); // on entering a scene, before PRE and INIT: writes the temp copy
await manager.autosave(); // the end of the first frame: the autosave, a copy of that temp
const r = await manager.quickSave(state);
const l = await manager.quickLoad(); // null means no file. { ok: false, reason: "version" } is a silent no
```

## Tests

`packages/engine/src/save` tests cover a round trip, the `tempjs` copy, the F5 departure, a full coat, the easy version, format errors, an old file of 225 variables, F5 and F6 (the names, the result, the 30-day month, a tie, a missing file), the file dialogs (the file-system API, a cancel, the fallback), the manager, the slots, the text field, and the slot window. The file format itself is tested in `packages/engine/src/formats/save.test.ts` on bytes built in the test. The store that uses IndexedDB (`jack-orlando-save`, the stores `SAVEGAME` and `SLOTS`) is a browser store. The tests use a memory store.
