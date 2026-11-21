# Scripts

A scene's behavior is an encrypted `.MCC` file inside `Action/<scene>.phk`. The scene's pictures, walk area, people, and sounds are the other encrypted members of that archive. This page is how to read those files. It is not a tour of the game.

`PlayGame` decrypts `<scene>.MCC` and compiles it when the scene loads. The compiler is `packages/engine/src/script/compiler.ts`. The interpreter is `packages/engine/src/script/interpreter.ts`. Neither is a package export. The configuration readers (`parseScene`, `parseCcg`, `parseAce`, `parsePcs`, `parseIcs`, `parseAci`, `parseSsd`, `parseDcn`, `parseFcc`) are exported. `parseMcc` only collects macro names, `GOTOSCENE` targets, and Jack's start positions. It does not compile commands.

People changing a parser should use [docs/dev/formats/scene.md](../dev/formats/scene.md), [dialog.md](../dev/formats/dialog.md), and [global.md](../dev/formats/global.md). The cipher is in [Formats](formats.md).

## How a macro file is read

Decrypt the member, then compile the plain bytes. The text is a sequence of tokens. A token is a run of bytes above 0x20, so spaces, tabs, and line breaks are the same separator.

A macro starts with a token that begins with `[`. The name is that token without its first and last character, stored in upper case. Commands follow until the next token that begins with `[`.

A command word is stored in upper case and looked up by name. An unknown word becomes `DONOTHING` and reads one number. Argument tokens are kept as written. The person name `JACK` is recognized only in that spelling.

A comment is a token that is exactly `/`, closed by the next `/`, or a token `/*` closed by `*/`. Comments are recognized before the first macro and where a command word would be. They are not recognized between arguments.

Limits, from the compiler: 1500 commands, 150 macros, a macro name of at most 59 characters, and a name argument of at most 39 characters. One `If` counter covers the whole file. An `ENDIF` that closes nothing is a compile error. An `If` left open at the end is not.

## Arguments

| Written | Stored as |
|---|---|
| A name | The token, in `n1` or `n2`. |
| A number | `atoi` of the numeric prefix, wrapped to a 16-bit value. |
| A float | `atof`, as a 32-bit float. |
| A value | A number, or `*NAME` meaning the variable `NAME`. |
| A flag | The first character of the token. `-` asks the macro to wait. `+` does not. `L` and `R` choose a side of the face. |

Names of people, animations, objects, sounds, areas, and variables stay as names until the command runs. `JACK` is the player. Anyone else is a name from the scene's `.PCS`.

## Who runs a command

The interpreter runs the control commands itself: variables, conditions, and starting or stopping macros. Every other command goes to the host. `PlayGame` installs that host.

The host returns one of:

| Result | Meaning |
|---|---|
| `done` | The command finished. |
| `async` | Something continues (a walk, an insertion, an animation). The host calls `complete` when it ends. The macro waits only when the flag is `-`. |
| `block` | The macro waits until `complete`, whatever the flag. `DIALOG` does this. |
| `repeat` | The same command runs again on the next tick. |
| `unhandled` | Logged and skipped. The macro continues. |

`[PRE]` runs to the end before the first frame. Waits are not held during that pass. A music fade started there is finished inside the pass. `[INIT]` is started next and then runs with the other macros, one command each per frame. `CO60`, `CO30`, and `CO10`, when those macros exist, are started from a countdown.

While any active macro has not run `UNLOCK`, the player cannot act. `LOCK` sets that wait again. `OUTMACRO` marks a macro a click may interrupt, and also unlocks. On that click the interpreter stops those macros and starts the name given by `MACRODESTRUCTOR`, or a macro named `~` plus the interrupted name. `NORMALMACRO` clears both flags.

A click looks up a macro named `<verb>-<area>`. The verb is `POKAZANIE`, `PATRZENIE`, `UDERZENIE`, `STRZELANIE`, or `BRANIE`, matching the cursor. With an item in hand the prefix is the item's name, and if that macro is missing the host tries `PIERDOLA-<area>`. The area name `WALKAREA` can start a macro and still leave the click free for walking.

## Control commands

The interpreter runs these.

| Command | Arguments | Effect |
|---|---|---|
| `ACTIVEMACRO` | name | Start that macro from its first command. |
| `ACTIVEMACROAT` | name, frames | Start it after that many frames. One delay is stored at a time. |
| `DEACTIVESELF` | | Stop this macro. |
| `DEACTIVEMACRO` | name | Stop macros of that name. |
| `REACTIVESELF` | | Run this macro again from the first command. |
| `BLOCKMACRO` | name, or `ALL` | That macro cannot be started. |
| `UNBLOCKMACRO` | name, or `ALL` | Allow it again. |
| `MACRODESTRUCTOR` | name | Macro to start if a click interrupts this one. |
| `LET` | var, value | Assign. |
| `INC` | var | Add 1. |
| `INCC` | var, n | Add n. |
| `RANDOM` | var, from, to | Assign a value in that range. |
| `IF` | var, n | Run the block when they are equal. |
| `IFF` | var, op, n | `op` is `>`, `=`, or `<`. |
| `IFANSWER` | dialog, n | Run the block when that dialogue's answer is n. |
| `IFMOUSEXM` | x | Run the block when the click's x is less than or equal to x. |
| `IFMOUSEXW` | x | Run the block when the click's x is greater than or equal to x. |
| `ENDIF` | | End the block. |
| `WAITWHILE` | var, n | Repeat while they are equal. |
| `DONOTHING` | n | Wait n steps. |
| `AUTOINCRANGE` | var, from, to | Set the variable to `from`. The host starts a clock that steps it toward `to`. |
| `UNLOCK` | | The player may act. |
| `LOCK` | | The player waits. |
| `OUTMACRO` | | A click may interrupt this macro. |
| `NORMALMACRO` | | A click does not interrupt it. |

A failed condition skips to the matching `ENDIF`. Openers are `IF`, `IFF`, `IFANSWER`, `IFMOUSEXM`, and `IFMOUSEXW`. When the failed command is `IFANSWER`, only `IF` and `IFANSWER` count as openers. There is no else branch.

## What the host does

Arguments below are in the order the compiler reads them. `person` is `JACK` or a `.PCS` name. `value` is a number or `*VARIABLE`.

### People

| Command | Arguments | Effect |
|---|---|---|
| `SETPOSITION` | person, value, value | Place the person. |
| `MOVEP` | person, dx, dy | Move by that offset. |
| `SETPERSONDATA` | person, n, float, n, n | Store those four values on the person. |
| `SETPERSPY` | person, y | Perspective reference. |
| `WALKTO` | person, value, value, flag | Walk to the point. |
| `WALKTODIR` | person, value, value, dir, flag | Walk, then face `dir`. |
| `INITFIRST` | person, insertion, dir | Pose from an insertion. |
| `RUNINSERTION` | person, insertion, float, dir, flag | Play an insertion. |
| `HIDE` | person | Remove the person and that person's shadow. |
| `STAY` | facing | Jack stands facing that way. A turn waits until it finishes. |
| `STAYDEF` | | Jack stands in his current direction. |
| `SETFRAME` | person, frame, mode | Show one frame of a person other than Jack. |
| `SHOWFRAME` | person, frame | Show one frame of a person other than Jack. |
| `SETDIRWALK` | person, n | Nonzero reverses that person's walk. |
| `LOOKTO` | value, value | Turn toward the point. The macro continues. |
| `ROTATETO` | value, value | Turn, and wait until the turn ends. |
| `GETPERSONX` | person, var | Write the person's x. |
| `GETPERSONY` | person, var | Write the person's y. |
| `JACKTEMPO` | `FREE` or another word | `FREE` clears the tempo flag. Any other word sets it. |
| `LOCKWALK` | | A click no longer starts a walk. |
| `UNLOCKWALK` | | A click may start a walk again. |
| `HAVEGUN` | | Weapon cursor. |
| `NOHAVEGUN` | | Pointer cursor. |
| `SETCHKPRIOR` | person, n | Nonzero includes that person in the depth check. |
| `CHKDISTANCE` | person, n | Nonzero turns on the step-aside check for that person. |
| `RELATIVEMULP` | person, float | Light scale for that person. |
| `EXTRA` | n | A small set of switches. `1` is the weapon cursor. `6` and `8` change Jack's outfit. `10` stops the music. `11` affects the coat. |

### Objects, animation, and the camera

| Command | Arguments | Effect |
|---|---|---|
| `SETPOSITIONE` | object, value, value | Place an object. |
| `SETPOSITIONEV` | object, n, n | Place an object from numbers. |
| `MOVEE` | object, dx, dy | Move an object. |
| `MOVEEP` | object, dx, dy | Move an object's point by that offset. |
| `SHOWE` | object | Show it. |
| `HIDEE` | object | Hide it. |
| `CHWINDOW` | name, left, top, right, bottom | Clip rectangle. An unknown name does nothing. |
| `PUNDERP` | person, person | Draw the first under the second. |
| `PUNDERE` | person, object | Draw the person under the object. |
| `POVERE` | person, object | Draw the person over the object. |
| `EOVERE` | object, object | Draw the first object over the second. |
| `BRIGHTNESSE` | object, float | Object brightness. |
| `BRIGHTNESS` | float | Scene brightness. |
| `ANIMA` | name, n, n, mode, extra, flag | Play an object animation. `extra` is read only when `mode` is 3, 4, 5, or 6. |
| `STOPANIMA` | anim | Stop it. |
| `CONTINUEANIMA` | anim | Leave it running. |
| `STOPANIMANEG` | anim | Stop at the next marker. |
| `SETANIMAFRAME` | anim, record, frame | Jump to a frame. |
| `SHOWANIMAFRAME` | anim, n | Show one frame. |
| `ANIMADELAY` | anim, n | Frame delay. |
| `SETDARKNESSANIMA` | anim, float | Darken that animation. |
| `CLEARANIMABUFFER` | anim | Clear its buffer. |
| `WAITWHILEANIMA` | anim | Repeat while it is running. |
| `WAITTOANIMAFRAME` | anim, image | Repeat until that image is showing. |
| `ACTIVEMACROANIMA` | macro, anim, record, image | Start the macro when that frame is shown. |
| `SETSHIFTX` | n | Set the horizontal scroll. |
| `SCROLLLEFT` | | Scroll toward the left. |
| `SCROLLRIGHT` | | Scroll toward the right. |
| `SETSCROLLX1` | n | Left scroll limit. |
| `SETSCROLLX2` | n | Right scroll limit. |
| `SCROLLMARGINL` | n | Left margin. |
| `SCROLLMARGINR` | n | Right margin. |
| `SETSCROLL` | n | Nonzero turns the wide background on. |
| `SETPOSSCROLL` | `L` or `R`, x, y | A scroll anchor. The first character selects the side. |
| `SETPOSXY` | x, y | A stored point. |
| `POINTROTATE` | n | Nonzero allows the point-and-turn behavior. |

### Inventory, areas, sound, and scenes

| Command | Arguments | Effect |
|---|---|---|
| `TAKE` | object | Put that object's picture in the hand. |
| `NOHAVE` | | Clear the hand. |
| `HAVETOOL` | object | Add it to the inventory. |
| `NOHAVETOOL` | name | Remove it from the hand or the inventory. |
| `MOUSETOTOOL` | | Move the held item to the coat. |
| `ITEMPRESENT` | name, var | Write whether a slot holds it. The hand does not count. |
| `CLEARMENUBAR` | n | Accepted. It changes nothing. |
| `SETAREA` | area, n, state | Enable or disable an area. |
| `SETSPECAREA` | area, n, state | The special flag for an area. |
| `IGNOREAREA` | area, n | The cursor skips that area. |
| `PINAREA` | person, area, n, var | Write whether the person is inside the area. |
| `POINTINSECAREA` | x, y, var | Write whether an object footprint contains the point. |
| `POINTINWALKAREA` | x, y, var | Write whether the point is in the walk area. |
| `MUSIC` | token, fade out, fade in | Play a track. A token with a `-` after the first character keeps the text through that dash and then `22.PMS`. A token with no dash gains `22.PMS` at the end. The file is `Music/` plus that name. |
| `MUSICVOLUME` | float | Scale the music. |
| `EFFECT` | sound, n, n, n | Play a scene effect. |
| `EFFECTVOLUME` | sound, n, n | Change an effect's volume. |
| `WALKEFFECT` | person, n, sound, and three more numbers when the person is not `JACK` | A sound tied to walking. |
| `ANIMAEFFECT` | anim, n, sound, n, n, n, n | A sound tied to an animation frame. |
| `WAITWHILEEFFECT` | sound | Repeat while that effect plays. |
| `UNLOCKCANAL` | n | Free a sound channel. |
| `REFRESHSCREEN` | | The next scene change fades. |
| `GOTOSCENE` | name | Change scene at the end of the frame. A file extension, if present, is removed. |
| `RUNFILMP` | film, x, y, mode | Play a film from the scene, then continue the script. |
| `RUNGLOBALFILMP` | film, x, y, mode | Play a film named in `GLOBAL.FCM`. |
| `RUNAVX` | film, scene | Play `Movies/<film>16.AVX` after the frame. The scene name is kept with the request. |
| `SAVEABLE` | n | Nonzero allows saving. |
| `PICKUP` | n | A pickup gesture. |
| `GIVE` | n | A give gesture. |
| `SHOOTF` | n | Jack's firearm gesture. |
| `SLAPF` | n | A slap gesture. |

Shadows: `SETSHADOW` person n, `MINSHADOW` person n n, `MAXSHADOW` person n n, `SHIFTSHADOWP` person dx dy, `SETSPECSHADOW` person object, `SHOWSHADOW` person-or-`EXTRA` x y float, `HIDESHADOW` person-or-`EXTRA`, `SHADOWSTATUS` person n, `SHADOWBY` object dx dy level, `PUTSHADOW` x y float, `ANIMASHADOW` anim person shadow-or-`NULL` n, `SHADOWONE` object.

### Dialogue

These need the dialogue layer (`PlayOptions.dialogs`, on by default). With the layer off, the play host records an answer for `DIALOG` from `PlayOptions.answer` and skips the rest.

| Command | Arguments | Effect |
|---|---|---|
| `TALK` | speaker, line, n, flag | Speak one line. `LEFT`, `RIGHT`, `JACK`, and `POS` are special speakers. |
| `TALKRANDOM` | speaker, dialog, n, flag | Speak a random line from an `R` group. Writes `RAND` when that variable exists. |
| `TALKRANDOMINDEX` | speaker, dialog, n, n, flag | Speak a chosen line from a group. |
| `DIALOG` | speaker, dialog | Open an answer menu. The macro waits. |
| `SETDIALOG` | dialog, option, state | Enable or disable one answer. |
| `SHOWFACE` | face, flag | Show a face. The flag's first character is `L` or `R`. A second character `*` is recorded. Repeats while the view is scrolling. |
| `HIDEFACE` | flag | Hide that side. |
| `HIDEFACEAT` | flag | Hide that side when the current line ends. |

### Words the play host skips

These words are real. The compiler reads the arguments. The play host logs the command and continues.

`RUNFILM` (name and three numbers), `HIDETALK`, `MOVEAR` (person, dx, dy, dir), `SHOWFRAMEDIR` (person and two numbers), `CURSORAS` (a name), `SLAP`, `SHOOT`, `MIXING` (a number), `GAMEOVER`, `PAUSE`, `EXITGAME`, `EXITTODOS`, `INCLUDE` (a name), `MESSAGE` (a name).

## Variables

`VARIABLE.ALL` in `Resource/RESOURCE.PAK` is plain text. Each line is a name and a starting integer. That list is the variable table. A name that is not in the table reads as 0, and a write to it is dropped.

The running game writes some of those names when they exist: `LAST` (the scene just left), `JACKX` and `JACKY` while Jack moves, `MOUSEX` and `MOUSEY` from the click, `GUN` for the weapon, `LIGHTVER` for easy mode, `RAND` after `TALKRANDOM`, and `JACKISMENU` for the coat toggle. `PlayOptions.vars` can preset any name before the first scene, which is how a session starts with a chosen `LAST`.

## Scene configuration

`parseScene` requires `<scene>.CCG` and `<scene>.MCC`. The other members are optional. All of them are encrypted except the pictures and the sounds.

Tokens are the same runs of bytes above 0x20. A section is a bracketed name. The loader searches for a section from the start of the file, so the order of sections is free and the first match is the one that is used.

### `.CCG`

The background and the objects.

| Section | Contents |
|---|---|
| `[grafiki]` | The background picture, then one object per record. |
| `[elementy]` | More objects, the same record, used for inventory icons. |
| `[perspektywa]` | Four numbers: an unused lead value, the horizon, a reference y, and a reference scale. Scale along y is clamped to the range 0.1..1. |
| `[swiatlo]` | Pairs of x y. |
| `[obszar_chodu]` | A count, then that many triangles of six numbers. |
| `[kolor_liter]` | Six numbers, caption colors. |

An object record is a picture name, a type (`8` packed, `16` raw 16-bit, `-8` packed and then shown as 16-bit), x, y, two scales, and eight numbers for the floor quad. A background name that ends in `+` is wider than the screen. The next number is the starting scroll. A name that starts with `FLX` and has type `16` is an animation slot, filled in by `.ACI`.

### `.ACE`

A count, then that many areas. Each area is a bracketed name, a triangle count, and the triangles (six numbers each). The names `LEWO`, `PRAWO`, `DOL`, `TO_IN`, `UP`, and `TO_OUT` are exits and select an exit cursor. `WALKAREA` is the ground under a click that should still walk.

### `.PCS`

One person per bracketed name: a few counts, a scale, then direction blocks. Each direction is a number and, for every frame, a picture name and three numbers.

### `.ICS`

Insertions, the same syntax as `GLOBAL.ICS` in `Global.pak`. A bracketed name, then frames. A frame is a picture name and seven numbers (the anchors the sprite is drawn from). A line `EFFECT` plus a sound name, a channel, an unused number, and a volume attaches that sound to the next frame.

### `.ACI`

A section per object name from the `.CCG`, holding `REC` ... `END` lists of image indexes and extra pictures with a position. `[SHAD0]` through `[SHAD3]` are shadow point lists.

### `.SSD`

Sound names, one token each. The engine loads `<name>.PSD` from the scene archive.

### `.DCN` and `.FCC`

`.DCN` is dialogue. A single line is an id, a caption, a width in pixels, and a sound name. Spaces inside a caption are stored as underscores. A block starts with `Q` (an answer menu) or `R` (a group `TALKRANDOM` picks from), then an id, a count, and that many captions with a width and a sound name. The spoken audio is the sound's base name with the extension `.S22`.

`.FCC` is a face. Each record is a bracketed name, a background picture, the eye position, three eye frames, the mouth position, and five mouth frames. Face indexes from this file start at 2. Slots 0 and 1 come from the resource archive.

### `.FCM`

Short films used by `RUNFILM` and `RUNGLOBALFILMP`. `GLOBAL.FCM` in `Global.pak` is the same syntax. The play host runs the global form and the positioned scene form (`RUNFILMP`, `RUNGLOBALFILMP`). The plain `RUNFILM` word is compiled and then skipped.
