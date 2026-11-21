# Saving and loading the game state

Wired into the game in `play/game.ts` (`PlayOptions.save` / `saveMode`). The host supplies `IdbStore`, `BrowserFilePicker`, and the save mode chosen on the start screen. Logic with no DOM and no clock. Tests use a fake store. The windows cover slots, F5/F6, files, and a view of a loaded `.SAV`.

| File | Contents |
|---|---|
| `state.ts` | `SaveState` (what the host fills in) ↔ `.SAV`: `buildSave`, `buildTemp` (`tempjs`), `serializeSave`, `readSave` → `LoadedState`, `loadedVars`, `namedVars`, `applyInventory` |
| `manager.ts` | `SaveManager`: `sceneStart` (tempjs), `autosave`, `quickSave`/`quickLoad` (F5/F6), `saveToFile`/`loadFromFile` (F2/F3), `saveToSlot`/`loadFromSlot` |
| `quick.ts` | names `Szybki Zapis RRRR-MM-DD GG-MM.sav`, `AUTO - ZAPIS.sav`, and the search for the newest file for F6 |
| `files.ts` | `BrowserFilePicker`: the File System Access API, or `<input type=file>` plus a download |
| `store.ts` | `SaveStore` (a virtual directory), `MemoryStore` (tests), `IdbStore` (IndexedDB `jack-orlando-save`: stores `SAVEGAME` and `SLOTS`) |
| `slots.ts` | `SlotStore` (10 slots), `SlotWindow` (the load and save windows), `SLOT_TEXTS_PL` |
| `textfield.ts` | the text field (the slot description) |

## Use

```ts
const manager = new SaveManager({ store: new IdbStore("SAVEGAME"), slots: new IdbStore("SLOTS"),
                                  picker: new BrowserFilePicker(windowPickerEnv()), light: easyVersion });
await manager.sceneStart(state);        // on entering a scene, before PRE/INIT: writes tempjs
await manager.autosave();               // end of the first frame of the scene: AUTO - ZAPIS.sav (a copy of tempjs)
const r = await manager.quickSave(state);   // F5; show the quick-save notice
const l = await manager.quickLoad();    // F6; null = no file; { ok:false, reason:"version" } = silently nothing
```

The host collects `SaveState` from the game world: the scene, the track, the variables (500 places, `varCount` = 247), `Inventory`, Jack's pose, `AUTOINCRANGE`, the flags `sceneSaveable` (the `SAVEABLE` command plus the fixed scenes SC000C/SC002/SC005B) and `jackPlaced`. `readSave` returns `LoadedState`: variable values (`loadedVars` fills the missing ones from `VARIABLE.ALL`), `namedVars` (`JACKISWOJ`, `GUN`, `LAST`, `MARZECZY` — the host uses these to choose the uniform frames, the cursor set, and the coat region), `applyInventory`, the scene, Jack's position (only when `restorePose`), `AUTOINCRANGE`. After a load the host does a full scene entry (`PRE`/`INIT`), as the original does.

## From the original

- The choice between the current state and the `tempjs` copy is `sceneSaveable && jackPlaced`. The copy has a copy header (`copyTemp`).
- Autosave is always a copy of `tempjs`. F6 is the original search, including the "month of 30 days" quirk and files of the other version in the results. The first file with the greatest value wins. A score of 0 never wins.
- Easy version: `.SVL`, a "light ver" header. A file of the other version is refused silently.
- The slot load window: 460×400, a title, 10 buttons of 386×24 at `x = 36`, `y = 60 + 28·i`, "start a new game" at (20, 350) and "cancel" at (340, 350).

## Differences and reconstructions

- **The item in the hand is put away before every save, including F5.** The original F5 loses that item. `serializeSave` calls `putHandAway` (`Item_PutBackToBar`: the first free slot; a full coat means the item is lost, as on F2). The file stays in the original format.
- **File windows.** The original uses a modal `GetSaveFileNameA` / `GetOpenFileNameA`, filter `(*.SAV)`, an empty name field, and no overwrite question. The engine uses `showSaveFilePicker` / `showOpenFilePicker` (Chromium) with the filter `(*.SAV)` and a **suggested name** (default "Jack Orlando.SAV"; the original suggests none). The browser asks about overwrite itself. Firefox/Safari: `<input type=file>` to load and a download to save (no directory choice). The extension is added when it is missing (`lpstrDefExt`).
- **Variables after loading an old file** (`Jacksave.00a`, 225 variables): the original overwrites `g_varCount` and loses 22 variables. The engine keeps all of them and fills the missing values with the initial ones (`loadedVars`). The engine **does not write** files with `var_count ≠ 247`.
- **A format error:** the original reads a truncated file silently. The engine returns `{ ok:false, reason:"format" }`.
- **The `SAVEGAME` directory is IndexedDB** (the names match the original, so files can be exchanged with an installation through the file windows).
- **Slot mode is a reconstruction** (not original code). The save window follows the observed layout: a title, 10 buttons with descriptions (the small font, text at the left edge), a click presses the slot and shows a blinking `_`, Enter saves, Cancel is in the bottom right corner, **with no confirmation**. Decisions:
  - the field starts from the slot's current description; a description is at most 79 characters (a 0x50-byte header including the NUL); only ASCII and Polish letters; Backspace deletes; code 7 (clearing the field) is skipped;
  - Escape during editing cancels the edit (the old description stays) and returns to the list; the next Escape closes the window. Enter saves, the caret disappears, and the window **stays open** on the list (the button shows the new description; the caller refreshes it with `setDescriptions`). An empty slot shows the caption from `SLOT_TEXTS_PL.empty`. Angle brackets, `[`, and `]` are blank glyphs in the Resource.pak fonts (`]` is a drawn glyph only in the executable copies);
  - the `_` blinks about 100 ms on and 133 ms off (period ≈ 0.23 s, ~4.3 Hz), measured from a recording of an older version (30 fps, about 3 and 4 frames), approximate (`BLINK_ON_MS`, `BLINK_OFF_MS`);
  - a click on another slot moves the edit;
  - an empty description becomes the scene name (for example `SC013`); an empty slot in the load window does nothing; a slot save uses the same "current / tempjs copy" rules and puts the hand away, as F2 does;
  - a slot is an ordinary `.SAV` in the `SLOTS` store (`slot<N>.sav` / `.svl`). The description is the 0x50-byte header. In the easy version byte 15 of the header is `'l'` (descriptions up to 15 characters) so the original will accept the file too. Loading from a slot does not check byte 15;
  - the load-window title in the exe ends with an equals sign before the question mark. The window shows the question mark (the meaning of `=` is unknown);
  - no window hotkeys (`Gui_SetHotkeys`) and no menu inside the window. F2/F3/F4 open it, and the start screen chooses the mode.

## Tests

`save.test.ts` builds its state in the test: a round-trip, the `tempjs` copy, the F5 difference, a full coat, the easy version, format errors, an old file of 225 variables, F5/F6 (names, the result, the 30-day month, a tie, a missing file), the file windows (File System Access, cancel, the fallback), the manager, slots, the text field, and the slot window (events). File-format agreement for the save file itself lives in `formats/save.test.ts`. This module does not add another decoder. `IdbStore` is checked only in the browser (the demo).
