// The picture view() returns, and the overlays drawn on it.

import { frameOverlay, type CursorDraw } from "../cursor";
import { composeFace, DialogController, encodeMazovia, FACE_WINDOW, FACE_WINDOW_Y, faceWindowX, rowStyle, type Side } from "../dialog";
import type { Image16 } from "../formats/bm";
import { renderText } from "../formats/fnt";
import { decodePbm } from "../formats/pbm";
import { faceWindowPixels } from "./facewin";
import type { Overlay } from "./overlay";
import type { Surface16 } from "../render";
import { blitCopy, createSurface } from "../render/surface";
import { highlightImageName, ICONS, bulletImageName } from "../bulletmenu";
import { ScenePlayer } from "../scene";
import { captionLineX } from "./predicates";
import type { PlayView } from "./types";
import type { GameState } from "./game-state";
import { deathSequence } from "./game-film";
import { heldImage } from "./game-inventory";
import { scenePak } from "./game-scene";

/** The strip of the quick save over the scene (screen coordinates). */
export function noticeOverlay(this: GameState, sc: ScenePlayer): Overlay[] {
    const pic = this.notice.picture(sc.renderer.framebuffer, sc.scrollX);
    return pic ? [{ x: this.notice.x(sc.scrollX) - sc.scrollX, y: this.notice.y, image: pic }] : [];
  }

/** The bar's pictures (legacy bar only) and RAMKA (the frame around the item in hand, with or without the bar) over the scene. */
export function barOverlays(this: GameState, sc: ScenePlayer): Overlay[] {
    const bar = this.bar;
    const out: Overlay[] = bar ? bar.overlays(sc.renderer.framebuffer, sc.scrollX) : [];
    // Game_Run: RAMKA only when g_cursorIdle == 0, with no bar, answer menu, caption or bullet menu (modes 5 and up)
    const d = this.dialog;
    const f = frameOverlay(this.frameImage, {
      idle: this.cursor.frameIdle,
      mode: this.cursor.mode,
      barOpen: !!bar?.isOpen,
      menuOpen: !!d?.menu,
      captionShown: !!(d?.caption && !this.captionHidden),
      bulletOpen: this.bullet.open,
    }, this.lastInput.x, this.lastInput.y);
    if (f) out.push(f);
    return out;
  }

export function view(this: GameState): PlayView | null {
    const still = (surface: Surface16): PlayView => ({ surface, scrollX: 0, cursor: null, cursorImage: null, lensMasks: this.cursorImages, overlays: [] });
    if (this.phase === "fading" && this.transition) return still(this.transition.current);
    if (this.phase === "movie" && this.movie) return still(this.movie.surface);
    if (this.phase === "finished" && this.endSurface) return still(this.endSurface);
    const sc = this.scene;
    if (!sc) return null;
    if (this.verbWindow && this.verbScene) {
      const screen = (this.verbScreen ??= createSurface(640, 480));
      blitCopy(this.verbScene, 0, 0, 640, 480, screen, 0, 0);
      this.verbWindow.draw(screen);
      return screenView.call(this, screen);
    }
    if (this.miniMap?.isOpen) {
      // the cursor sprite is removed while the map is open (g_renderIdle = 0)
      const screen = (this.miniScreen ??= createSurface(640, 480));
      this.miniMap.draw(screen);
      return { surface: screen, scrollX: 0, cursor: null, cursorImage: null, lensMasks: this.cursorImages, overlays: [] };
    }
    if (this.coat?.isOpen) {
      const screen = (this.coatScreen ??= createSurface(640, 480));
      this.coat.draw(screen);
      return screenView.call(this, screen);
    }
    if (this.slotUi) {
      const ui = this.slotUi;
      blitCopy(ui.scene, 0, 0, 640, 480, ui.screen, 0, 0);
      ui.win.draw(ui.screen);
      return screenView.call(this, ui.screen);
    }
    if (this.menu?.isOpen && this.menuScene) {
      const screen = (this.menuScreen ??= createSurface(640, 480));
      blitCopy(this.menuScene, 0, 0, 640, 480, screen, 0, 0);
      this.menu.draw(screen);
      // the menu pointer is the animated "Wsk" cursor (cursor mode 0, Cursor_DrawOnPresent with = 1)
      const draw = this.cursor.present(this.lastInput.x, this.lastInput.y);
      return { surface: screen, scrollX: 0, cursor: draw, cursorImage: draw ? (this.cursorImages.get(draw.image) ?? null) : null, lensMasks: this.cursorImages, overlays: [] };
    }
    if (this.phase === "film" && this.film) {
      const w = this.film.run.windowAt(this.film.clockMs);
      const overlay: Overlay = { x: w.x - sc.scrollX, y: w.y, image: { width: w.width, height: w.height, pixels: w.pixels } };
      return { surface: sc.renderer.framebuffer, scrollX: sc.scrollX, cursor: null, cursorImage: null, lensMasks: this.cursorImages, overlays: [overlay] };
    }
    let draw: CursorDraw | null = null;
    // the answer menu shows the cursor (Cursor_EnableDraw, Script_ExecStep case 0xb) although the DIALOG macro runs
    const locked = (!!this.interpreter?.playerLocked() && !this.dialog?.menu) || deathSequence.call(this);
    const hidden = !this.interpreter || locked || this.phase !== "playing";
    if (!hidden) draw = this.cursor.present(this.lastInput.x + sc.scrollX, this.lastInput.y);
    return {
      surface: sc.renderer.framebuffer,
      scrollX: sc.scrollX,
      cursor: draw,
      cursorImage: cursorImageOf.call(this, draw),
      lensMasks: this.cursorImages,
      overlays: this.phase === "playing" ? [...overlays.call(this, sc), ...bulletOverlays.call(this, sc), ...noticeOverlay.call(this, sc), ...this.barOverlays(sc)] : [],
    };
  }

export function cursorImageOf(this: GameState, draw: CursorDraw | null): Image16 | null {
    if (!draw) return null;
    return draw.image === "item" ? heldImage.call(this) : (this.cursorImages.get(draw.image) ?? null);
  }

/** A whole-screen view (menu, verb window, coat) with the cursor of the current mode over it. */
export function screenView(this: GameState, screen: Surface16): PlayView {
    const draw = this.cursor.present(this.lastInput.x, this.lastInput.y);
    return { surface: screen, scrollX: 0, cursor: draw, cursorImage: cursorImageOf.call(this, draw), lensMasks: this.cursorImages, overlays: [] };
  }

/** The opened bullet and the pressed icon highlights (sprites 950..955). */
export function bulletOverlays(this: GameState, sc: ScenePlayer): Overlay[] {
    const b = this.bullet;
    if (!b.open) return [];
    const gun = this.vars.get("GUN") === 1;
    const out: Overlay[] = [];
    const base = this.bulletImages.get(bulletImageName(gun));
    if (!base) return out;
    const x = b.x - sc.scrollX;
    out.push({ x, y: b.y, image: base });
    const lit = new Set(b.highlights());
    for (const icon of ICONS) {
      const img = lit.has(icon.id) ? this.bulletImages.get(highlightImageName(icon, gun)) : undefined;
      if (img) out.push({ x: x + icon.x, y: b.y + icon.y, image: img });
    }
    return out;
  }

/**
 * Face windows (Face_Show), the caption of the line and the answer menu rows, over the scene. The frame
 * and background of a window (a shaded bevel) are approximated by a flat dark fill with a light
 * two-pixel border.
 */
export function overlays(this: GameState, sc: ScenePlayer): Overlay[] {
    const d = this.dialog;
    const a = this.dialogAssets;
    if (!d || !a) return [];
    const out: Overlay[] = [];
    for (const side of ["L", "R"] as Side[]) {
      const v = d.faceView(side);
      if (v) out.push({ x: faceWindowX(side, 0), y: FACE_WINDOW_Y, image: faceWindow.call(this, side, v, sc) });
    }
    const k = this.captionHidden ? null : d.caption;
    if (k) for (const l of k.lines) out.push({ x: captionLineX(l.x, this.captionScroll), y: l.y, image: text.call(this, l.text, k.outline, k.fill) });
    const menu = d.menu;
    if (menu) {
      menu.rows.forEach((r, i) => {
        const st = rowStyle(i === menu.pressed, a.tables.menuFill);
        const x = r.x - sc.scrollX;
        if (st.shadow) out.push({ x: x + 1, y: r.y + 1, image: text.call(this, r.text, 0, 0x2104) });
        out.push({ x: x + st.dx, y: r.y + st.dy, image: text.call(this, r.text, d.textColors[0], st.fill) });
      });
    }
    return out;
  }

export function text(this: GameState, text: string, outline: number, fill: number): Image16 {
    const key = `${outline}:${fill}:${text}`;
    let img = this.textCache.get(key);
    if (!img) {
      if (this.textCache.size > 400) this.textCache.clear();
      const t = renderText(this.dialogAssets!.font, encodeMazovia(text), outline, fill);
      img = { width: t.width, height: t.height, kind: "rgb565", pixels: t.pixels };
      this.textCache.set(key, img);
    }
    return img;
  }

export function faceImage(this: GameState, source: "resource" | "scene", file: string, sc: ScenePlayer): Image16 {
    const key = `${source}:${file}`;
    let img = this.faceImages.get(key);
    if (!img) {
      const pak = source === "resource" ? this.resource : scenePak.call(this, sc);
      img = decodePbm(pak.read(file), file);
      this.faceImages.set(key, img);
    }
    return img;
  }

/**
 * The window of a face: the scene behind it is copied when the face is (re)drawn, darkened by the colour tables
 * with a bevel of two rings (Talk_FaceStep `Render_ComposeRegion` + + the portrait), so
 * the picture shows through. Redrawn only when the face state changes.
 */
export function faceWindow(this: GameState, side: Side, v: NonNullable<ReturnType<DialogController["faceView"]>>, sc: ScenePlayer): Surface16 {
    const key = `${v.slot}:${v.source}:${v.mirrored}:${v.mouth}:${v.eyes.join(",")}`;
    const memo = this.faceWindows[side];
    if (memo && memo.key === key) return memo.window;
    const face = composeFace(v, (file) => faceImage.call(this, v.source, file, sc));
    const px = faceWindowPixels(sc.renderer.framebuffer, faceWindowX(side, sc.scrollX), FACE_WINDOW_Y, face.pixels, this.dialogAssets!.remap);
    const window: Surface16 = { width: FACE_WINDOW, height: FACE_WINDOW, pixels: px };
    this.faceWindows[side] = { key, window };
    return window;
  }
