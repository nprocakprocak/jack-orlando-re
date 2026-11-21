// Pointer and keys of the open main menu.

import type { MenuFields } from "./menu-state";
import { BUTTON_NAMES } from "./window";

export function pointerDown(this: MenuFields, x: number, y: number): void {
  this.pointerMove(x, y);
  if (this.phase !== "menu" || this.enterHeld) return;
  const i = this.window!.hit(this.mouseX, this.mouseY);
  if (i < 0) return;
  this.pressed = i;
  this.pressedOver = true;
}

/** Released over the pressed button -> its name; elsewhere the press is cancelled. */
export function pointerUp(this: MenuFields, x: number, y: number): void {
  this.pointerMove(x, y);
  if (this.phase !== "menu" || this.pressed < 0 || this.enterHeld) return;
  const i = this.pressed;
  this.pressed = -1;
  this.pressedOver = false;
  if (this.window!.hit(this.mouseX, this.mouseY) === i) this.choose(BUTTON_NAMES[i]);
}

/** Enter = button 1 ("Introduction"), sunken until released; Esc = "/0" -> quit. KeyboardEvent.key names. */
export function keyDown(this: MenuFields, key: string): void {
  if (this.phase !== "menu") return;
  if (key === "Escape") this.choose(null);
  else if (key === "Enter" && !this.enterHeld) {
    this.enterHeld = true;
    this.pressed = 0;
    this.pressedOver = true;
  }
}

export function keyUp(this: MenuFields, key: string): void {
  if (this.phase !== "menu" || key !== "Enter" || !this.enterHeld) return;
  this.choose(BUTTON_NAMES[0]);
}
