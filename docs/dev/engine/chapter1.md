# Chapter 1: the streets, the arrest, and the office

The scenes are the street around the office, the arrest, and the rooms Jack searches before he drives away. `LAST` is the number the source scene stores before `GOTOSCENE`. A dash means that macro does not set `LAST`. A condition is the `IF` around the command. The engine follows these jumps. It does not invent a route.

## Exits

| Scene | Macro | To | `LAST` | Condition |
|---|---|---|---|---|
| SC000 | show-up | SC003 | — | the ladder is down (`DRABNADOLE` is 1) |
| SC000, SC000B, SC000C | show-left | SC005B | 0 | |
| SC000B, SC000C | show-up | SC003 | — | |
| SC001 | into the car | SC022 | — | the normal mode (`LIGHTVER` is 0): the arrest |
| SC001 | left | SC005 | 1 | the easy mode, after the handcuff film in the inspector's macro |
| SC002 | show-left / show-up | SC006 / SC004 | 2 / 2 | |
| SC003 | show-down | SC000B / SC000C | 3 | `ROZMZINSP` is 0 / 1 |
| SC004 | show-down | SC002 | 4 | |
| SC005 | Jack goes home, on foot or by car | SC011 | 5 | entry `LAST` 1 (on foot) or 24 (by car, from the arrest) |
| SC005B | init | SC007 | 5 | `LAST` is 0 and `WMORDE` is 1 |
| SC005B | show inward / show-left | SC011 / SC018 | 5 | |
| SC005B | show-right | SC007 | 5 | the click x is at least 450 |
| SC005B | show-right | SC000 / SC000C / SC000B | 5 | x at most 450, and the inspector-talk flags |
| SC006 | the car, and the key on the car | **SC000D** | 6 | driving away. The end of the chapter |
| SC006 | show-right | SC002 / SC008 | 6 | x at most 450 / at least 450 |
| SC006 | show-left / show inward | SC019 / SC012 | 6 | |
| SC007 | init | SC008, with a dissolve | 7 | `LAST` is 5 and `WMORDE` is 1. Jack was beaten in the alley |
| SC007 | show-right / show outward | SC009 / SC005B | — / 7 | |
| SC008 | show outward / show-right | SC006 / SC010 | 8 | |
| SC009 | show inward | SC007 | 9 | |
| SC010 | show inward | SC008 | 10 | |
| SC011 | show-right / show-left / show inward | SC014 / SC013 / SC005B | 11 | the right door wants the key of that door |
| SC012 | show-right / show inward | SC015 / SC006 | 12 | |
| SC013 | show-right | SC011 | 13 | |
| SC014 | show inward | SC011 | 14 | |
| SC015 | show inward | SC012 | 15 | |
| SC018 | show-left / show-right | SC020 / SC005B | — / 18 | |
| SC019 | show-right / show-left | SC006 / SC021 | 19 | |
| SC020, SC021 | show-right | SC018 / SC019 | 20 / 21 | |
| SC022 | the second policeman | SC025 | 22 | |
| SC025 | init | SC026 | 25 | after the handcuff film. The data names the scene with a `.CFG` suffix. The engine loads the scene of that name |
| SC026 | the commander | SC023 | 26 | a timed macro after the spoon is taken, or after the conversation |
| SC023 | init | SC024 | 23 | |
| SC024 | the dialog exit | SC005 | 24 | after the handcuff film. The interrogation ends |

Entries from the map `SC000D` also test `LAST` 32, 69, and 75 in the init of SC006 (the return from later chapters). Ctrl and point 3 of the coat set 6, 32, or 75. See [cheats.md](cheats.md) and [inventory.md](inventory.md).

SC005, SC022, SC023, and SC025 pass straight through in `[INIT]` and do not show Jack. That is what the scripts do. SC001 plays itself out: the normal mode goes to SC022, the easy mode goes to SC005. SC026 waits for the player (the spoon). The spoon is not required to leave. The conversation is enough.

Films of this chapter: the fight in SC009 when `SILNY` is 0, the handcuff films, the matches, the key under the windshield, the drawers and the safe, and the two global films that combine items (`PODKOWA`, `WIAZKOTW`). See [inventory.md](inventory.md).

## Commands the scripts rely on

These are what the original does. The engine runs them.

- `PICKUP n` bends Jack down for an item, an insertion from `GLOBAL.ICS` chosen by `g_jackDir` and the uniform (`PP_*` civilian, `PM_*` uniform, the suffix `0` or `1` is the bend or the return). The command waits on the state `0x6d5060`.
- `GIVE n` is the hand-over and the put-away, the same state.
- `SLAPF n` is a punch, only at `g_jackDir` 1, 3, or 4. Phase 1 sets state 3, and the end of the insertion starts the continuation.
- `SHOOTF n` is the revolver, the same directions.
- `EXTRA 1` loads the second cursor set and sets `GUN` to 1. Jack takes the revolver from the safe. It does not change the cursor mode. See [play.md](play.md).
- `EXTRA 10` stops the music and clears the track name, so the next `MUSIC` always starts fresh.
- `CHWINDOW` of `CAR1` and `CAR2` in the prologue of SC001 names objects the scene does not have.
- `BRIGHTNESSE` rewrites an object's palette. `SETDARKNESSANIMA` sets the darkening color of an animation (the windows of SC005 and SC005B). `SHOWANIMAFRAME` shows one frame (the ladder of SC000 stays down). `CLEARANIMABUFFER` clears an FLX frame buffer. `MOVEEP` moves an object's point (the sweeping in SC013). `RELATIVEMULP` writes a light or shadow scale. See [animation.md](animation.md).

An object whose name ends in a scene number (the newspaper `GAZ.000`, the doors of SC011) is a picture in that scene's archive, decoded by the object's type, not by the extension. See [scene.md](../formats/scene.md) and [render.md](render.md).

## The easy mode

`LIGHTVER` skips the arrest. Jack leaves SC001 on foot toward SC005, and he already has the revolver, so the refusal to drive away from SC006 with no gun never plays. That block is unreachable. See [easy.md](easy.md).

## A drive away

The car of SC006, when the conditions of the macro are met, goes to the map `SC000D` with `LAST` 6. The map's click rectangles are the engine's kept departure. See [map.md](map.md).
