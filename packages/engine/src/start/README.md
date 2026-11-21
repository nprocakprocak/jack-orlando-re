# Start screen and game modes

The start screen does not start the game by itself. The game begins after the start button (a click or Enter). The original has no such screen. The Director's Cut starts straight into the intro, and the easy version is chosen by the external launcher `JackStart.exe`. The look uses the in-game menu components (a `GuiWindow`, the frame, buttons, and the `JACK` and `JACKM` fonts from `Resource.pak`) over the background `SETUP_OK.BM`.

| File | What |
|---|---|
| `modes.ts` | `GameModes`, defaults, `sanitizeModes`, `cycleMode`, `StartStore` (`localStorage`), `skipStartScreen` |
| `screen.ts` | `StartScreen`: the window, the mode rows, actions `start` / `change` (no DOM) |
| `assets.ts` | `loadStartAssets`: menu resources plus the background |
| `session.ts` | `Disposables`: the registry of game resources the host releases when a session ends |
| `flow.ts` | `GameFlow`: the state machine start screen → logos (always) → intro (first run) → main menu → [intro before a new game] → game → menu |
| `menu-music.ts` | `MenuMusic`: the `MainMenu` music events on the music channel |

## Background and names

- Background: `SETUP_OK.BM` from `Resource\RESOURCE.PAK` (614404 bytes = 640×480 RGB565; it used to be a dump of scene SC001). Drawn on a black surface (`setupBackground`), so transparent pixels (colour 0) are black. A missing file or a decode error leaves a black background. The original programs do not name this file.
- Value labels: the coat / the top bar, files on disk / slots in the game. Only the captions changed. The stored keys (`coat`/`bar`, `files`/`slots`) are unchanged.

## Modes and options

| Row | Values | Storage | In the game |
|---|---|---|---|
| Inventory | Coat / Top bar | `jack-orlando.modes` (`inventory`) | coat or the legacy bar |
| Easy version | No / Yes | `jack-orlando.modes` (`easy`) | chosen only here; a change means a new game |
| Save game | Files on disk / Slots in the game | `jack-orlando.modes` (`saves`) | file windows or the 10-slot window |
| Pause outside the game window | Yes / No | `jack-orlando.pauseOnBlur` = `"1"`/`"0"`, default `"1"` | the pause behaviour |

`MODE_PENDING` (`modes.ts`) greys a row out and forces its default while an entry is non-null. The game already honours every mode, so the table is all null. There is no right-button cursor rotation in the Director's Cut executable, so there is none here either.

The "show the bullet" row is not on the start screen. The `BulletOnOff` switch stays only in the game options (`jack-orlando.config`). The window is 356 px tall, and the Start button is at `y = 256`.

## Address parameters and ending a session

- `?scene=…` or `?start=1` skips the start screen and the game begins at once (`?mute=1` is still available). Sound then works as before: the `AudioContext` waits for the first click or key. `?start=0` forces the screen even with `?scene=`.
- From the start screen the `AudioContext` is created and resumed inside the Start click (a user gesture), so sound plays from the first frame.
- The host ends a session by releasing what it registered on `Disposables` (the loop, focus handling, the game, the `AudioContext`) and by sending `GameFlow` the `stop` event. That event returns to the start screen from every stage. "Quit the game" and `OUTRO.AVX` are `gameExit`: they return to the main menu, not to the start screen.
