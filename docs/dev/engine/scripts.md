# The game scripts: `.MCC` macros, the compiler, and the interpreter

A scene script is `SCxxx.MCC` from the scene archive (encrypted text, [textcrypt.md](../formats/textcrypt.md)). `Scene_Load` compiles it once on entering the scene (`Script_CompileMacros` `00440cb0`), and `Game_Run` runs the macros one command per frame (`Script_ExecStep` `0041a330`). The scripts run the whole game: Jack's position, the other persons, the animations, the dialogues, the items, and the changes of scene.

The compiler is `packages/engine/src/script/compiler.ts`. The interpreter is `packages/engine/src/script/interpreter.ts`, driven by the host.

## Numbering: `case N` is code `N + 1`

`Script_ExecStep` does `switch (code - 1)` (`uVar8 = iVar5 - 1; if (uVar8 < 0xa3) switch (uVar8)`), so a `case N` in a listing handles **code `N + 1`**. That is why the labels look shifted:

- `case 0x21` (taking an item, `g_cursorMode = 5`) is code `0x22`, `TAKE`, not `TALKRANDOM` (`0x21` is `case 0x20`, a random line).
- `case 0xa1` (a fatal exit) is code `0xa2`, `EXITTODOS`. `case 0xa2` (a key) is `0xa3`, `ANYKEY`. `case 0xa0` is `0xa1`, `SAVEABLE`. The numbering is consistent.
- `case 0x52` (`g_cursorMode = 3`, the shoot prefix) is `0x53`, `CURSORAS`. `UNLOCK` (`0x52`, `case 0x51`) only sets a macro flag. `case 0x43` (`Cursor_LoadSet1`, mode 3 becomes 0) is `0x44`, `NOHAVEGUN`. `HAVEGUN` (`0x43`, `case 0x42`) calls `Cursor_LoadSet2`.

This note gives the **codes** (as in the compiler). `case` is the code minus 1.

## The shape of a file

A file is a sequence of tokens (runs of bytes above 0x20). Lines and indentation do not matter. An optional comment may sit before the first macro: a token that is exactly `/` opens it, and the next `/` closes it. `/*` and `*/` work the same way. Comments are recognized only before the first macro and in the place of a command word, not between arguments. A token that starts with `/` but is not exactly `/` is an ordinary word.

A macro is a token that starts with `[`. The name is the token without the first and the last character, passed through `_strupr`. In the macro table `g_macros` `0x54d870` each entry is 0x46 bytes: the name is 0x3c bytes, `+0x3c` is the first command, `+0x3e` is the command count, `+0x40` is the counter `pc`, `+0x42` is active, and `+0x43` / `+0x44` are the flags `UNLOCK` / `OUTMACRO`.

Action macros are named `<VERB>-<ZONE>`. See [areas.md](areas.md).

A command is a word, `_strupr`, looked up in a chain of 155 `strcmp`. An **unknown word** becomes `DONOTHING` (`0x6f`) and, like `DONOTHING`, consumes the next token as a number. There are no unknown words in the data. Arguments are not uppercased. Name comparisons (`JACK`, `LEFT`, a person's name) are exact.

A command record in `g_macroCommands` `0x723fb0` is 0x6c bytes: the code (`+0`), `n1` (`+2`, 40 bytes), `n2` (`+0x2a`, 40 bytes), `a[0..6]` as shorts at `+0x52`…`+0x5e` (fields `0x29`…`0x2f`), `f` as a float at `+0x60`, and `c` as the first character of a flag token at `+0x68`.

Limits: a macros error (it prints the command count and the macro count, then `exit(0)`) when, after a command, the command count is above 1499 or the macro count is above 149. The longest script has 1431 commands.

The end: after every command, when the text cursor has reached the end. Other ends of the text go wrong in the game (the engine reports a macro error). The end of the text where a command word should be (an empty last macro, a comment at the end), or inside a comment: `Text_NextToken` then keeps returning the same token and the loop does not end. The end in the middle of the arguments: the game would use the old contents of the buffers. None of these occurs in the data.

`If`…`EndIf`: one counter `g_macroIfDepth` `0x723c0a` for the **whole file** (not per macro). `IFANSWER`, `IF`, and `IFF` store the current depth in `a[1]` and increment it. `IFMOUSEXM` and `IFMOUSEXW` only increment it. `ENDIF` decrements it. A negative value is a fatal exit (the message says there is no `If` for the `EndIf`). An unclosed `If` at the end is not a compile error. In the data the counter always returns to 0. The stored depth is not used at runtime.

A debug mode appends every word to a debug log and prints it on screen. The M key shows which macro is on which command.

### Kinds of argument

| Written | Read | In the record |
|---|---|---|
| `N` | `Text_ReadShort` (atoi to int16) | `a[i]` |
| `F` | `Text_ReadFloat` (atof to float32) | `f` |
| a name | `Text_NextToken` | `n1` / `n2` |
| `V` | a number, or `*VARIABLE` | `a[i]` is the number or the variable's index, and a flag `a[j]` is 1 for a variable |
| `±` | a flag token; the first character counts | `c`: `-` waits for the end, `+` does not wait; `L` / `R` is the side of the face |

The game turns the names of things in the scene into indexes at compile time. The engine keeps them as `refs = [slot, kind, name]` and resolves them at runtime. The kinds and the lookup functions:

| Kind | Function | Result |
|---|---|---|
| `person` | `Script_FindPerson` `00412980` | `JACK` → `0x66`, a person from the `.PCS`, otherwise −1 |
| `anim` | `Script_FindObjAnim` `00413100` | an object animation `.ACI` / `FLXn` (`g_objAnimCount`), or −1 |
| `shadow` | `Script_FindShadowAnim` `00413190` | animation entries past `g_objAnimCount` (shadows), or −1 |
| `object` | `Script_FindSceneObject` `00413230` | a `.CCG` object (the picture's file name), or −1 |
| `sound` | `Sound_FindSceneSfx` `00407b30` | a scene or global sound |
| `line` / `dialog` | `Script_FindTalkLine` `0040d9b0` / `Script_FindDialog` `0040da40` | a line or a `.DCN` dialogue, by number |
| `face` | `Script_FindFace` `0040dad0` | a `.FCC` face |
| `area` | a loop over `g_areaName` with the repeat number | an `.ACE` zone (the name plus the n-th entry of that name) |
| `var` | a loop over `g_varNames` (`VARIABLE.ALL`) | the variable's index |

An unknown variable: the compiler leaves the old index (the records are shared across scenes). The only such case in the data is the typo `WIOWIL` in SC107. The engine then reads 0 and logs it.

## Execution

### Who starts macros, and when

| Where | What |
|---|---|
| `Game_Run` `0042c836`…`0042c86d` | `Script_StartMacro("PRE")`, then `Script_ExecStep` **in a loop until the macro ends**, before the first frame, with no waiting (the loop looks only at the active flag) |
| `Game_Run` `0042cafd` | `Script_StartMacro("INIT")`. It runs in the frames |
| `Game_Run` `0043014a`…`004301ba` | every frame (when `0x8f6913` is 0): for each macro in order that is active, is not waiting (`0x6c26b8[i]`), and when `0x79dfcc` is 0, **one** command (`Script_ExecStep(i)`) |
| `Game_Run` `0042fa60` | the timed macros `CO60` / `CO30` / `CO10` from the counter `g_macroTimer` `0x51fa5c`. |
| `Game_Run` `0042fac1` | `ACTIVEMACROAT`: after a given number of frames |
| `Game_Run` `0043923c` | `TOPWARE` (the mouse position). See [cheats.md](cheats.md) |
| `Area_ClickMacro` `004243a0`, `004248d0` | a click on a zone: `<VERB>-<ZONE>` or `PIERDOLA-…`. Before that, `Script_InterruptOutMacros` |
| the command `ACTIVEMACRO` | any macro, by name |

`Script_StartMacro` `004247c0` goes to `Script_FindMacro` `0040d8b0`. The first macro of that name that is not blocked (`BLOCKMACRO`, `0x722d58`) gets `active = 1`, `pc = start`, the operation counter `0x723c70 = 0`, and `0x6c26b8 = 1` (it may run). It also works on a macro that is already running. It starts that macro over from the beginning. A missing macro: index −1, and a write under `0x6c26b8[-1]`.

### A step of `Script_ExecStep(i)`

1. When `pc − start` is at or past the command count, the macro ends (`active = 0`). If the last command that ran was Jack's `WALKTO`, `Jack_Stand`. The end is therefore noticed on the **next** step after the last command.
2. It remembers the code and the record of the current command (`0x6bd6c0`, `0x7c7920`), unless the command is `IF` or `ENDIF`.
3. `switch (code − 1)`. An unknown code prints that the command was not recognized, with the two numbers, and waits for a key.
4. `pc + 1`, always. Commands that **wait by repeating** do `pc − 1` first.

The variable `bVar9 = (the macro's name is not "INIT")` and the flag `0x79dfcc` (a loaded game; this is also the logic pause `g_logicFrozen`, [game_loop.md](game_loop.md)) mean that after a save is loaded, `[INIT]` does not move Jack (`SETPOSITION`, `WALKTO`, `INITFIRST`, and the rest, of JACK).

### Waiting

Three mechanisms:

- **Asynchronous operations** (`WALKTO`, `WALKTODIR`, `RUNINSERTION`, `ANIMA` in modes 1, 3, and 5, `ROTATETO`): the command increments `g_macroPending` `0x723c70[i]`, and with the flag `-` it sets `g_macroRunnable` `0x6c26b8[i] = 0`. The end of the operation decrements the counter, and at 0 it sets `0x6c26b8[i] = 1`. A macro with `-` therefore starts only when **all** of the operations it started have finished, including the ones with `+`. See [frame.md](frame.md).
- **A talk**: `TALK`, `TALKRANDOM`, and `TALKRANDOMINDEX` with `-` set `0x6c26b8[i] = 0`. The end of the line (`00413e20`) restores 1. `DIALOG` always waits (until an answer is chosen).
- **Repeating** (`pc − 1`): the command comes back every frame until the condition holds. `SHOWFACE`, `MUSIC` (the fade), `WAITWHILE`, `WAITWHILEANIMA`, `WAITTOANIMAFRAME`, `WAITWHILEEFFECT`, `DONOTHING n` (the counter `0x74b8e0[i]`), `PAUSE`, `PICKUP`, `GIVE`, `SHOOTF`, `SLAPF`.

In `[PRE]` waiting does not work (the loop at `0042c849` ignores `0x6c26b8`), and a command that repeats forever would hang the game.

### Conditions and jumps

`IF var n` runs the block when `var == n`. `IFF var op n` is `>`, `=`, or `<` (`a[3]` is 0, 1, or 2). `IFANSWER dialog n` runs when the dialogue's answer (`0x6dac80`) equals `n`. `IFMOUSEXM x` runs when the click's x is ≤ `x`. `IFMOUSEXW x` runs when it is ≥ `x`. An unsatisfied condition moves `pc` to the matching `ENDIF`, counting `IFANSWER`, `IF`, `IFMOUSEXM`, `IFMOUSEXW`, and `IFF` as openings (`case 0x1a`). The loop does not stop at the end of the macro. The exception: in `IFANSWER`, three of the five comparisons are done on the wrong variable, so only `IFANSWER` and `IF` count. It is dormant. `ENDIF` does nothing. There is no `Else` and no loop. Loops are made with `REACTIVESELF` (from the start) or `ACTIVEMACRO` of the macro itself (a restart, but after it `pc + 1`, so from the second command).

### Macro flags

- `UNLOCK` / `LOCK` (`+0x43`): `Game_Run` (`0042fb24`, `004301d7`) sets `g_macroPlayerLocked` `0x6bb278` when some active macro has no `UNLOCK`. The player then waits (a cutscene).
- `OUTMACRO` / `NORMALMACRO` (`+0x44`, together with `+0x43`): a macro that a click interrupts. On a click in a zone, `Script_InterruptOutMacros` `00427800` stops every such active macro and starts its destructor: the name from `MACRODESTRUCTOR`, or without one `~NAME`. In the data there are two: `~POKAZANIE-LEWO` in SC018 and `~POKAZANIE-PRAWO` in SC075.

### Variables

`VARIABLE.ALL` (plain text, `NAME value`) is read by `Var_LoadAll` `0044a600` into `g_varNames` and `g_varValues` (int16). Variables with a special meaning in the code: `LAST` (the previous scene; it starts at 5), `GUN`, `RAND` (the result of `TALKRANDOM`), `MOUSEX`, `MOUSEY` (the cursor hotspot `g_clickX/Y`, written **every frame** by `Cursor_UpdateHotspot` `0042b0f0`, called from `Game_Run` before the macros; scene coordinates are the mouse plus the scroll plus the cursor mode's offset, for example −9 and −12 for the arrow), `JACKX`, `JACKY` (`SETPOSITION JACK` sets them, and `Game_Run` sets them on every walk step), `MENU`, `SHOOT`, `SLAP`, `SHIFTX`. `Game_Run` sets `LANVER`, `ISSOUND`, `GUN`, and `LIGHTVER` according to the version of the game ([architecture.md](architecture.md), [easy.md](easy.md)).

## Commands

Columns: the code, the word, the arguments (in the order they are read; `→ a[i]` where they land when that is not in order), what the `case` in `0041a330` does (the case is the code minus 1), and the number of uses in the 135 scenes. *Waiting*: A is asynchronous (`-` waits), T is a talk, B always waits, P repeats.

### Control, variables, macros

| Code | Command | Arguments | What it does | Uses |
|---|---|---|---|---|
| 0x0d | `ACTIVEMACRO` | a name | `Script_StartMacro(name)` | 1542 |
| 0x0e | `IFANSWER` | `dialog n` (→ `a[2]`, `a[0]`) | the block, when the dialogue's answer is `n` | 1544 |
| 0x0f | `ENDIF` | — | the end of a block (nothing) | 3679 |
| 0x1a | `LET` | `var V` | `var = V` | 1556 |
| 0x1b | `IF` | `var n` | the block, when `var == n` | 1654 |
| 0x2d | `IFMOUSEXM` | `x` | the block, when `g_clickX ≤ x` | 18 |
| 0x2e | `IFMOUSEXW` | `x` | the block, when `g_clickX ≥ x` | 19 |
| 0x3d | `DEACTIVESELF` | — | this macro: active = 0 | 712 |
| 0x45 | `ACTIVEMACROAT` | `name frames` | start `name` after `frames` frames (one at a time) | 44 |
| 0x48 | `INC` | `var` | `var++` | 29 |
| 0x49 | `WAITWHILE` | `var n` | P: waits while `var == n` | 135 |
| 0x52 | `UNLOCK` | — | flag `+0x43` = 1: the player may act | 203 |
| 0x59 | `OUTMACRO` | — | `+0x44` = `+0x43` = 1: a click interrupts it | 1046 |
| 0x5a | `NORMALMACRO` | — | `+0x44` = `+0x43` = 0 | 1049 |
| 0x5b | `IFF` | `var op n` (op `>` / `=` / `<` → `a[3]` 0 / 1 / 2) | the block, when the comparison is true | 444 |
| 0x5c | `AUTOINCRANGE` | `var from to` | `var = from`. The range goes to `g_autoIncMin` / `Max` / `Var` (`0x7cdee4` / `0x51f84c` / `0x55b278`). **One global clock**: every 64 logic ticks `var += 1`, and after `to` it returns to `from` (`Game_TimerTick` `00426990`). See [play.md](play.md) | 2 |
| 0x5e | `LOCK` | — | `+0x43` = 0 | 17 |
| 0x64 | `INCC` | `var n` | `var += n` | 20 |
| 0x6f | `DONOTHING` | `n` | P: waits `n` macro steps (the counter `0x74b8e0`) | 280 |
| 0x73 | `ACTIVEMACROANIMA` | `macro anim n m` (→ `a[2]`, `a[0]`) | registers a macro to start on an animation frame (`0x6dae90`, `0x79e1b8`) | 80 |
| 0x78 | `MACRODESTRUCTOR` | a name | the macro started on an interrupt (`0x54b2f8`) | 121 |
| 0x79 | `BLOCKMACRO` | a name, or `ALL` | the macro cannot be started (`0x722d58 = 1`) | 2 |
| 0x7a | `UNBLOCKMACRO` | a name, or `ALL` | unblock | 8 |
| 0x7d | `RANDOM` | `var from to` | `var = rand() % (to−from+1) + from` | 6 |
| 0x7e | `DEACTIVEMACRO` | a name | active = 0 for macros of that name | 6 |
| 0x95 | `REACTIVESELF` | — | `pc = start − 1`, the operation counter = 0 (from the start) | 17 |
| 0x9f | `ITEMPRESENT` | `item var` | `var = Inventory_Has(item)` `00408c80` | 2 |
| 0xa3 | `ANYKEY` | `var` | `var = 1` when a key or a button was pressed, otherwise 0 | 0 |
| 0x60 | `INCLUDE` | a name | **no branch**. An unrecognized command. | 0 |

### Scenes, the game, the cursor, the inventory

| Code | Command | Arguments | What it does | Uses |
|---|---|---|---|---|
| 0x14 | `GOTOSCENE` | a scene | `g_sceneName` is the name without the extension plus `.CCG`, and `g_sceneChange = 1`. The macro keeps running. The change is at the end of the frame | 310 |
| 0x83 | `RUNAVX` | `movie scene` | the movie under `Movies`, stored at `0x5348b0`. The second argument is stored at `0x7cde98` and `g_sceneChange = 1`. The scene name is never read. | 27 |
| 0x4b | `GAMEOVER` | — | a temporary episode menu: start over, or SC001, SC032, SC075, SC100. | 0 |
| 0x75 | `EXITGAME` | — | a fatal exit | 0 |
| 0xa2 | `EXITTODOS` | — | `FUN_0040bc00(1)` and a fatal exit | 0 |
| 0xa1 | `SAVEABLE` | `n` | `0x87165e = n`. Whether a save is allowed (the default is 1). The read at save time was not fully traced | 33 |
| 0x74 | `PAUSE` | — | P: turns every other macro off and waits for Enter | 0 |
| 0x22 | `TAKE` | an object | the item into the hand: `g_cursorMode = 5`, the cursor is the object's picture, `g_heldItemName`, the "growing" animation ([cursor.md](cursor.md)). `0x7bf598[i] = 1` | 133 |
| 0x28 | `NOHAVE` | — | `Cursor_ResetMode` (the item leaves the hand) | 353 |
| 0x46 | `HAVETOOL` | an object | `Inventory_Add` `004197a0`, onto the inventory bar | 579 |
| 0x47 | `NOHAVETOOL` | an item | removes it from the hand or the bar, cursor mode 0 | 853 |
| 0x89 | `MOUSETOTOOL` | — | when an item is in hand: `FUN_00419ba0`. A hypothesis: it puts the item back on the bar. See [areas.md](areas.md) | 1 |
| 0x43 | `HAVEGUN` | — | `Cursor_LoadSet2` (the cursors with the weapon) | 3 |
| 0x44 | `NOHAVEGUN` | — | `Cursor_LoadSet1`. Mode 3 becomes 0 | 2 |
| 0x53 | `CURSORAS` | a name | `g_cursorMode = 3` and the shoot prefix. The argument is unused | 0 |
| 0x25 | `EXTRA` | `n` | a set of special actions: 1 is `Cursor_LoadSet2`, 4 is `FUN_00414600`, 6 and 8 are the walk frames in the uniform or without it, 7 and 9 are Jack's idle animations by direction, 10 is `FUN_0040bc00(0)`, 11 tidies the inventory bar. | 5 |
| 0x85 | `CLEARMENUBAR` | `n` | an empty branch | 3 |
| 0x86 | `UNLOCKCANAL` | `n` | `0x722f64[n] = 0` (a sound channel, a hypothesis confirmed in [sfx.md](sfx.md)) | 0 |
| 0x55 | `SETAREA` | `zone n state` | `0x871ad8[zone] = state`. Turns a zone on or off | 70 |
| 0x76 | `SETSPECAREA` | `zone n state` | `0x6aeefc[zone] = state` | 173 |
| 0xa0 | `IGNOREAREA` | `zone n` | `0x6d9824[zone] = 1` | 18 |
| 0x7b | `PINAREA` | `person zone n var` | `var = Area_Contains(zone, the person's position)` | 12 |
| 0x87 | `POINTINSECAREA` | `vx vy var` | `var = Object_FindAtPoint(vx, vy)` (`00405480`: 1 when an important object's quad contains the point, otherwise 0) | 6 |
| 0x98 | `POINTINWALKAREA` | `vx vy var` | `var = Walk_FindTriangle(vx, vy)` is not 0 | 3 |
| 0x97 | `CHKDISTANCE` | `person n` | `0x6c1894[person] = n`. A hypothesis: a distance threshold. See [avoid.md](avoid.md) | 11 |
| 0x6c | `MESSAGE` | text | an empty branch | 0 |

### Jack and the persons

`person` is a name from the `.PCS`, or `JACK`. For Jack the game sets his global variables. For a person it sets the tables by index.

| Code | Command | Arguments | What it does | Wait | Uses |
|---|---|---|---|---|---|
| 0x02 | `SETPOSITION` | `person V V` | the position x, y. The scale comes from the perspective (0.1…1). For Jack, also `JACKX` / `JACKY` | | 669 |
| 0x07 | `WALKTO` | `person V V ±` | walk to the point (Jack: `Walk_FindPath`; from a point outside the area, `Walk_NearestWalkable`. [walk.md](walk.md)) | A | 1654 |
| 0x17 | `WALKTODIR` | `person V V dir ±` | like `WALKTO`, with a forced direction (`g_walkDirForced`) | A | 286 |
| 0x6a | `SETDIRWALK` | `person dir` | `0x88f664[person] = dir`. A hypothesis: the walk direction | | 6 |
| 0x04 | `SETPERSONDATA` | `person n1 F n2 n3` (→ `a[0]`, `f`, `a[1]`, `a[2]`) | Jack: `g_insFrameDelay = n1`, `g_perspRefY = n2`, `g_walkSpeed = n3`. `F` is the reference scale (`3.0` is a constant scale, `2.0` is no scaling). A person: the same fields in the tables | | 870 |
| 0x37 | `SETPERSPY` | `person y` | the bottom y of the perspective (`0x69c7bc` / `0x69ea0c`) | | 49 |
| 0x38 | `MOVEP` | `person dx dy` | move by (dx, dy) | | 100 |
| 0x26 | `MOVEAR` | `person dx dy dir` (→ `a[0]`, `a[1]`, `a[3]`) | Jack: a scaled shift, the direction according to `a[3]` (0, 1, 2 means the way he is facing, 3, 4, −3) | | 0 |
| 0x03 | `INITFIRST` | `person insertion dir` | set an `.ICS` insertion as the state (Jack: `g_jackIns*`). Direction 0, 1, or 2 is right, left, or the way he is facing | | 185 |
| 0x08 | `RUNINSERTION` | `person insertion F dir ±` | play an `.ICS` insertion (`Ins_Find`). Direction 0, 1, 2, 3, 4, or −3 | A | 685 |
| 0x0a | `HIDE` | a person | `Sprite_Remove` of the person and of her shadow | | 95 |
| 0x4a | `STAY` | a person | `Script_Stay` `0041a140`: a standing pose. [turn.md](turn.md) | | 1149 |
| 0x51 | `STAYDEF` | — | `Jack_Stand(g_jackDir)` | | 157 |
| 0x50 | `SHOWFRAMEDIR` | `person n m` | an empty branch | | 0 |
| 0x10 | `SHOWFRAME` | `person frame` | `0x88f4a8[person] = 1`, the frame `0x8a2658` | | 0 |
| 0x27 | `SETFRAME` | `person frame mode` | a walk frame (mode 2 or 4: mirrored `(k+6) % 12`) | | 80 |
| 0x61 | `LOOKTO` | `V V` | Jack turns toward the point (`FUN_004104a0`, `FUN_00410900`) and stands | | 28 |
| 0x77 | `ROTATETO` | `V V` | like `LOOKTO`, but with the turn animation (when `0x7a849c`) | A | 1197 |
| 0x84 | `JACKTEMPO` | `FREE` or anything else | `0x6d9842` is 0 or 1. The walk tempo. See [turn.md](turn.md) | | 18 |
| 0x34 | `SETCHKPRIOR` | `person n` | `0x851d03` (Jack) or `0x7cdecc[person]` is `n`. A hypothesis: a draw-order check | | 149 |
| 0x15 | `PUNDERP` | `person1 person2` | person 1's sprite under person 2 (`Sprite_MoveBack`) | | 17 |
| 0x16 | `PUNDERE` | `person object` | the person under the object | | 166 |
| 0x1d | `POVERE` | `person object` | the person above the object (`Sprite_MoveFront`) | | 112 |
| 0x62 / 0x63 | `GETPERSONX` / `GETPERSONY` | `person var` | `var` is the person's x or y | | 14 / 9 |
| 0x8a | `RELATIVEMULP` | `person F` | the person's shadow scale (`0x652110`). | | 26 |
| 0x65 / 0x66 | `LOCKWALK` / `UNLOCKWALK` | — | `0x51fa5e` is 0 or 1. The player may not walk, or may | | 13 / 5 |
| 0x71 / 0x72 | `SLAP` / `SHOOT` | — | Jack strikes or shoots (insertions `BO…` / `SP…` / `SW…` by direction). `SLAP` or `SHOOT` becomes 1. Unused. See [gestures.md](gestures.md) | | 0 / 0 |
| 0x93 / 0x94 | `SHOOTF` / `SLAPF` | `n` | as above, the phased version (`0x6d5060`) | P | 152 / 223 |
| 0x90 | `PICKUP` | `n` | Jack picks up (insertions `PP_D0` / `1` and the rest) | P | 163 |
| 0x92 | `GIVE` | `n` | Jack gives or puts away | P | 533 |

### Talks and faces

| Code | Command | Arguments | What it does | Wait | Uses |
|---|---|---|---|---|---|
| 0x0b | `TALK` | `speaker line channel ±` | a `.DCN` line, with sound (`Sound_PlayTalk`) or a caption. The speaker is `LEFT` or `RIGHT` (the face in the window on the left or the right, `a[1]` is 1 or 2), `JACK`, `POS` (the point from `SETPOSXY`), or a person. The caption time is 3 times the length plus 200 | T | 5445 |
| 0x21 | `TALKRANDOM` | `speaker dialog channel ±` | a random line from the group. The number goes to `RAND` | T | 359 |
| 0x88 | `TALKRANDOMINDEX` | `speaker dialog index channel ±` (→ `a[0]`, `a[3]`, `a[1]`) | line `index` from the group | T | 20 |
| 0x0c | `DIALOG` | `speaker dialog` | the answer menu (`FUN_0040bf90`). The cursor is enabled | B | 623 |
| 0x3a | `SETDIALOG` | `dialog option state` | `state` 0 hides an answer option. Any other value shows it (`DIALOG` counts options whose flag `0x6e367e` is 0) | | 74 |
| 0x11 | `HIDETALK` | — | the end of the line (`FUN_0040d770`) | | 0 |
| 0x18 | `SHOWFACE` | `face ±` | a `.FCC` face in the window (`FUN_00413970`). A second character `*` goes to `a[1]` | P | 2153 |
| 0x19 | `HIDEFACE` | `L` or `R` | hides the face on the left or the right (`FUN_00413da0`) | | 2603 |
| 0x5f | `HIDEFACEAT` | `L` or `R` | only arms a flag (`DAT_007c7e48` is the side, `DAT_0074b880` is 1; `Script_ExecStep` case 0x5e). The window hides only in the tail of `Talk_FaceStep` `00413e20`, when no line is playing. `TALK … +` plus `HIDEFACEAT` means the line finishes, then the face disappears. A line with no face ends at once. | | 2 |
| 0x33 | `SETPOSXY` | `x y` | the caption point for the speaker `POS` (x is relative to the scroll) | | 2 |
| 0x01 | `CHWINDOW` | `person x1 y1 x2 y2` | a window or an area of the person (`FUN_004133f0`). A hypothesis: a clip. An unknown name does nothing | | 407 |

### Objects and animations

`object` is a `.CCG` object's name. `anim` is an object animation `.ACI` or `FLXn`.

| Code | Command | Arguments | What it does | Wait | Uses |
|---|---|---|---|---|---|
| 0x05 | `ANIMA` | `anim dir delay mode [rec] ±` (`rec` only for modes 3–6) | start an object animation ([animation.md](animation.md)). Modes 1, 3, and 5 count as an operation | A | 1630 |
| 0x06 | `STOPANIMA` | `anim` | stop, and remember the state | | 147 |
| 0x5d | `CONTINUEANIMA` | `anim` | resume the remembered state (when there is no `STOPANIMANEG` marker) | | 113 |
| 0x39 | `STOPANIMAFRAME` | `anim frame` | stop on the frame (`g_objAnimStopAt`). Unused in the data. See [frame.md](frame.md) | | 0 |
| 0x3b | `STOPANIMANEG` | `anim` | a stop marker (`g_objAnimStopAtMarker`) | | 309 |
| 0x3c | `SETANIMAFRAME` | `anim rec frame` | set the frame, or the position in the REC sequence | | 3 |
| 0x1c | `SHOWANIMAFRAME` | `anim picture` | show an animation picture (`Pbm_Unpack`, `Sprite_Set`) | | 8 |
| 0x4d | `WAITWHILEANIMA` | `anim` | waits while the animation is active | P | 229 |
| 0x56 | `WAITTOANIMAFRAME` | `anim picture` | waits for the picture | P | 1 |
| 0x7c | `ANIMADELAY` | `anim delay` | `g_objAnimDelay` | | 116 |
| 0x82 | `CLEARANIMABUFFER` | `anim` | clears the animation's frame buffer | | 18 |
| 0x68 | `SETDARKNESSANIMA` | `anim F` | `0x897950[anim] = FUN_0047d5c0(F)`. A darkening | | 13 |
| 0x54 | `ANIMAEFFECT` | `anim n5 picture sound n1 n2 n6` | a sound on an animation picture (up to 30 per animation). [sfx.md](sfx.md) | | 351 |
| 0x2c | `SETPOSITIONE` | `object V V` | the position of the object and of the sprite. `0 500` hides it off screen | | 744 |
| 0x70 | `SETPOSITIONEV` | `object x y` | the sprite's and the object's position directly | | 1 |
| 0x40 | `MOVEE` | `object dx dy` | move the object and the sprite | | 1 |
| 0x4c | `MOVEEP` | `object dx dy` | move only the coordinates | | 6 |
| 0x29 / 0x2a | `HIDEE` / `SHOWE` | an object | `Sprite_Remove` or `Sprite_Show` of the object | | 257 / 30 |
| 0x3e | `EOVERE` | `object1 object2` | object 1 above object 2 | | 46 |
| 0x41 | `BRIGHTNESSE` | `object F` | multiplies the pixels of the object's picture (RGB565) by `F` | | 24 |
| 0x36 | `BRIGHTNESS` | `F` | `g_jackBrightness = g_sceneBrightness = F` | | 134 |
| 0x09 | `RUNFILM` | `film x y n` | `FUN_0040e680`, a `.FCM` film | | 0 |
| 0x23 | `RUNFILMP` | `film x y n` | `Film_Play(…, 0)` | | 58 |
| 0x6e | `RUNGLOBALFILMP` | `film x y n` | `Film_Play(…, 1)`. `x = y = −100` means beside Jack | | 380 |

### Scrolling, shadows, sound

| Code | Command | Arguments | What it does | Uses |
|---|---|---|---|---|
| 0x2b | `SETSHIFTX` | `x` | the background scroll: `x < 0` becomes 0, down to a multiple of 4, max 0x178. [render.md](render.md) | 49 |
| 0x2f / 0x30 | `SCROLLLEFT` / `SCROLLRIGHT` | — | the scroll direction `0x55347c` is −1 or 1 | 4 / 8 |
| 0x31 / 0x32 | `SETSCROLLX1` / `SETSCROLLX2` | `x` | the scroll limits (`0x8f68e8`, `g_bgScrollMax`) | 7 / 17 |
| 0x57 / 0x58 | `SCROLLMARGINL` / `SCROLLMARGINR` | `n` | the scroll margins (`0x8a7c60`, `0x6bd6ba`) | 8 / 10 |
| 0x96 | `SETPOSSCROLL` | `L` or `R`, then `x y` | the left or right scroll point (`0x8ad368` / `0x6bb27c`). A click at the edge of the screen walks Jack to the point (`0042aef0` / `0042afb0`). [play.md](play.md) | 62 |
| 0x99 | `SETSCROLL` | `n` | `g_bgWide = n` | 5 |
| 0x6d | `POINTROTATE` | `n` | `0x8979cf = 0x51f920 = n`. Non-zero forces a turn from a stand (`ROTP`) instead of a turn while walking, in `Jack_WalkToPoint` `004114b0`. [turn.md](turn.md) | 122 |
| 0x12 | `SHADOWBY` | `person dx dy n` | a shift of the shadow (`FUN_00413640` / `00413720`) | 9 |
| 0x13 | `SETSHADOW` | `person n` | the shadow on (1) or off (0). It leaves the second shadow. | 34 |
| 0x8b / 0x8c | `MINSHADOW` / `MAXSHADOW` | `person n m` (→ `a[1]`, `a[2]`, `a[0]`) | the shadow fades or grows in `a[0]` steps | 81 / 39 |
| 0x8d | `PUTSHADOW` | `x y F` | a shadow at the point (`FUN_00418e80`) | 15 |
| 0x8e | `ANIMASHADOW` | `anim person shadow-or-NULL n` | an animated shadow. For a person other than Jack it draws nothing. | 9 |
| 0x8f | `SHIFTSHADOWP` | `person dx dy` | a shift of the person's shadow | 22 |
| 0x9a | `SETSPECSHADOW` | `person object` | the object's picture as the person's shadow | 6 |
| 0x9b | `SHOWSHADOW` | `person` or `EXTRA`, then `n m F` | show the shadow (`EXTRA` is an extra shadow, unused). | 17 |
| 0x9c | `SHADOWSTATUS` | `person 0 or 1` | the shadow flag | 9 |
| 0x9d | `HIDESHADOW` | `person` or `EXTRA` | hide the shadow | 3 |
| 0x9e | `SHADOWONE` | an object | `0x7cda60 = 1`, `0x7c72e8` is the object | 8 |
| 0x1e | `EFFECT` | `sound channel _ volume` | `Sound_PlayIndexed`. Channel 0 is 1 and 2. [sfx.md](sfx.md) | 272 |
| 0x20 | `EFFECTVOLUME` | `sound _ volume` | the volume of the sound's channel | 1 |
| 0x67 | `WAITWHILEEFFECT` | a sound | P: waits while the sound plays | 74 |
| 0x42 | `WALKEFFECT` | `person frame sound [n1 n2 n5]` (the numbers only for someone other than Jack) | a step sound on a walk frame. The second argument is stored and never read. | 194 |
| 0x3f | `MUSIC` | `NAME-x n m` | the music `NAME-22.PMS` (cut at the first `-`), with a fade of the previous piece. [music.md](music.md) | 43 |
| 0x91 | `MUSICVOLUME` | `F` | `Sound_SetChannelVolume(5, …)` | 5 |
| 0x80 | `MIXING` | `n` | `0x722efe = n` (when ≤ 0: `0x871ad0 = 0x52a32a = 1`). A hypothesis. This is not the dissolve flag | 0 |
| 0x81 | `REFRESHSCREEN` | — | `0x6bd688 = 1`. Orders a dissolve. [transition.md](transition.md) | 2 |

Codes with no word in the compiler: `0x1f`, `0x24`, `0x35`, `0x4e`, `0x4f`, `0x69`, `0x6b`, `0x7f`. The interpreter does not handle them either. Commands unused in the data are listed with INCLUDE.

## The host interface

`packages/engine/src/script/interpreter.ts`:

```ts
const program = compileMcc(decrypt(bytes));
const vars = new Variables(parseVariables(variableBytes));
const it = new Interpreter(program, host, vars); // vars carry between scenes
it.runSynchronous("PRE"); // before the first frame
it.start("INIT");
// every frame: it.tick(); every 15 ms of logic: it.logicTick();
// the end of an operation: it.complete(cmdCtx.macro);
// a player's click: it.interruptOutMacros(); it.start(`${verb}-${area}`);
```

The interpreter itself runs `ACTIVEMACRO`, `IFANSWER`, `ENDIF`, `LET`, `IF`, `IFMOUSEXM` and `IFMOUSEXW`, `DEACTIVESELF`, `ACTIVEMACROAT`, `INC`, `WAITWHILE`, `UNLOCK`, `LOCK`, `OUTMACRO`, `NORMALMACRO`, `IFF`, `INCC`, `DONOTHING`, `MACRODESTRUCTOR`, `BLOCKMACRO`, `UNBLOCKMACRO`, `RANDOM`, `DEACTIVEMACRO`, `REACTIVESELF`, and `AUTOINCRANGE` (the variable here, the range at the host: `AutoIncClock` in `packages/engine/src/play/host.ts`). Every other command goes to `host.command(cmd, ctx)`, which returns:

| Result | Meaning |
|---|---|
| `"done"` | done at once |
| `"async"` | started (a walk, an animation, an insertion, a line). The host calls `complete(ctx.macro)` at the end. With `-` the macro waits |
| `"block"` | the macro waits for `complete()` regardless of the flag (`DIALOG`) |
| `"repeat"` | the condition is not met. The same command on the next frame |
| `"unhandled"` | the engine cannot do this. An entry in the log, and the macro continues |

`ctx.arg(slot)` gives the argument's value (a number, or `*VARIABLE`). `ctx.vars` is the variables. `cmd.refs` is the names to resolve in the scene. `WAIT_KIND` says how the original waits (a help for the host). Optionally the host supplies `clickX()`, `random()`, `macroEnded(name, last)` (for example `Jack_Stand` after `WALKTO JACK`), and `log(entry)`. `LoggingHost` returns `"unhandled"` for everything. Dialogue answers: `it.answers.set(dialogId, n)` (with no answer, `IFANSWER` skips the block). `playerLocked()` is whether the player has to wait. `gotoSceneName(arg)` is the scene name from `GOTOSCENE`.

Differences from the original, on purpose: an unknown variable reads as 0 (the game: a leftover index). `[PRE]` is cut after 100000 steps with a "hang" entry (the game: a hang). No dialogue answer is −1 (the game: the contents of `0x6dac80`).

## What the scene host runs itself

Wired in `packages/engine/src/play/host.ts`:

| Command | Call |
|---|---|
| `PICKUP` / `GIVE` / `SHOOTF` / `SLAPF n` (0x90, 0x92–0x94) | `Gestures.command` ([gestures.md](gestures.md)). The insertion starts with `ScenePlayer.startGlobalInsertion` (`Ins_StartGlobal`, with no search of the scene's insertions). The result is `"repeat"` or `"done"` directly. `SLAP` is set through `ctx.vars` |
| the end of Jack's insertion | the event `jackInsertionEnded` carries `global` (`JackUpdate.insertionGlobal`). **Every** insertion from `GLOBAL.ICS` (a gesture, the guard, idle) goes to `SceneHost.jackInsertionEnded(true)` and then `Gestures.globalInsertionEnd` (it clears `SLAP` and `SHOOT`, and the guard continues). A scene insertion goes to `finish("jack:ins")` as before. The fix of the bug after idle lives in the module, and it is the default |
| `SHOWANIMAFRAME` 0x1c, `SETDARKNESSANIMA` 0x68, `BRIGHTNESSE` 0x41, `CLEARANIMABUFFER` 0x82, `MOVEEP` 0x4c, `RELATIVEMULP` 0x8a | methods of `ScenePlayer`. Always "done", including when the name is missing (the original does not check) |
| `EXTRA 1` | like `HAVEGUN` (neither command changes the scale of Jack standing; the uniform is `JackAnimator.uniform`): `items.setGun(true)` (`Cursor_LoadSet2` `00408a40`). The cursor set and the icon on the bullet follow the variable `GUN` |
| `EXTRA 10` | `music.stop()` (`Music_Stop` `0040bc00`) and `music.trackName = ""`. The next `MUSIC` starts over |
| `CHWINDOW` with an unknown name | "done", with no effect (`004133f0`: an unknown name does nothing. SC001 names `CAR1` and `CAR2`, which the scene does not have). |

The compiler requires an argument after `PICKUP`, `GIVE`, `SHOOTF`, and `SLAPF` (`PICKUP 0`). A text test has to supply it.

## Tests

`packages/engine/src/script/compiler.test.ts` covers the words and the codes, the structure, the comments, every compiler error, and every special form of an argument. `packages/engine/src/script/interpreter.test.ts` covers the conditions and the jumps, the waiting, the control of macros, `[PRE]`, the timed macros, and the interrupts. The tests build their own bytes. One path through a stand-in of the opening scene reaches a `GOTOSCENE` of the next street scene.
