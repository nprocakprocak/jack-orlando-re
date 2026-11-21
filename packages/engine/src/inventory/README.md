# Jack's coat

Behaviour of the coat screen. No DOM.

- `model.ts` — `Inventory`: 84 slots, the region chosen by `marzeczy` (non-zero: 0…65, zero: 66…83), `add/has/remove/noHave/take/putBack/pull/placeAt`, `moveBigRegion` (EXTRA 11), `snapshot/restore` (the hand and `scrollRow` are not saved), `limbo` = the item that was in the hand when a macro started.
- `layout.ts` — screen geometry (5×3 grid, arrows, OPT, Ctrl points).
- `screen.ts` — `CoatScreen`: `pointerDown/Move/Up`, `keyDown(DIK)`, `tick()` once per frame, `draw(dst)`. The host receives `startMacro(name)`, `itemName(file)`, `onExit({close|options|macro|ctrl})`. The host draws the cursor (the hand holding an item).
- `assets.ts` — `loadCoatAssets(Global.pak, Resource.pak)` (`JACKM.FNT` from Resource.pak), `itemNameLookup(ELEM.LST)`.
- `topbar.ts` — `TopBar`, the item bar used when `inventory` is `"bar"`.
- `wheel.ts` — `WheelAccumulator`. A mouse wheel, which the original does not have. `PlayGame` sums the notches and scrolls the coat by one row, or the bar by one slot.

**Cursor:** the screen does not draw the cursor. After every frame the host sets the global `Cursor` (`src/cursor`) to `mode = screen.cursorMode` (4/0/5) and `idle = screen.cursorIdle`. In mode 5 the picture `"item"` is `inv.held.image`, drawn with `drawCursor` after `screen.draw()`. The Options button and the arrows are painted into the background at `open()` (`A_UP1/A_DN1/OPT1`; `INV_x` does not contain them).

Wired into the game: on entry `screen.open(g_jackUniform)`, `inv.marzeczy` is the variable MARZECZY. After `macro`, run the scene macro (HAVETOOL/NOHAVETOOL → `inv.add/remove`, NOHAVE → `inv.noHave()`, TAKE → `inv.take`). Scrolling moves in a straight line (8 frames × 52 px). The original's row scale at the edge is not reproduced. The shadow is the background × 0.5 (a hypothesis).
