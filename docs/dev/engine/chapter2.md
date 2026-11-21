# Chapter 2: the city, the clubs, and the workshop

Entered from the map `SC000D` with `LAST` 6 (the drive from SC006), into `SC032` or `SC032B`. Left from the workshop yard `SC069`, the car, when `DALFLASZ` is 1: `ODJECHAL69` becomes 1, `LAST` is 69, and the scene is `SC000D`. After that the map no longer opens `SC032` (the condition wants `ODJECHAL69` at 0).

Place names below are what the pictures and the scripts show. They are labels for the graph, not lines from the game.

## Places

| Scenes | Place |
|---|---|
| `SC031`, `SC032`, `SC032A`, `SC032B` | the street in front of the Cotton Club. `SC032` is the ordinary street, `SC032A` is the shooting and the police (`POSTRZEL` is 1, before the street is cleared), `SC032B` is empty (`S32PUSTA` is 1). The neon spells the club's name |
| `SC033` | the corner by the hotel. With `LAST` 47 Jack leaves here with Belinger |
| `SC034`, `SC035`, `SC037`, `SC038` | the hotel: the lobby, the key board, the corridor with the elevator, Belinger's room |
| `SC039`, `SC044`, `SC045` | behind the hotel: the boarded street, the alley under the window, the yard with the ladder toward `SC051A` |
| `SC040`–`SC043` | the yard and the storehouse, the vagrant, the bat, and the way down into the cellars |
| `SC046`, `SC047A`–`D`, `SC048`–`SC051`, `SC051A` | the street with the taxi and the doorman, the club (the variant depends on the variables), the back of the club, the yard where Jack meets Smiss |
| `SC052`–`SC058`, `SC055A`, `SC057A`, `SC058B` | the street with the couple, the bar, the casino, Scalletti's office, the locked room, the corridor, the guard at the valve, and the death scene `SC058B` |
| `SC059`–`SC065` | the streets, the bar with the pianist, Charlie's shop, and the second way into the cellars (`SC210` from `SC061`) |
| `SC066`–`SC071B` | the streets to the workshop, Frank's workshop (the yard with Jack's car, the interior, the hangar with the plane and the card `MAKARTE`) |
| `SC072`, `SC073` | the truck with the crank, and the distillery |
| `SC201`–`SC210`, `sc201a` | the cellars. The torch (`SC201SWIECI`), the stones and the stairs, the books, the trap and the token, the furnace, and the exit to `SC061`. Entered from `SC040` (show-right, x at least 480) and from `SC061` (show inward, x at least 320) |

## Exits

`cel/LAST`, and a condition in brackets. `clickX` is the click. `MOUSEX` is the special variable.

| Scene | `LAST` on entry | Exits |
|---|---|---|
| `SC000D` | 6, 32, 69, 75, 87 | `SC032/6` when `ODJECHAL69` is 0, otherwise `SC032B/6`. Home is `SC006/32`. Chapter 3 is `SC075/6`. `INIT` at `LAST` 87 goes to `SC100` |
| `SC031` | — | `SC032/31` when the street is not empty and `POSTRZEL` is 0, `SC032A/31` when `POSTRZEL` is 1, `SC032B/31` when the street is empty |
| `SC032` and `SC032B` | 6, 31, 32, 33, 66, 75 (and 69 on B) | the map `SC000D/32` by the car, `SC031/32`, `SC066/32`, `SC033/32` |
| `SC032A` | 31, 33, 66 | `SC031/32`, `SC066/32`, `SC033/32` |
| `SC033` | 32, 34, 39, 47, 63 | `SC032A/33` when `LAST` is 47 (leaving the club with Belinger), `SC039/33`, the same street split as SC031, `SC034/33`, `SC063/33` |
| `SC034` | 33, 35, 37 | the elevator `SC037/34` (`LOC4` is 1), `SC035/34`, `SC033/34` |
| `SC037` | 34, 38 | the elevator back, and `SC038/37` when `MOUSEX` is above 517 |
| `SC038` | — | the door back when the cut has not played, and the window to `SC044` |
| `SC039` | 33, 40, 44, 45, 46, 61 | `SC046/39`, `SC033/39`, `SC061/39`, and by `MOUSEX`: `SC045` below 370, `SC040` when the boards are kicked and x is below 650, `SC044` above 650 |
| `SC040` | 39, 41, 42, 43, 201 | `SC039/40`, and by the click: `SC043` at or below 480, the cellars at or above 480 (`SC201` if the torch is lit, `SC201A` if it is not), `SC042` at or below 196, `SC041` at or above 196 |
| `SC046` | 39, 47, 52 | `SC052/46`, `SC039/46`, and the club: `SC047D` when `POSTRZEL` is 1, `SC047C` when Smiss has been stunned, `SC047B` when the meeting is known, otherwise `SC047A`. The doorman has to be standing |
| `SC047A`–`D` | 46, 48 | back to the street, and `SC048/47`. `SC047B` leaves with Smiss to `SC051/47`. `SC047C` leaves with Belinger to `SC033/47` |
| `SC052` | 46, 53, 58, 59 | `SC059/52`, `SC046/52`, the corridor when the click is at or below 280 and the chain is off, otherwise the bar |
| `SC055` | — | `SC058B` when Smiss was not tied (the death), otherwise `SC057` |
| `SC058` | 52, 56 | `SC056` when the click is at or below 500, and `SC052` when it is at or above 500 and the chain is off |
| `SC058B` | — | only the film `Z58B` |
| `SC061` | 39, 59, 62, 63, 210 | the streets, the shop at a click at or below 320, and the cellars at or above 320 |
| `SC063` | 33, 61, 64, 65, 66 | `SC066/63`, `SC065` at a click at or below 360, `SC064` at or above 360, `SC061/63`, `SC033/63`. Entering from `SC063` with `LAST` 63 is the moonwalk. |
| `SC069` | 68, 70, 71 | the street, the hangar (`SC070` when `POSTRZEL` is 1, otherwise `SC070A`), the interior by `LANCUCH58` and `POSTRZEL`, and **`SC000D/69` when `DALFLASZ` is 1** (the end of the chapter) |
| `SC072` | 66, 73 | `SC073` with no new `LAST` (it stays whatever SC072 was entered with. SC073 does not test it), and `SC066/72` |
| `SC201`–`SC210` | the neighboring numbers | the chain of the cellars, by `MOUSEX` at 320 where a scene has two ways, and `SC210` back to `SC061` (`WYSZEDL210` is 1) |
| `sc201a` | 202 | back to `SC040`, or on to `SC201` once the torch is lit |

The other scenes of a block (`SC035`, `SC041`–`SC043`, `SC050`, `SC051`, `SC060`, `SC062`, `SC064`, `SC065`, `SC070*`, `SC071*`, `SC073`) return to the scene that entered them. The full condition of each door is the script of that scene. The table is the graph, not a route to click.

`S32PUSTA` becomes 1 on entry to `SC034`, `SC039`, `SC063`, `SC067`, or `SC072`. Two screens away from the shooting, the street in front of the club is empty and the arrest no longer threatens. A talk with the inspector always ends in the arrest film and the end of the game. The man who leaves the elevator in `SC034` does not block Jack beyond the ordinary step-aside. The rope in `SC042` is given only after the vagrant is beaten with the bat.

A `WALKTO` that stands at its first step in SC033, SC034, and SC052 is Jack being stopped by `checkAvoid`, which is what the original does. See [avoid.md](avoid.md). The west port can already be clicked in this chapter.

## Deaths

Every `RUNAVX` except `OUTRO.AVX` ends the game (`Game_Run` at `0043b37a`). The engine sets `exit` to `"death"` and returns to the main menu. That return is a departure: the original leaves the process. Chapter 2 has eight calls and seven films. There is no `CO10`, `CO30`, or `CO60` timer. The player's time is `DONOTHING n` (frames) and `ACTIVEMACROAT`.

| Scene | Film | When | How it is avoided | Easy mode |
|---|---|---|---|---|
| SC032A | `Z32A.AVX` | leaving the club with Belinger, `POSTRZEL` is 0, and `GUN` is 0. The car shoots, Jack falls, then the film | have the revolver from chapter 1 (`GUN` is 1). Jack fires back and `POSTRZEL` becomes 1 | unreachable. The easy mode gives the revolver at the start. |
| SC032A | `KRATY.AVX` | after the shooting, the police, and then the inspector. Every branch of that talk ends in the arrest | leave SC032A before the inspector arrives. `S32PUSTA` becomes 1 two screens away, and the street is then `SC032B` | no inspector (`LIGHTVER` is 0 around that block) |
| SC038 | `Z38.AVX` | Belinger's room. After the wait he enters and shoots. Leaving by the door after the cut is the same film | leave by the window, or by the door, before the cut | no cut |
| SC042 | `Z42.AVX` | the fight with the vagrant, with no bat | take the bat from SC043 first | the fight runs only when the bat is held |
| SC051 | `Z51.AVX` | the meeting with Smiss. After `DONOTHING 400` he shoots | strike or shoot him within those frames | no counter |
| SC058 | `Z58.AVX` | a click on the floor while the guard is awake | open the valve first, so the steam drops him | the prologue sets the guard already down |
| SC058B | `Z58B.AVX` | led out of Scalletti's office because Smiss was not tied | tie the stunned Smiss with the rope | the casino exit sets the tied flag |

The easy mode removes these deaths. See [easy.md](easy.md).
