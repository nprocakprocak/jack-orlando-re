# Dialogs

Code: `packages/engine/src/dialog/` (`caption.ts` wraps and places the caption, `menu.ts` builds and sorts the answer menu, `lipsync.ts` is the mouth frames and the step tempo, `tables.ts` is the tables copied into the engine, `controller.ts` is `DialogController`, `face.ts` composes a face window). Formats: [dialog.md](../formats/dialog.md) (`.DCN`, `.FCC`) and [fnt.md](../formats/fnt.md). The host wires `TALK`, `DIALOG`, `SHOWFACE`, `HIDEFACE`, and `SETDIALOG`. `PlayGame` has no DOM.

## The host API

```ts
const c = new DialogController({ host, tables, measure, answers: interpreter.answers });
c.loadScene(dcn, fcc); // every scene. Clears the faces and the flags
c.showFace("LOLA", "L", star); c.hideFace("L");
c.talk(speaker, lineId, channel, "-" | "+", macro);
c.talkOption(speaker, dialogId, index, channel, wait, macro); // the host picks the index
c.setDialogOption(dialogId, option, state);
c.startDialog("LEFT", dialogId, macro); // opens the menu. The macro waits
c.pointer(worldX, worldY, buttonDown); // the click point, not the raw mouse
c.tick(); c.frame(skipClick);
c.caption; c.menu; c.faceView("L" | "R");
```

`measure` is the width of text in the `JACK` font (`textWidth(font, encodeMazovia(t))`). `DialogHost.playVoice(channel, name)` returns the voice length in seconds, or `null` when the scene has no file (the same branch as `Sound_PlayTalk` `00407750`). `stopVoices()` and `resume(macro)` complete the host. `speaker` is `"LEFT"`, `"RIGHT"`, or a point `{x, y}` above a person or Jack (the middle of the sprite, the top minus 10). A line whose speaker is `0x66` (Jack) or `-12` (a fixed position) uses that point path too.

## A line (`TALK`, case 10 of `Script_ExecStep`)

1. The voice: `Sound_PlayTalk(channel, sound, 0x40)`. The channel comes from the command (`LEFT` is usually 1, `RIGHT` is 2).
2. With no voice (`00406750`): the step count is the string length, the mouth walks a cycle of 10 values from `0x5046cc` (`0 2 4 3 1 2 4 3 1 3`), and the "length" is `strlen / 10` seconds. With a voice (`00406810`): steps 0 and 1 are closed, then each character is a pair (value, count) from the table `0x503bb0` (indexed by the **signed** character, so Mazovia letters at or above `0x80` read before the start of the table), and the end is 10 closed steps. The "length" is the sound length (the header divided by 44100).
3. The tempo: `gap = length / (steps · 0.014)` (`0x503b78`. Answer lines and `TALKRANDOM*` use `0.013`, `0x503b74`). The unit is the counter `DAT_008f67f8`, incremented every 15 ms logic tick, so a line lasts about the voice length times 1.07. The face step `00413e20` runs in the frame where the counter has reached the next step (float32). One step per frame.
4. A step: the mouth is `frames[n] % 5`. Every 100th step (from 0) starts a blink. The eyes go 0, 1, 2, 1, 0 (`0x5046c4`), one frame a step, then `n++`. An armed click sets `n = 10000` and the line ends. At the end (`n` at or above the step count) the caption disappears, channels 1–4 stop (`Snd_StopChannel`), and the macro continues when `TALK` was started with `-` (`DAT_00871660 = 0`). Nobody redraws the window. The last mouth frame stays. See "The face window" below.
5. **A window with no face ends the line at once**, on the first step (`00413e20`, the branch `g_face* == -1`). A person speaker has no face (`DAT_00857c34 = 1`) and does not take that branch. The caption is drawn above the person. **`HIDEFACEAT`** only arms a flag (`Script_ExecStep` case `0x5e`). The tail of `00413e20` hides the window (`Face_Hide`) only when `g_talkActive` is 0. A script that talks and then hides the face in the same breath would otherwise lose the face on the first step and cut the line. The engine: `DialogController.hideFaceAt` (`HIDEFACE` stays immediate). There is one flag (a second command replaces the side). It is cleared on a scene change (`Game_Run` `0042b6d0`).
6. Idle blinks (`Game_Run`): the left face every 150 frames, the right every 160, for 25 frames (the order `0 1 2 1 0`, five frames each), and not on the window that is speaking.

## The caption

Wrapping (`0040c940`, and the line count `0040cf00` is the same code): the text is split into pieces that end on a space. A piece joins the line when `width(line + piece) < window width` (**strictly less**. The trailing space counts). Otherwise the line closes (without that last space) and the piece starts the next line. At most 5 lines. The rest is dropped. A word wider than the window leaves empty lines. A line is 25 px tall, the next starts 24 px down, and the text is centered in the window.

Placement of `LEFT` / `RIGHT` (`0040d250`): the center is `scrollX` or `scrollX + 0x280`, `y` is `0x8c`. The window is pushed to the screen edge (`x − w/2 < scrollX` means the left edge plus 1, and the face color comes from the left window; otherwise the right edge `scrollX + 0x27f − w`, and the color comes from the **right** window). `y < 0` becomes 1. `y + 24·lines > 0x1df` becomes `0x1df − 24·lines`. The fill color is the speaker's color from the face index (`0x8f68a4`, the table from `004028f0`: slots 0–1 are white `0xFFFF`). The outline is the fifth number of the letter-color section (1 by default). When Jack's face is on the speaker's side, the game takes the default color, which is the same as a slot below 2, so the module does not distinguish them.

A caption above a person (`0040d4b0`) uses the fifth and sixth letter colors. The vertical clamp is wrong.

`DialogOnOff` (`g_dialogTextOn`): the captions disappear. **The animation and the timing stay.** The answer menu is not hidden (`textOn` on the controller).

Text width: `Text_PrintfWidth` interprets `%` sequences (`%d`, `%c`, `%%`). They do not occur in the data. The module measures the text directly.

## The answer menu (`DIALOG`)

Opening: options without the hidden flag. The top is `y = 0x1d3 − 25·count`, `x = 6 + scrollX`, and row *k* is at `y + 24·k`. A row is 25 px tall (they overlap by 1 px, so the mouse hits the lower row).

Sorting is ascending by the field width, which is `text width + 4`, rounded up to an even number. A bubble sort of 8 elements with a strict `<` (equal widths keep the file order). Hidden options go to the end. At most 8 options. The data has at most 5.

The mouse (`0040c550`): a row highlights when the button is **held** over it. Leaving the row while the button is held clears the highlight. **Releasing** over a highlighted row selects it (after 200 ms of `Timer_Sleep`). The result is the original index of the option in the block.

**The hit point is the click point, not the mouse.** `0040c550` asks `0040bd00`, which compares `g_clickX` / `g_clickY` (`Cursor_UpdateHotspot` `0042b0f0`: the mouse plus a shift that depends on the cursor mode. For the pointer that is `(−9, −12)`), not `g_mouseX` / `Y`. The cursor picture is drawn centered on the mouse, so the tip of the arrow is 12 px above and 9 px to the left of the mouse position. `DialogController.pointer` and `MenuPointer` therefore receive the **click point** (`Cursor.clickPoint`). Passing the raw mouse shifts the hit box 12 px down, and the arrow on the first row of a menu highlights the second. A row is 25 px tall and the pitch is 24. On the shared pixel the lower row wins. A hypothesis: `0040bd00` returns the first matching sprite from the list `0xa00dc8`. The single shared pixel was not checked.

**A click that interrupts a line does not select an answer.** `Game_Run` calls `Dialog_MenuPointer` `0040c550` only when `g_menuOpen != 0 && g_clickArmed != 0`. The click that interrupts a line clears `g_clickArmed`, and it is set again only by `if (g_mouseLeftDown == 0) g_clickArmed = 1`, before the menu call. While the button that interrupted the speech is still held, the menu does not see the mouse at all. `0040c550` itself reads the level of `g_mouseLeftDown`, so without that gate a held button would highlight a row and the release would select it. In the engine: `ReleaseGate` (`packages/engine/src/dialog/menu.ts`, `packages/engine/src/play/game.ts`). The menu does not see a button that was already down when it opened, until that button is released. That reproduces `g_clickArmed`. The click does not leak into the scene (`armed` stays false until the button is released, and `pressed` is cleared).

A choice stores `g_dialogAnswers[dialog] = index` (`answers.set`), then the game plays the chosen option as a line (channel 1 for `LEFT`, otherwise 2, the speaking window L or R from the `DIALOG` speaker, tempo 0.013). The `DIALOG` macro continues after that line ends. The answer uses the window and the channel of the `DIALOG` speaker: `strcmp(speaker, "LEFT")` sets `DAT_006d6218` to 1, calls `0040d250(scrollX, 0x8c, …)` and `00413d20` for the left side, and uses channel 1. Otherwise it sets `DAT_00898100` to 1, calls `0040d250(scrollX + 0x280, …)`, uses the right side, and channel 2. The caption is therefore under that side's window. A click beside the rows stores `-1` in the game (`g_dialogAnswers[dialog] = 0xFFFF`). `IFANSWER` then sees "no answer". In the engine the answer is stored only on a choice, which is the same for `IFANSWER`, because the menu lasts until a choice.

`IFANSWER` (the comparison with `answers`, and the jump bug of nested `IfF`) lives in the interpreter.

## How a menu row looks (`0040be20`, `0040c550`)

Each row is a sprite (0x19 px tall, the tables `0x8a8a80` / `0x8a1784`), redrawn by `0040be20(sprite, state, x, y, color1, color2, text)`. `Text_PrintfAt(x, y, c1, c2, …)` is `Font_DrawText` (`0047b8e0`, `0046e580`).

- **State 1 (normal):** first `Text_PrintfAtRemapAlt(1, 1, 10, 6, …)`, a shadow at (+1, +1), then the text at `(0, 0)` in the outline and fill from the arguments. The shadow is not a fixed color. `Font_DrawTextRemapAlt` `0046e8f0` plus `0046ea15` reads the background pixel under the glyph and writes it through a table (a darkening). 10 and 6 are the parameters of that table. The exact formula was not taken apart.
- **State 0 (pressed):** `Text_PrintfAtRemapAlt` is skipped (`if (state != 0)`), and the text goes to `(state ^ 1, state ^ 1) = (1, 1)`, exactly where the shadow was.
- Colors: `0040bf90` draws the rows with `(g_textColors[0] = 1, 0x504aba = 0xFFE0 yellow)`. `0040c550` restores an unpressed row to `(0x504ab8 = 3, 0x504aba)`, and a pressed row is drawn with `(p3, p4)`, where `p3 = 0x504ab4 = 3`. The listing does not show the fourth argument `p4` (the call has 3 arguments). The neighboring pairs of outline and fill in `.data` are `(0x504ab4 = 3, 0x504ab6 = 0xFFFF)` and `(0x504ab8 = 3, 0x504aba = 0xFFE0)`, so `p4` is `0x504ab6`, white. That matches play. The read of `p4` itself is a hypothesis.
- **There is no hover.** The highlight branch of `0040c550` requires `DAT_009d2820 == 1` (the button is down). The choice branch requires `DAT_009d2820 == 0` over a highlighted row. Moving the pointer alone does not change the sprite.

## The face window

`composeFace(view, image)` (`packages/engine/src/dialog/face.ts`) builds the inside of a 132×132 window the way the game does. The frame and the scene under it are drawn by the renderer. The window is at `scrollX + 2` (left) or `scrollX + 0x1fa` (right), `y = 2`.

Everything is drawn by `Blit_Pal8Keyed` `0046ee70` with a step of `±1` (`−1` is a mirror: the source starts at the right column, the destination always starts at the left `x`, color 0 is skipped, and a negative destination `x` or `y` becomes 0). In the engine that is `blitScaled` from `packages/engine/src/render/surface.ts` with the step `{int: ±1, frac: 0}`.

The mirror of the left window makes a drawing that faces left look toward the middle of the screen. In play, the person in the left window always looks toward the middle, and the person in the right window looks left, which is also toward the middle.

The face is at `(0x82 − width, 0x82 − height)`. An overlay is at `(x + 2, y + 2)`, and in a mirrored window at `(0x82 − width − x, y + 2)` with the frame mirrored. Overlay sizes come from frame 0 of the set (`**(short**)g_faceMouth[slot]`, and the same for the eyes). On the game data the result is simply a mirror of the whole window (column `X` becomes `0x83 − X`).

`FaceView.source` is `"resource"` for slots 0 and 1 (`BUILTIN_FACES`: `JACK` and `JACKWOJ` from `RESOURCE.PAK`), otherwise `"scene"` (the scene archive). `c.jackUniform = true` (the host, from `g_jackUniform`) substitutes `JACKWOJ` for `JACK`. `g_jackUniform` `0x8f68d9` is the **uniform** flag, not the gun. `EXTRA 6` turns it on (`Script_ExecStep` case `0x24` goes to `00417e40`: the walk frames in the uniform, `JACKISWOJ = 1`). The only use is the take-the-uniform macro in `SC105` (together with `Let JACKISWOJ 1`). `EXTRA 8` turns it off (`00416a90`, `JACKISWOJ = 0`), and no script uses it. The load paths (`004098f0`, `Menu_InGameOptions` `0040b580`) also clear it, and `00409090` restores the state from `JACKISWOJ`. After the change of clothes the portrait stays for the rest of the game.

`SHOWFACE` (`Face_Show` `00413970`) clears the buffer and draws the face alone, **with no mouth and no eyes**. A line step (`Talk_FaceStep` `00413e20`) draws again: the face, a mouth frame, and an eye frame when a blink is running. After the line the window stays as it was (the last mouth frame). An idle blink (`Game_Run`) draws the eye frame **onto whatever is already in the buffer** (no face), and the last frame stays. Frames are keyed on color 0, and 799 of 992 eye and mouth frames have transparent pixels, so `FaceView.eyes` is the list of frames drawn since the last full redraw (a repeated frame covers its earlier copy, so each appears once, and the list has at most 3 entries). `FaceView.mouth` is the last mouth frame, or `null` after `SHOWFACE`.

The host (`packages/engine/src/play/facewin.ts`) copies the scene under the window (`Render_ComposeRegion`, 132×132 at `scrollX+2` or `scrollX+0x1fa`, `y = 2`), runs it through the color tables (`0046e2b0` / `0046e370`: `0x504ae8` blue, `0x505b68` green, `0x506be8` red, 33 levels of 0x80 bytes). The inside from (2, 2) is level `0x10`. Two rings (`004662e0`): the top and left edges are level 10, the bottom and right are `0x16`, and two corners (top-right, bottom-left) are `0x10`. The portrait is drawn on top of that (color 0 is transparent). The window is therefore a darkened snapshot of the scene. It is redrawn only when the face changes (mouth or eyes), so the background is a snapshot from that moment. `HIDEFACEAT` hides the face only after the current line ends.

## The caption and scrolling

The caption is a sprite (`Sprite_Add` / `Sprite_Set`) in **world coordinates** (`Caption_Draw` `0040c940`, `x` is the argument, `y` plus `g_scrollY`), placed once when the line starts (`Caption_ShowSpeaker` `0040d250` with `DAT_008f690c` equal to `scrollX`). The original does not recompute it while scrolling. When the view moves on, the caption moves with the scene. The engine draws it as `x − scrollX`. Nothing in the code pins the caption to the screen. A caption that left the screen was the view scrolling past the scene's real limit. See [render.md](render.md).

**`SHOWFACE` waits until scrolling stops.** In `Script_ExecStep` `0041a330`, case `0x17` (command code `0x18`, `SHOWFACE`), the whole command runs only when `DAT_00870cf8` is 0, which means "the view did not move on the last 14 ms tick". `Game_Tick14ms` `00426c10` sets the flag to 1 when `g_scrollX` changed by 4 px. While the view is moving, the command does nothing and the macro's command counter (`DAT_0054d8b0 + macro·0x46`) steps back by 1, so the same command runs on the next tick. Only this command has that check. `TALK` (case 10) does not. In the init of SC005B the order is a scroll, a walk, a stay, `SHOWFACE`, then `TALK`: Jack reaches the other person, but the face (and with it the line) appears only when the view has stopped. That matches play, including a fast walk.

The engine did not have this condition. At the default walk Jack still arrived after the scroll, but a faster walk (`WalkSpeed` at or above 2, a step every 1–3 ticks) started the line while the view was still moving. `SceneHost.viewScrolling` (`packages/engine/src/play/host.ts`, set after the scene tick in `PlayGame.update`) reproduces `DAT_00870cf8`. `SHOWFACE` returns `"repeat"` while the flag is set, except in `[PRE]`, which runs in a loop with no clock.

**A departure, on purpose.** The original does not pin the caption to the screen. The engine does: `captionTimer` remembers `g_scrollX` when the caption appears, and the lines are drawn by `captionLineX(x, scrollAtStart)` (`x − scrollAtStart`), so a caption that starts during a scroll (for example a `TALK` with no `SHOWFACE`) does not ride off with the scene. With a `SHOWFACE` that matches the original, this departure only matters in those rare cases. The face windows and the answer menu are unchanged.

## Music ducking

`MusDownOnOff` defaults to 1. From the code, `Music_DuckDown(1)` `00402fb0` is called by `Caption_ShowSpeaker` `0040d250` (a line in the LEFT or RIGHT window, including an answer from the menu, not a caption above a person). `Music_DuckUp(1)` `004030a0` is called at the end of every line in `Talk_FaceStep`. The step is 1 per 14 ms tick, up to `MusicVol` times a multiplier. The downward target depends on a comparison of `TalkVol/2` with `MusicVol` times the multiplier (two `__ftol` variants whose arguments are not visible). **The target value stays a hypothesis.** The engine uses half the volume. In play the music fades out on a line and fades back in after it, and on the answer menu, which matches: the menu opens after the line, and with no line the music is loud.

## Tests

`packages/engine/src/dialog` tests cover wrapping (the `<` boundary, 5 lines, a word that is too wide), LEFT, RIGHT, and person placement, menu sorting and mapping, the mouse (press and release), lip-sync with and without a voice (a signed character), the float32 tempo, and the controller (line order, the blink 0-1-2-1-0, channels 1 and 2, `answers.set`, `SETDIALOG`, `DialogOnOff`, a missing face, idle blinks). The tests build their own bytes.
