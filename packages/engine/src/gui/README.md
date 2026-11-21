# GUI: windows, the game menu, settings

A standalone module: windows, the in-game menu, and settings. It is not wired in by itself. `PlayGame` opens it for F4/F10, the working options, and "quit the game". The save-slot windows and the start screen use the same pieces.

| File | Contents |
|---|---|
| `darken.ts` | darkening tables (a formula, or the exact tables, `bundledDarkenTables`), `darkenPixel`, `darkenRect` |
| `draw.ts` | the window frame and button frames, outlined text with a shadow, `centerOffset` |
| `window.ts` | `GuiWindow`: a snapshot of the scene plus a frame, labels, buttons, sliders, Yes/No switches. Mouse and keyboard events become `GuiEvent` (the equivalent of `Gui_RunWindow`) |
| `credits.ts` | `CreditsScroller` — the about screen (`TEKST.COD`), a port of `Credits_DrawLine` / `Credits_ScrollTick` |
| `menu.ts` | `GuiMenu`: a stack of windows, 5 screens, `MenuAction`; window constructors `build*` |
| `texts.ts` | menu captions (`TEXTS_PL`, `TEXTS_EN`) |
| `assets.ts` | `loadMenuAssets(Resource.pak)`: `JACK.FNT` / `JACKM.FNT`, `RAMA/SUWAK/JACBM/COPBM.BM`, `TEKST.COD`; installs the exact darkening tables |

## Use

```ts
const assets = loadMenuAssets(resourcePak);
const store = new ConfigStore();             // settings/
const config = store.load();                 // the same object the game reads (walkSpeed, showText, ...)
const menu = new GuiMenu({ assets, texts: TEXTS_PL, config, scene, persist: (c) => store.save(c),
                           onAction: (a) => { /* resume, newGame, load, save, quit, setting, preview */ } });
menu.open();            // F4;  menu.open("quit") for F10
// each frame: menu.tick(msSinceLast); copy the scene → menu.draw(frame)
// events: menu.pointerDown/Move/Up(x, y) in 640×480 screen pixels, menu.keyDown/keyUp(e.key)
```

- `scene` is the 640×480 view **at the moment the menu opens** (the scene in the game is standing, logic frozen). The window snapshots it, darkens it, and draws the frame. A window opened over another one covers it. On a scrolled scene pass the screen view (not the 1024×480 buffer) — the window is then in screen coordinates.
- Actions: `resume`, `newGame` (they close the menu), `load`/`save` (the menu stays; after a game is loaded call `close()`), `quit` (after Yes; the original ends the process), `setting` (the `config` field is already changed), `preview` (a volume slider: live music, `SFX.S16`/`TALK.S16` samples for effects/speech), `settingsSaved` (leaving the options window).
- The music-slider effect (below 5 it stops, above 5 it resumes): the pure function `musicVolumeEffect(value, playing, muted)`.
- Escape: the main menu returns to the game; options return to the main menu and save; the about screen closes the whole menu (a quirk of the original, confirmed in the game); a Yes/No window answers No. Enter is button 1 (back to the game / Ok / Yes). Everything acts on release (Enter after `keyUp`, a button after it is released over itself).

## Differences from the original

- **Options are remembered** (`settings/store.ts`, `localStorage`, key `jack-orlando.config`, saved when leaving the options window, as in the original). The original writes them to HKLM with `KEY_ALL_ACCESS`, which fails silently on a normal account. Without `localStorage` (private mode) the defaults are used.
- **Pseudo surround and swapped stereo work from the start** (the original applies them only after they are toggled in the session): `settings/stereo.ts` gives the matrix `stereoMatrix(surround, reverse)`, a reference `copyStereo`, and a Web Audio graph `StereoOptions` (splitter → 4 × Gain → merger) to place in front of the music output.
- Darkening tables: the exact ones (`loadMenuAssets`). `formulaTables` is an approximation (18 of 4224 entries differ by 1). Tests that want the formula call `setDarkenTables(formulaTables())`.
- Each frame pixel is darkened once (at the corners of the rings the decompilation does not decide whether the original darkens twice — a difference of 1–2 pixels).
- There is no slot window, no text field, no window hotkeys (`Gui_SetHotkeys`), and no launcher in this module.

## Tests

`gui.test.ts` (darkening, frames, text, the window, sliders, switches), `menu.test.ts` (navigation, actions, options, Escape, the about screen, Yes/No, scrolling), `../settings/settings.test.ts`.
