# Chapter 4: the base, the uniform, and the end

Entered from the map `SC000D` when `LAST` is 87 (the truck at the end of chapter 3). The init loads `SC100`. There is no death film. The failures are arrests. The easy mode closes the ways into them. The end is `OUTRO.AVX` from the colonel's office.

Scenes with no `.PH2` (`SC103`, `SC109`, `SC110`, `SC111`, `SC118`, `SC119`) are not dead. A `.PH2` holds a scene's own insertions of Jack, and these scenes have no `RUNINSERTION` and no `INITFIRST` of Jack. He only walks and looks. All of them can be reached.

## Places

| Scene | Place |
|---|---|
| `SC100` | the shed. Jack jumps down from the truck. The crate with the axe, the vise, the oil, the bearing |
| `SC101` | the barrack yard. The hub: the shed door, left, right, and the street |
| `SC102`, `SC103` | the boiler room and the coal, and the kitchen. The ladle leads to a key |
| `SC104` | behind the barracks. The warehouse door starts closed. A soldier runs the street. |
| `SC105` | the uniform store. `EXTRA 6` and `EXTRA 11`. The coat and the portrait change here and stay. See [dialog.md](dialog.md) and [inventory.md](inventory.md) |
| `SC106`, `SC107` | the street with the bar, and the officers' mess |
| `SC108` | the gate by the tracks. **An arrest in the coat** |
| `SC109`–`SC111` | the base: the ramp with the jeep and the helmet, the yard with the gun and the runner, the yard with the lift |
| `SC112` | the headquarters. **An arrest in the coat.** A pass is required in the uniform |
| `SC113` | the headquarters corridor. Four exits, by the click |
| `SC114` | the office. The ink |
| `SC115` | the telephone exchange. The call to the major. It tests `MARZECZY` |
| `SC116` | the major's office. **An arrest in the uniform** |
| `SC117` | the colonel's office. **The end**, `OUTRO.AVX` |
| `SC118`, `SC119` | alleys. Each has one way out |

Several items of this chapter are never used. Several variables are never written into the save as anything but ordinary variables, and some are never read.

## Exits

`SC100` goes to `SC101` once the door is open (`D100OPEN`, the axe, the film of the axe). `SC101` goes left to `SC104`, right to `SC102`, out to `SC108`, and back into the shed. `SC102` goes back, on to `SC111`, and into the kitchen. `SC104` goes back, out to `SC106`, and into `SC105` once the lockpick or the key has opened the door, which the prologue starts closed. Those exits wait while the soldier is running (`WAITWHILE LOC4`).

The rest of the base hangs off `SC101`, `SC106`, `SC108`, and `SC111`. `SC112` is reached from `SC110`, `SC111`, and `SC113`. `SC116` is reached from `SC117` by the right-hand door, and that door is the arrest below. `SC117` is the colonel's office. Leaving it to the right before the ending is the arrest. Staying, and finishing the scene, is `OUTRO.AVX`.

A line of `SC117` has no voice. The second argument of `RUNAVX` there names a picture. The name is stored and never read.

## Arrests

Every `RUNAVX` except `OUTRO.AVX` ends the game. The engine returns to the main menu. Chapter 4 has four calls, two failure films (`PLA` twice, `MUN` once), and the ending. No `CO10`, `CO30`, or `CO60` leads to a failure. `CO30` and `CO60` here are the birds.

| Scene | Film | When | How it is avoided | Easy mode |
|---|---|---|---|---|
| SC108 | `PLA.AVX` | Jack is in the **coat** (`JACKISWOJ` is 0) and enters from `SC101` or from the left of `SC106`. Every branch of the talk ends in the film | enter only in the uniform. An entry from `SC109` does not arrest, and the coat cannot reach `SC109` | the prologue of `SC101` and `SC106` closes the exit while the coat is on |
| SC112 | `PLA.AVX` | Jack is in the **coat** and enters from `SC110`, `SC111`, or `SC113`. After the whole answer tree the film runs | the same | the prologue of `SC111` disables the zone toward `SC112`. The coat cannot reach `SC110` |
| SC116 | `MUN.AVX` | Jack (in the uniform, or he would not be here) leaves the colonel's office to the right (`LAST` 117). There is **no condition**. Every such exit is the film | do not leave `SC117` that way. Go on to the ending | the prologue of `SC117` disables the right-hand door |

In the uniform the gate salutes and the scene plays, and the headquarters asks for the pass. Neither is the film.

## After `OUTRO.AVX`

`Game_Run` (`0043b628`) sets `g_gameFinished` when the movie is `OUTRO.AVX`. The scene loop ends. The archives close. The program returns to the launcher, which is the main menu. See [architecture.md](architecture.md) and [mainmenu.md](mainmenu.md). The circle drawn over the movie, and the mute, are the outro. A load after a death movie restores the variables from before the movie.
