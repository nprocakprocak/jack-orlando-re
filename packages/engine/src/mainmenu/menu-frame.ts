import { blitKeyed, type Surface16 } from "../render/surface";
import { SMOKE_X, SMOKE_Y } from "./smoke";
import { LOADING_X, LOADING_Y, TRUCK_X, TRUCK_Y } from "./menu";
import type { MenuFields } from "./menu-state";

  // --- picture ---

export function cursorImage(this: MenuFields): Surface16 | null {
    if (!this.mouseInside || !this.hook) return null;
    return this.discImage ? this.assets.discs[this.discFrame] : this.assets.arrows[this.arrowFrame];
  }

  /** Composes the current picture into `screen` and returns it. */
export function frame(this: MenuFields): Surface16 {
    const s = this.screen;
    switch (this.phase) {
      case "blackout":
      case "wipe":
      case "musicIn":
      case "reveal":
      case "quitting":
      case "done":
        s.pixels.set(this.still.pixels);
        return s;
      case "loading": {
        s.pixels.set(this.still.pixels);
        // [engine, user decision] the disc cursor over "Loading" (the original removed the cursor sprite)
        const d = this.assets.discs[this.discFrame];
        if (this.mouseInside) blitKeyed(d, 0, 0, d.width, d.height, s, this.mouseX, this.mouseY);
        return s;
      }
    }
    const a = this.assets;
    s.pixels.set(a.background.pixels);
    // z order: LADEN 18, window 1050 and its buttons, truck 1750, smoke 1800, cursor 1950
    if (this.loadingSprite) blitKeyed(a.loading, 0, 0, a.loading.width, a.loading.height, s, LOADING_X, LOADING_Y);
    if (this.window) {
      this.window.drawBody(s);
      if (this.buttonsShown) this.window.drawButtons(s, this.pressedButton);
    }
    if (this.hook && this.truckShifted) blitKeyed(a.truck, 0, 0, a.truck.width, a.truck.height, s, TRUCK_X, TRUCK_Y);
    if (this.smokeShown) {
      const f = this.smoke.surface;
      blitKeyed(f, 0, 0, f.width, f.height, s, SMOKE_X, SMOKE_Y);
    }
    const c = this.cursorImage();
    if (c) blitKeyed(c, 0, 0, c.width, c.height, s, this.mouseX, this.mouseY);
    return s;
  }
