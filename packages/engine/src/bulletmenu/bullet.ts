// The bullet menu state machine (Game_Run steps 12-13, BulletMenu_Close). No DOM and no cursor object:
// the game gives it the inputs of the frame and applies the returned events.
import { bulletPosition, ICONS, inRect, verbMenuPosition, type Icon, type IconId } from "./geometry";

export interface BulletFrameInput {
  /** g_mouseX/Y in world coordinates (scroll included), g_scrollX. */
  mouseX: number;
  mouseY: number;
  scrollX: number;
  /** Click point g_clickX/Y (in mode 0: mouse - (9, 12), see cursor hotspotOffset). */
  clickX: number;
  clickY: number;
  leftDown: boolean;
  rightDown: boolean;
  /** Input_KeyPressedOnce(Esc) this frame. */
  esc: boolean;
  /** g_cursorMode: 5 = item in hand (the right button opens the coat instead). */
  cursorMode: number;
  /** g_varValues[GUN] == 1. */
  gun: boolean;
  /** BulletOnOff (config.showBullet != 0): true = bullet, false = verb window. */
  showBullet: boolean;
  /** Any: talking face shown, g_exitToDos, g_sceneNoControl. */
  blocked: boolean;
  /** g_cursorEnabled. */
  cursorEnabled: boolean;
  /** g_language for the verb window width ('P', 'E', 'D'). */
  language?: string;
}

export type BulletEvent =
  /** The bullet appeared at world (x, y); the cursor switches to mode 0 (Cursor_EnableDraw). */
  | { type: "open"; x: number; y: number }
  /** BulletMenu_Close: sprites hidden, mode stays as it is. */
  | { type: "close" }
  /** An icon was chosen: g_cursorMode = g_verbMode = mode, verb name set, hovered object name cleared. */
  | { type: "select"; mode: number; icon: IconId }
  /** BulletOnOff = 0: cursor mode 0, then the modal verb window (VerbMenu) at this screen position. */
  | { type: "verbMenu"; x: number; y: number };

export class BulletMenu {
  /** g_cursorZoneSuspended: the bullet is open. */
  open = false;
  /** g_popupX/Y: world position of the bullet. */
  x = 0;
  y = 0;
  /**
 * g_rightReleased: set when the right button is up and never cleared (a bug of the original):
 * after the first release the menu opens also while the button is held.
 */
  rightReleased = false;
  /** prev[i] of step 13: icon i was pressed last frame. Survives Esc (original quirk). */
  readonly prev: Record<IconId, boolean> = { look: false, pointer: false, take: false, hit: false, gun: false };
  /** local_11 of step 13: this frame's left click must not reach the scene (the bullet is open). */
  blockLeft = false;

  /** Icons whose highlight is drawn now (pressed, bullet open). */
  highlights(): IconId[] {
    return this.open ? ICONS.filter((i) => this.prev[i.id]).map((i) => i.id) : [];
  }

  /** BulletMenu_Close: hides the bullet; `prev` is kept. Also for macros that lock the player, RUNFILM, TAKE, edge clicks. */
  close(): BulletEvent[] {
    if (!this.open) return [];
    this.open = false;
    return [{ type: "close" }];
  }

  /** One game frame: Esc, right button (step 12), then the icons (step 13). */
  frame(inp: BulletFrameInput): BulletEvent[] {
    const events: BulletEvent[] = [];
    if (inp.esc) events.push(...this.close());
    if (!inp.rightDown) {
      this.rightReleased = true;
    } else if (!this.open && inp.cursorMode !== 5 && this.rightReleased && !inp.blocked && inp.cursorEnabled) {
      if (inp.showBullet) {
        this.open = true;
        const p = bulletPosition(inp.mouseX, inp.mouseY, inp.scrollX);
        this.x = p.x;
        this.y = p.y;
        events.push({ type: "open", x: p.x, y: p.y });
      } else {
        const p = verbMenuPosition(inp.mouseX, inp.mouseY, inp.scrollX, inp.gun, inp.language);
        events.push({ type: "verbMenu", x: p.x, y: p.y });
      }
    }
    this.blockLeft = this.open;
    if (this.open) this.icons(inp, events);
    return events;
  }

  private icons(inp: BulletFrameInput, events: BulletEvent[]): void {
    for (const icon of ICONS) {
      const over = this.over(icon, inp);
      const pressed = inp.leftDown && over && (!icon.needsGun || inp.gun);
      if (pressed === this.prev[icon.id]) continue;
      if (!pressed && over) {
        // Released over the icon: chosen. The original has no early exit, so overlapping pointer/gun
        // rectangles can pick both in one frame; the last wins.
        this.open = false;
        events.push({ type: "close" }, { type: "select", mode: icon.mode, icon: icon.id });
      }
      this.prev[icon.id] = pressed;
    }
  }

  private over(icon: Icon, inp: BulletFrameInput): boolean {
    return inRect(inp.clickX, inp.clickY, this.x + icon.x, this.y + icon.y, icon.w, icon.h);
  }
}
