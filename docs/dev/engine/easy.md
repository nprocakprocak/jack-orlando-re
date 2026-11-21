# The easy version (`EasyVer`, `LIGHTVER`)

Where the executable gets the easy mode, what it does with it, and what the variables `LIGHTVER` and `GUN` change in the scripts.

## What the engine has to do

1. **Easy mode is one flag `g_easyVersion` in {0, 1}**, read from the registry once, at process start. Nothing in the executable changes it during play. An external launcher sets it (§1). In the engine the flag is chosen in the configuration **before** the session starts, and it stays fixed for the session.
2. **Four things, and nothing else in the executable changes:**
  - **`GUN = 1` plus cursor and bullet set `_2`** (`Cursor_LoadSet2`) at the start of the game and on every new game. `Cursor_LoadSet2` itself sets `GUN = 1` ([bulletmenu.md](bulletmenu.md)), and the executable also calls `Var_Set("GUN", 1)`. Do both.
  - **`LIGHTVER = 1` (instead of 0) at the start of EVERY scene**, before `[PRE]` (`Game_Run` `0042bb86`, §3). Setting it once in the variable table at startup is not enough. `Var_LoadAll` (a new game) loads the defaults from `VARIABLE.ALL` (there `LIGHTVER` is 1 and `GUN` is 0), and loading a save substitutes the saved values. The flag has to be overwritten every scene.
  - **The save suffix and header:** `.svl` and filter `(*.SVL)` instead of `.sav` and `(*.SAV)`, header `"Jack Orlando - light ver"` (byte 15 = `'l'`) instead of the normal-version header (`'n'`). Loading a save from the other mode is **silently ignored** (§4). Where saves live in IndexedDB, keep a separate space or field for the mode.
  - Nothing else. **The window title, the right-button cursors, the verb menu, and the top bar do not differ** (§2, §5).
3. **Order at start:** `Var_LoadAll` (`GUN = 0`) → `Cursor_LoadSet1` (because `GUN == 0`) → `Game_Run`. In its prologue, easy mode only: `Cursor_LoadSet2` plus `Var_Set("GUN", 1)`. Then the start of the scene loop: `LIGHTVER` → `JACKISMENU` → the `tempjs` save → reset of the scene variables → `[PRE]`. The `tempjs` save (`Save_WriteState(…, 1)`, `0042bc3a`) runs **after** `LIGHTVER` is set, so it already holds the current value.
4. **A new game from the menu (`NewGame`, `Menu_InGameOptions` `0040b580`):** `Cursor_LoadSet1` → `Inventory_Clear` → `Var_LoadAll` (zeroes every variable, including `GUN`) → after the menu loop, **if `g_easyVersion`**: `Cursor_LoadSet2` plus `Var_Set("GUN", 1)`. `LIGHTVER` is not touched here. The start of the next scene sets it.
5. **No switching during play.** In the original the mode changes only through the launcher and a process restart. `LIGHTVER` is forced every scene, so it could technically change on the fly, but world state built in mode A (dialogue options turned off in `[PRE]` of SC001, `GUN`, `LOC5`, `ALICEMALYZ`) does not match the scripts of mode B, and the saves are separate. The mode is chosen **only on the start screen**, and it is stored with the game. Changing the mode means a new game. The in-game options do not get an easy-mode switch.
6. **Saves do not carry the mode in the variables**, only in the header (byte 15). The variables `LIGHTVER` and `GUN` are in the save, like every variable, so after loading a save of the same mode everything matches with no extra work (`Save_LoadState` picks the cursor set from the saved `GUN`, `00409090`).

## 1. Where `g_easyVersion` comes from

- `Reg_LoadConfig` `00469a30` (called from `Sys_InitConfigAndCd` `00469b70`): `HKLM\Software\TopWare Poland\Jack Orlando`, DWORD `EasyVer` → `g_easyVersion = (value != 0)` (`0x5348ac`). On 64-bit Windows the key is under `WOW6432Node`. The game **never writes** `EasyVer` (`Reg_SaveConfig` `004699a0` writes only `Config`).
- The launcher `JackStart.exe` (a Delphi program next to the game) contains the same registry paths, the names `InWindow` and `EasyVer`, and the name `JackOrlando.exe`. Its start window writes `EasyVer` and `InWindow`, then starts `JackOrlando.exe` (`g_launcherResult`; `Game_Main`: `== 3` → `g_loadOnStart`). It was not taken apart. Which control writes the value is a hypothesis, from the strings.
- A Steam install creates `EasyVer = 0`.

## 2. Every place that reads `g_easyVersion`

| Address | What easy mode does |
|---|---|
| `Reg_LoadConfig` `00469a30` | the source of the flag (§1) |
| `Game_Run` prologue `0042bb69` | `Cursor_LoadSet2()`; `Var_Set("GUN", 1)` (bytes `6a 01 68 <"GUN"> e8`) |
| `Game_Run` `0042bb86` (every scene) | `Var_Set("LIGHTVER", g_easyVersion ? 1 : 0)` (bytes `6a 01` / `6a 00`, string `004f8158`) |
| `Game_Run` autosave `0043b2b7` | the autosave file name uses the suffix `.svl` (`004f7170`) instead of `.sav` (`004f7168`) |
| `Save_MakeQuickName` `00408320` | the same for the quick-save name (date and time, plus the suffix) |
| `Save_WriteState` `00408560` | the header description is the light-version string instead of the normal-version string (hence byte 15 is `'l'` or `'n'`) |
| `Save_LoadState` `00409090` | after the header: easy mode and byte 15 is not `'l'`, or normal mode and byte 15 is `'l'` → `fclose; return` (no message, no `g_gameLoaded`) |
| `SaveDlg_OpenFile` `004080e0`, `SaveDlg_SaveFile` `00408200` | default extension `SVL` / `SAV`, filter `(*.SVL)` / `(*.SAV)` in the Windows file windows |
| `Menu_InGameOptions` `0040b580` (after the loop, `NewGame`) | `Cursor_LoadSet2()`; `Var_Set("GUN", 1)` |

There is no difference in the game window title (the light-version wording is only the save description, not `SetWindowText`), in cursors beyond set `_2`, in the menu, the bar, the bullets, the music, the movies, or scene loading. Every other difference is in the **scripts**, through `LIGHTVER` (§3).

Two "new game" paths: `SaveDlg_SlotLoadWindow` `004098f0` (the dead slot window, [savegame.md](savegame.md)) has its own `NewGame` (`Cursor_LoadSet1`, `Inventory_Clear`, `Var_LoadAll`) **with no** easy-mode branch. The easy branch was added later, only in `Menu_InGameOptions`. After the end movie (`Game_Run`) there is `Cursor_LoadSet1` and no weapon is added. A new game then goes through the menu (`g_optionsRequest`), which is the path in the table.

## 3. `LIGHTVER` and `GUN` in the scripts

122 conditions `If LIGHTVER n` or `If GUN n` (`GLOBAL.MCC` has none) in 36 scenes. `LIGHTVER` is set **only** by the executable (`VARIABLE.ALL` has `LIGHTVER 1` as the default, overwritten every scene). No script does `Let LIGHTVER`. `Let GUN 1` occurs only in SC014 and SC015 (taking the revolver). Outside `*.MCC` the name `LIGHTVER` occurs only in `VARIABLE.ALL` and in the executable.

**L1** runs in easy mode (`LIGHTVER 1`). **L0** runs in normal mode (`LIGHTVER 0`).

| Scene | Macro | Difference |
|---|---|---|
| SC001 | `PRE` | L1 and L0 each turn off a different set of dialogue options (1100, 1200, 1300, 1400). Each mode has a different set of available lines |
| SC006 | `POKAZANIE-AUTOJAC` | `If LIGHTVER 1` and `If GUN 0` would speak line 210. In easy mode `GUN` is 1 from the start, so the block is **unreachable** (unless a script does `NOHAVEGUN`). |
| SC009 | `PRE`, `REKAWI.BM-IPODK.BM` | `SetDialog` on options 1700, 1900, 2000, 2100, 2200, 2300. Several talk options change availability |
| SC013 | `PRE`, `ZMIOT.BM-ALICE` | L1 sets `LOC5` when the rag is held, sets `ALICEMALYZ` up front, and the whisk takes Alice immediately (the shorter path, with no spoon condition). L0 requires `ALICEMALYZ` and the rest. |
| SC014, SC015 | `BRANIE-SK`, `PATRZENIE-SK` | by `GUN`, not `LIGHTVER`. `GUN 1` speaks a random line (the gun is already there, nothing is taken). `GUN 0` takes the revolver from the hiding place (`Let GUN 1`). In easy mode the hiding place is empty |
| SC032A | `PRE`, `INIT`, `GAD_C`, `GANGSTERZY` | `GUN 0` plays the death insertions. `GUN 1` plays the full shoot-out. L0 also starts the inspector and the police. L1 walks Jack somewhere else and has no inspector |
| SC033, SC038, SC040 | show-door, `INIT`, show-right | L0 adds lines and cutaways. L1 in SC040 sets `SC201SWIECI` |
| SC042 | `PRE`, about 12 macros | the fight: L0 always enters the fight. L1 enters it only when the bat is held. In `PRE`, L1 turns off dialogue options 1000, 3000, and 5000 when the bat is absent |
| SC051 | `CZEKAJ`, slap and shoot macros | L0 kills Jack after 4 seconds. L1 only unblocks macros. No killing. |
| SC053, SC058, SC059, SC063, SC071B, SC077, SC079 | `PRE` and macros | L0 shows objects and animations that depend on earlier actions. L1 shows that object or animation **at once** (for example SC063 always shows the fan, SC058 sets the guard-asleep and the bullet-taken flags and turns the rooster off) |
| SC054 | `JACK_OCHR_WYCH` | L1 sets the guard-tied flag with no action |
| SC062 | `Q9200` | L1 adds a further conversation (340/350) |
| SC082, SC083, SC084, SC086 | the gang, shoot, and key macros | **L1: `DeactiveSelf`**. Every gangster and shoot-out macro is off. There is no threat. L0 in `INIT` sets Jack's tempo (SC083, SC084, SC086) and the gang animations (SC086) |
| SC085 | show-right | L1 checks two item flags. L0 also requires the anchor |
| SC086 | `PRE` | L1 sets the key-dropped flag and turns area `WYLA` off. The key has already "fallen" |
| SC087 | `PRE` and the kill, slap, shoot, and show-down macros | L1 turns area `DOL` off, sets `LOC5`, turns the slap into the shoot, and turns `STRZELAJ` off. L0 runs the longer kill sequence |
| SC093 | `DIALA` | L0 arms a kill after 5 seconds if the gun is not used. An author comment in the script says so. L1 has no such arming |
| SC101, SC106, SC111, SC117 | `PRE` | L1 calls `SetArea` with zeroes (`TO_OUT`, `LEWO`, `PRAWO`) when Jack is not in the uniform. Whether that disables the area is a hypothesis. See [areas.md](areas.md) |
| SC105 | take-uniform | L1 grants the pass and sets the pass flag at once |
| SC107 | `PRE` and several show and use macros | L0 plays the bartender scenes when a flag is 0. L1 starts macro `C1` instead of lines 130, 872, and 65 |
| SC204, SC205 | show-stone, `PRE`, show-in, look | L1 shows the stone at once, opens `TO_IN`, and uses line 110. L0 depends on earlier flags and plays a door sound |
| SC055A | `PRE` | by `GUN`. `GUN 0` leaves the revolver in the scene at (250, 293). `GUN 1` moves it off screen at (0, 500). In easy mode there is nothing to take |

Scenes with a hit: SC001, 006, 009, 013, 014, 015, 032A, 033, 038, 040, 042, 051, 053, 054, 055A, 058, 059, 062, 063, 071B, 077, 079, 082–087, 093, 101, 105–107, 111, 117, 204, 205. Who kills whom is a hypothesis until the scene is played.

What play confirms, against the scripts:

- Jack cannot die and cannot be sent to jail, because the scripts turn the gangster macros off and omit the kill commands. There is no general immortality flag in the executable.
- The revolver is there from the start, so the early arrest does not happen. `GUN = 1` from the executable. In SC032A, `GUN 0` is the death and `GUN 1` is the sequence without a killing.
- The inspector is missing in one scene. SC032A starts those macros only when `LIGHTVER` is 0.
- The hired killer does not enter the hotel room. SC086 and SC087 turn themselves off in L1 and have no kill macro.
- Another killer does not shoot after the talk, and he can be stunned with no time pressure. SC093 and SC051.
- The informant does not appear at the boss even if he was not tied. SC054 sets the tied flag in L1.
- Items appear in scenes without the earlier actions. SC053, SC058, SC063, SC105, and the rest.
- Dialogues that lead to fatal fights are turned off. SC001, SC009, and SC042 `PRE` use `SetDialog`.

Also in the code, and easy to miss: extra or shorter lines (SC062, SC107), different exits (SC101–SC117, SC205), a different look of SC086 (gang animations only in L0), and empty weapon hiding places (SC014, SC015, SC055A).

Checked in easy mode:

- **SC006, the key on the car.** Jack gets in and drives off. Line 210 is not heard. The block that speaks line 210 requires `LIGHTVER 1` **and** `GUN 0`. In easy mode `GUN` is 1, so it is skipped and the macro continues (the cursor becomes the item, Jack walks to 530, 479, the key leaves the hand, and `FLX0` drives off). Line 210 plays in neither easy mode (`GUN` is 1) nor normal mode (`LIGHTVER` is 0). It looks dead, unless `GUN` returns to 0.
- **SC086, SC087, SC093.** The gangsters do not appear or do not attack. The gun has no time pressure. That matches §3.
- **SC014 and SC015.** The hiding place is empty because the revolver is already there. Jack speaks a random line. That is an explicit `TalkRandom` in the `If GUN 1` branch, not a default refusal. Dialogue `10000` is a pool, picked through `RAND`.
- **A save from the other mode.** Nothing happens. The window closes. The game does not load. That matches `Save_LoadState`.

## 4. Saves

[save.md](../formats/save.md) and [savegame.md](savegame.md): `.svl` versus `.sav`, an 0x50-byte header, byte 15 `'l'` or `'n'`. The game **silently rejects** a save from the other mode, so the easy-mode list does not show normal saves, and the other way around (the suffix plus the file-window filter). A save does not contain `g_easyVersion` as such. It contains the header byte and the variables.

## 5. Notes on the other documents

- [bulletmenu.md](bulletmenu.md): easy mode does not change the menus themselves, only the weapon. Confirmed (§2).
- [architecture.md](architecture.md): at the start of a scene the game sets `GUN` and `LIGHTVER`. More precisely, `GUN` is set once in the prologue and on a new game, and `LIGHTVER` is set every scene.
