# Chapter 3: the port and the warehouse

Entered from the map `SC000D`, the west-port zone, which sets `LAST` to 6 and goes to `SC075`. The init of `SC075`, when `LAST` is below 76, plays the drive in and sets `LAST` to 77. The port can already be clicked in chapter 2. When `DALFLASZ` is 0, the prologue of `SC075` turns the bar door off. Left from the warehouse roof `SC087`, the rope, when `MOUSEX` is above 320: `SC000D` with `LAST` 87, which is the truck on the map and the start of chapter 4.

## Places

| Scenes | Place |
|---|---|
| `SC075` | the drive into the port. The car returns to the map from here |
| `SC076` | the port bar |
| `SC077` | the gate with the chain and the padlock, and a coin on the ground |
| `SC078`–`SC081` | the port street (a truck passes), the drunk, the yard with the dog, the man by the door |
| `SC082`–`SC085` | behind the gate: the yard with the crane and the patrol, the corner of the warehouse, the wall with the door, the interior with the ladder |
| `SC086`, `SC087` | the warehouse. The walkway over the hall (the deal), and the roof and the cornice. The rope goes down onto the truck. The end of the chapter |
| `SC088`–`SC092` | the quays. `SC089` is the captain. `SC090` and `SC091` are chosen by the click |
| `SC093` | the shed with the three men, the crowbar, the plank, the key, and the cork |
| `SC094`, `SC095` | the jetty and the barge (a plank for the crossing), and the boat with the anchor |

## Exits

| Scene | `LAST` on entry | Exits |
|---|---|---|
| `SC000D` | 6, 32, 69, 75, 87 | `SC075/6` for the west port. `INIT` at `LAST` 87 goes to `SC100`. The rest is chapter 2 |
| `SC075` | 75, 76, 77 | the map by the car, the bar, left to `SC077`, right to `SC078` |
| `SC076` | — | back. The script names the target with a `.CFG` suffix |
| `SC077` | 75, 82 | back to `SC075` (left or right sets `KIERUNEK`), and `SC082` when the gate is open, or when it is closed and the padlock has been cut (that opening sets the flag) |
| `SC078` | 75, 79, 81 | the door to `SC081`, back, and `SC079` when the truck is not passing |
| `SC082` | 77, 83 | `SC083` and back |
| `SC083` | 82, 84 | `SC084` and back. Two `[GANGSTER]` sections. The script hits the first. See [persons.md](persons.md) |
| `SC084` | 83, 85, 88 | left to `SC088`, back, and the door to `SC085` once `OTWARTE84` is 1. A return from the warehouse can land under the patrol. |
| `SC085` | 84, 86 | down to `SC084` when `LOC1` is 0, and up the ladder to `SC086` when `LOC1` is 1. The item condition is below |
| `SC086` | 85, 87 | back, and up to `SC087` |
| `SC087` | 86 | the map when `MOUSEX` is above 320 (the rope, the end), and the ladder down |
| `SC088` | 84, 89, 90, 91 | back, the captain, and `SC090` or `SC091` by the click at 250 |
| `SC090`, `SC091` | 88, 92 | `SC092` or back, by `MOUSEX` (500 or 200). `FLX1` of SC090 has no animation. |
| `SC092` | 90, 91, 93, 94 | the four ways, by `MOUSEX` at 200 and at 500 |
| `SC094` | 92, 95 | back, and `SC095` once the plank is down (`DESKA094` is 1) |

The gate of `SC077` squeaks and Jack steps back until the hinges are greased (`POSMAROWANE77`). That is not a death.

`SC085` toward `SC086` checks the items. In the easy mode the hammer, the rope, and the anchor are all required. In the normal mode the block is only "the rope and the anchor are held, and the hammer is not". With neither rope nor anchor the door is open, and the roof then has no way out except the ladder down, which is the death below. The hammer has no other use. The warehouse door of `SC104` is chapter 4.

The rope descent of SC087 clamps `MOUSEX` to 320 unless the rope zone is enabled. Without the anchor, the right edge of the lower zone is the bug the engine keeps. See [script-overrides.md](script-overrides.md). The guard's body under the cornice is [render.md](render.md).

## The patrol clock

`OCHR` is the clock. It advances by 1 every 64 logic ticks (`AUTOINCRANGE`). It survives a scene change. The gangster of `SC083` and the one of `SC084` read it on entry and every 100 ticks. The patrol on the roof reads it on a longer period (2500 ticks) during the descent.

## Deaths

Every `RUNAVX` except `OUTRO.AVX` ends the game. The engine returns to the main menu (`exit` is `"death"`). Chapter 3 has fourteen calls and eight films. `PLAND` and `ZIEM` are deaths during the descent, not the end of the chapter. There is no `CO10`, `CO30`, or `CO60`. The easy mode (`LIGHTVER` is 1) turns all of them off except the return from the roof, and even that return is blocked because the prologue of `SC087` disables the downward zone.

| Scene | Film | When | How it is avoided |
|---|---|---|---|
| SC083 | `83JC.AVX` | the gangster comes around the corner while `OCHR` is below 10, in one of three variants by Jack's position. An entry from `SC084` while `OCHR` is between 9 and 16 snaps the clock to 5 | enter from `SC082` when `OCHR` is at least 10, and cross before the clock returns to 0. The easy mode deactivates the macro |
| SC084 | `84JC.AVX` | `OCHR` between 15 and 24, and Jack is far enough right. Both macros wait while he is opening the door. An exit from `SC085` while `OCHR` is between 24 and 39 snaps the clock to 21 | do not stand in `SC084` in that window. Leave the warehouse when `OCHR` is below 25 or at least 39 |
| SC086 | `PLECY.AVX` | a click to the right of x 372, or the ladder while x is below 372, before the key has fallen and before the switch has been used | use the switch first. It does not darken the room. It makes a noise, the men go to look, and the key falls safely. The easy mode sets the key already fallen |
| SC086 | `BRZU.AVX` | after the switch, a click to the left of x 260, or the left exit. The man on the right comes in from the left and shoots | after the switch, only up the ladder |
| SC086 | `PLECY.AVX` | the return from the roof down the ladder (`LAST` 87). Jack climbs down and the men shoot | do not come back. The easy mode disables the downward zone on the roof, so the return should be impossible. The `RUNAVX` itself has no `LIGHTVER` test |
| SC087 | `GORA.AVX` | the guard is not stunned. A blow, the catch-all on the head, or the anchor on the cornice starts it. A look at the truck or the hall can too | shoot the guard first (`LOC1` becomes 1). In the easy mode a blow stuns him and this film does not run |
| SC087 | `ZIEM.AVX` | the descent, and the patrol is in sight (`LOC3` is 1 or 3). Jack falls in the first half | descend when `LOC3` is 0 or 2. The easy mode turns the shooting off |
| SC087 | `PLAND.AVX` | the same, but the shot lands in the second half of the descent. Jack falls onto the tarp | the same |
| SC093 | `93JC.AVX` | the first visit, stepping in past x 230 and y 390. The three men close in, and after 500 frames the film runs if nobody was shot | shoot one of them within those frames. They run, and the crowbar stays. The easy mode has no counter |

`WIEOWLAMANIU` starts at 1, which is the break-in report, not a count from zero.
