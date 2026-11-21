import { KEY_BUFFER_SIZE } from "./constants";

/**
 * Keyboard emulating the original DirectInput8 keyboard (Input_* –):
 * raw events go into a bounded buffer (DIPROP_BUFFERSIZE = 16) and are applied to the
 * key state only when poll() runs (Input_Poll every 40 ms, buffer read in
 *). Key codes are DirectInput scan codes (DIK_*).
 */

/** DirectInput key codes used by the game logic. */
export const DIK = {
  ESCAPE: 0x01,
  N1: 0x02,
  N2: 0x03,
  N3: 0x04,
  N4: 0x05,
  N5: 0x06,
  N6: 0x07,
  N7: 0x08,
  N8: 0x09,
  N9: 0x0a,
  N0: 0x0b,
  MINUS: 0x0c,
  EQUALS: 0x0d,
  BACK: 0x0e,
  TAB: 0x0f,
  Q: 0x10,
  W: 0x11,
  E: 0x12,
  R: 0x13,
  T: 0x14,
  Y: 0x15,
  U: 0x16,
  I: 0x17,
  O: 0x18,
  P: 0x19,
  LBRACKET: 0x1a,
  RBRACKET: 0x1b,
  RETURN: 0x1c,
  LCONTROL: 0x1d,
  A: 0x1e,
  S: 0x1f,
  D: 0x20,
  F: 0x21,
  G: 0x22,
  H: 0x23,
  J: 0x24,
  K: 0x25,
  L: 0x26,
  SEMICOLON: 0x27,
  APOSTROPHE: 0x28,
  GRAVE: 0x29,
  LSHIFT: 0x2a,
  BACKSLASH: 0x2b,
  Z: 0x2c,
  X: 0x2d,
  C: 0x2e,
  V: 0x2f,
  B: 0x30,
  N: 0x31,
  M: 0x32,
  COMMA: 0x33,
  PERIOD: 0x34,
  SLASH: 0x35,
  RSHIFT: 0x36,
  MULTIPLY: 0x37,
  LMENU: 0x38,
  SPACE: 0x39,
  CAPITAL: 0x3a,
  F1: 0x3b,
  F2: 0x3c,
  F3: 0x3d,
  F4: 0x3e,
  F5: 0x3f,
  F6: 0x40,
  F7: 0x41,
  F8: 0x42,
  F9: 0x43,
  F10: 0x44,
  NUMLOCK: 0x45,
  SCROLL: 0x46,
  NUMPAD7: 0x47,
  NUMPAD8: 0x48,
  NUMPAD9: 0x49,
  SUBTRACT: 0x4a,
  NUMPAD4: 0x4b,
  NUMPAD5: 0x4c,
  NUMPAD6: 0x4d,
  ADD: 0x4e,
  NUMPAD1: 0x4f,
  NUMPAD2: 0x50,
  NUMPAD3: 0x51,
  NUMPAD0: 0x52,
  DECIMAL: 0x53,
  OEM_102: 0x56,
  F11: 0x57,
  F12: 0x58,
  NUMPADENTER: 0x9c,
  RCONTROL: 0x9d,
  DIVIDE: 0xb5,
  SYSRQ: 0xb7,
  RMENU: 0xb8,
  PAUSE: 0xc5,
  HOME: 0xc7,
  UP: 0xc8,
  PRIOR: 0xc9,
  LEFT: 0xcb,
  RIGHT: 0xcd,
  END: 0xcf,
  DOWN: 0xd0,
  NEXT: 0xd1,
  INSERT: 0xd2,
  DELETE: 0xd3,
  LWIN: 0xdb,
  RWIN: 0xdc,
  APPS: 0xdd,
} as const;

/**
 * Pseudo key codes accepted by Input_IsKeyDown: either of the left/right pair.
 * Read from the g_keys offsets in the code: 0xfa = keys[0x38]|keys[0xb8] (Alt),
 * 0xfb = keys[0x2a]|keys[0x36] (Shift), 0xfc = keys[0x1d]|keys[0x9d] (Ctrl).
 */
export const DIK_ANY_ALT = 0xfa;
export const DIK_ANY_SHIFT = 0xfb;
export const DIK_ANY_CTRL = 0xfc;

/** KeyboardEvent.code -> DIK. Keys missing here are ignored (the game cannot see them). */
export const CODE_TO_DIK: Readonly<Record<string, number>> = {
  Escape: DIK.ESCAPE,
  Digit1: DIK.N1,
  Digit2: DIK.N2,
  Digit3: DIK.N3,
  Digit4: DIK.N4,
  Digit5: DIK.N5,
  Digit6: DIK.N6,
  Digit7: DIK.N7,
  Digit8: DIK.N8,
  Digit9: DIK.N9,
  Digit0: DIK.N0,
  Minus: DIK.MINUS,
  Equal: DIK.EQUALS,
  Backspace: DIK.BACK,
  Tab: DIK.TAB,
  KeyQ: DIK.Q,
  KeyW: DIK.W,
  KeyE: DIK.E,
  KeyR: DIK.R,
  KeyT: DIK.T,
  KeyY: DIK.Y,
  KeyU: DIK.U,
  KeyI: DIK.I,
  KeyO: DIK.O,
  KeyP: DIK.P,
  BracketLeft: DIK.LBRACKET,
  BracketRight: DIK.RBRACKET,
  Enter: DIK.RETURN,
  ControlLeft: DIK.LCONTROL,
  KeyA: DIK.A,
  KeyS: DIK.S,
  KeyD: DIK.D,
  KeyF: DIK.F,
  KeyG: DIK.G,
  KeyH: DIK.H,
  KeyJ: DIK.J,
  KeyK: DIK.K,
  KeyL: DIK.L,
  Semicolon: DIK.SEMICOLON,
  Quote: DIK.APOSTROPHE,
  Backquote: DIK.GRAVE,
  ShiftLeft: DIK.LSHIFT,
  Backslash: DIK.BACKSLASH,
  KeyZ: DIK.Z,
  KeyX: DIK.X,
  KeyC: DIK.C,
  KeyV: DIK.V,
  KeyB: DIK.B,
  KeyN: DIK.N,
  KeyM: DIK.M,
  Comma: DIK.COMMA,
  Period: DIK.PERIOD,
  Slash: DIK.SLASH,
  ShiftRight: DIK.RSHIFT,
  NumpadMultiply: DIK.MULTIPLY,
  AltLeft: DIK.LMENU,
  Space: DIK.SPACE,
  CapsLock: DIK.CAPITAL,
  F1: DIK.F1,
  F2: DIK.F2,
  F3: DIK.F3,
  F4: DIK.F4,
  F5: DIK.F5,
  F6: DIK.F6,
  F7: DIK.F7,
  F8: DIK.F8,
  F9: DIK.F9,
  F10: DIK.F10,
  F11: DIK.F11,
  F12: DIK.F12,
  NumLock: DIK.NUMLOCK,
  ScrollLock: DIK.SCROLL,
  Numpad7: DIK.NUMPAD7,
  Numpad8: DIK.NUMPAD8,
  Numpad9: DIK.NUMPAD9,
  NumpadSubtract: DIK.SUBTRACT,
  Numpad4: DIK.NUMPAD4,
  Numpad5: DIK.NUMPAD5,
  Numpad6: DIK.NUMPAD6,
  NumpadAdd: DIK.ADD,
  Numpad1: DIK.NUMPAD1,
  Numpad2: DIK.NUMPAD2,
  Numpad3: DIK.NUMPAD3,
  Numpad0: DIK.NUMPAD0,
  NumpadDecimal: DIK.DECIMAL,
  IntlBackslash: DIK.OEM_102,
  NumpadEnter: DIK.NUMPADENTER,
  ControlRight: DIK.RCONTROL,
  NumpadDivide: DIK.DIVIDE,
  PrintScreen: DIK.SYSRQ,
  AltRight: DIK.RMENU,
  Pause: DIK.PAUSE,
  Home: DIK.HOME,
  ArrowUp: DIK.UP,
  PageUp: DIK.PRIOR,
  ArrowLeft: DIK.LEFT,
  ArrowRight: DIK.RIGHT,
  End: DIK.END,
  ArrowDown: DIK.DOWN,
  PageDown: DIK.NEXT,
  Insert: DIK.INSERT,
  Delete: DIK.DELETE,
  MetaLeft: DIK.LWIN,
  MetaRight: DIK.RWIN,
  ContextMenu: DIK.APPS,
};

/** cp1250 bytes of Polish letters (ToAsciiEx on a Polish system returns these). */
const CP1250: Readonly<Record<string, number>> = {
  ą: 0xb9,
  ć: 0xe6,
  ę: 0xea,
  ł: 0xb3,
  ń: 0xf1,
  ó: 0xf3,
  ś: 0x9c,
  ź: 0x9f,
  ż: 0xbf,
  Ą: 0xa5,
  Ć: 0xc6,
  Ę: 0xca,
  Ł: 0xa3,
  Ń: 0xd1,
  Ó: 0xd3,
  Ś: 0x8c,
  Ź: 0x8f,
  Ż: 0xaf,
};

/**
 * Character code of a key press as would return it (ToAsciiEx: one character
 * in the system code page, otherwise 0). `key` is KeyboardEvent.key: the browser already
 * applied the layout, Shift, CapsLock and NumLock. Enter gives 0x0d; Backspace 0x08,
 * Tab 0x09 and Escape 0x1b are what ToAsciiEx returns for those keys.
 */
export function keyChar(key: string): number {
  if (key.length === 1) {
    const c = key.charCodeAt(0);
    if (c < 0x80) return c;
    return CP1250[key] ?? 0;
  }
  switch (key) {
    case "Enter":
      return 0x0d;
    case "Backspace":
      return 0x08;
    case "Tab":
      return 0x09;
    case "Escape":
      return 0x1b;
    default:
      return 0;
  }
}

/** One buffered keyboard event (DIDEVICEOBJECTDATA: dwOfs = DIK, dwData & 0x80 = down). */
export interface KeyEvent {
  dik: number;
  down: boolean;
  /** Character for Input_GetLastKey, see keyChar(); 0 = none. */
  char: number;
}

export class Keyboard {
  /** g_keys: 0x80 while the key is held, 0 otherwise (raw DirectInput dwData). */
  readonly keys = new Uint8Array(256);
  /** 0 = up, 2 = pressed and not yet consumed, 1 = consumed by keyPressedOnce. */
  readonly pressed = new Uint8Array(256);
  /** character of the last applied event, 0 after a key release. */
  lastKey = 0;
  /** Events not yet applied (DirectInput device buffer). */
  readonly buffer: KeyEvent[] = [];
  /** Events dropped because the buffer was full. */
  overflowCount = 0;
  /** Device acquired (== 0). While unacquired, events are ignored and poll() is a no-op. */
  acquired = true;

  constructor(readonly bufferSize = KEY_BUFFER_SIZE) {}

  /**
   * Queues a raw event. Auto-repeat must not be passed in: DirectInput buffered data has
   * none. When the buffer is full the event is lost [hypothesis: DirectInput keeps the
   * older data and reports DI_BUFFEROVERFLOW; the game ignores the flag].
   */
  push(ev: KeyEvent): void {
    if (!this.acquired) return;
    if (this.buffer.length >= this.bufferSize) {
      this.overflowCount++;
      return;
    }
    this.buffer.push(ev);
  }

  /** Applies all buffered events in order, as does. Returns the number applied. */
  poll(): number {
    if (!this.acquired) return 0;
    const events = this.buffer.splice(0);
    for (const ev of events) {
      const dik = ev.dik & 0xff;
      this.keys[dik] = ev.down ? 0x80 : 0;
      if (!ev.down) this.pressed[dik] = 0;
      else if (this.pressed[dik] === 0) this.pressed[dik] = 2;
      this.lastKey = ev.down ? ev.char & 0xff : 0;
    }
    return events.length;
  }

  /** Input_IsKeyDown, including the 0xfa/0xfb/0xfc pseudo codes. */
  isKeyDown(dik: number): boolean {
    const k = this.keys;
    switch (dik) {
      case DIK_ANY_ALT:
        return (k[DIK.LMENU] | k[DIK.RMENU]) !== 0;
      case DIK_ANY_SHIFT:
        return (k[DIK.LSHIFT] | k[DIK.RSHIFT]) !== 0;
      case DIK_ANY_CTRL:
        return (k[DIK.LCONTROL] | k[DIK.RCONTROL]) !== 0;
      default:
        return k[dik & 0xff] !== 0;
    }
  }

  /** Input_KeyPressedOnce: true once per press (state 2 -> 1). */
  keyPressedOnce(dik: number): boolean {
    const i = dik & 0xff;
    if (this.pressed[i] !== 2) return false;
    this.pressed[i] = 1;
    return this.isKeyDown(dik);
  }

  /**
   * Input_SetAcquired. Unacquire drops further input; acquire clears g_keys
   * (memset 0x100) but, like the original, not the pressed-once table.
   */
  setAcquired(acquired: boolean): void {
    if (acquired) this.keys.fill(0);
    else this.buffer.length = 0;
    this.acquired = acquired;
  }
}
