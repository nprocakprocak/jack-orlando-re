import { describe, expect, it } from "vitest";
import { bindFocus, bindKeyboard, bindMouse, runLoop, type DocLike, type RectTarget } from "./dom";
import { DIK, Keyboard } from "./keyboard";
import { EngineLoop } from "./loop";
import { Mouse, MOUSE_LEFT, MOUSE_RIGHT } from "./mouse";

// Node has EventTarget/Event but no KeyboardEvent/PointerEvent: build look-alikes.
function keyEvent(type: string, code: string, key: string, repeat = false) {
  return Object.assign(new Event(type, { cancelable: true }), { code, key, repeat });
}
function pointerEvent(type: string, clientX: number, clientY: number, button = 0) {
  return Object.assign(new Event(type, { cancelable: true }), { clientX, clientY, button });
}

describe("bindKeyboard", () => {
  it("pushes DIK events with characters, ignores repeat and unknown keys", () => {
    const target = new EventTarget();
    const kb = new Keyboard();
    const unbind = bindKeyboard(target, kb);
    const e1 = keyEvent("keydown", "KeyA", "a");
    target.dispatchEvent(e1);
    target.dispatchEvent(keyEvent("keydown", "KeyA", "a", true));
    target.dispatchEvent(keyEvent("keydown", "LaunchMail", "LaunchMail"));
    target.dispatchEvent(keyEvent("keyup", "KeyA", "a"));
    expect(kb.buffer).toEqual([
      { dik: DIK.A, down: true, char: 0x61 },
      { dik: DIK.A, down: false, char: 0 },
    ]);
    expect(e1.defaultPrevented).toBe(true);
    unbind();
    target.dispatchEvent(keyEvent("keydown", "KeyB", "b"));
    expect(kb.buffer).toHaveLength(2);
  });

  it("leaves F11/F12 to the browser but still forwards them", () => {
    const target = new EventTarget();
    const kb = new Keyboard();
    bindKeyboard(target, kb);
    const e = keyEvent("keydown", "F12", "F12");
    target.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(kb.buffer[0].dik).toBe(DIK.F12);
  });
});

describe("bindMouse", () => {
  class FakeCanvas extends EventTarget implements RectTarget {
    rect = { left: 100, top: 20, width: 1280, height: 960 };
    getBoundingClientRect() {
      return this.rect;
    }
  }

  it("maps scaled pointer positions, adds scroll, tracks buttons", () => {
    const canvas = new FakeCanvas();
    const doc = new EventTarget();
    const mouse = new Mouse();
    mouse.setScroll(300, 0);
    const unbind = bindMouse(canvas, mouse, doc);
    canvas.dispatchEvent(pointerEvent("pointermove", 100 + 640, 20 + 480));
    expect([mouse.screenX, mouse.screenY, mouse.x, mouse.y]).toEqual([320, 240, 620, 240]);
    const down = pointerEvent("pointerdown", 100 + 20, 20 + 40, 2);
    canvas.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(mouse.buttons).toBe(MOUSE_RIGHT);
    expect([mouse.screenX, mouse.screenY]).toEqual([10, 20]);
    canvas.dispatchEvent(pointerEvent("pointerdown", 120, 60, 0));
    // release outside the canvas arrives on the document
    doc.dispatchEvent(pointerEvent("pointerup", 0, 0, 2));
    expect(mouse.buttons).toBe(MOUSE_LEFT);
    // the canvas resized (window resize): the mapping follows
    canvas.rect = { left: 0, top: 0, width: 640, height: 480 };
    canvas.dispatchEvent(pointerEvent("pointermove", 5, 6));
    expect([mouse.screenX, mouse.screenY]).toEqual([5, 6]);
    const menu = new Event("contextmenu", { cancelable: true });
    canvas.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    unbind();
    canvas.dispatchEvent(pointerEvent("pointermove", 50, 60));
    expect(mouse.screenX).toBe(5);
  });
});

describe("bindFocus", () => {
  class FakeDoc extends EventTarget implements DocLike {
    hidden = false;
  }

  it("pauses on blur / hidden, resumes when visible and focused", () => {
    const win = new EventTarget();
    const doc = new FakeDoc();
    const loop = new EngineLoop();
    const unbind = bindFocus(win, doc, loop);
    expect(loop.active).toBe(true);
    win.dispatchEvent(new Event("blur"));
    expect(loop.active).toBe(false);
    // becoming visible while unfocused does not resume
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(loop.active).toBe(false);
    win.dispatchEvent(new Event("focus"));
    expect(loop.active).toBe(true);
    doc.hidden = true;
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(loop.active).toBe(false);
    // focus while hidden does not resume either
    win.dispatchEvent(new Event("focus"));
    expect(loop.active).toBe(false);
    doc.hidden = false;
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(loop.active).toBe(true);
    win.dispatchEvent(new Event("blur"));
    unbind();
    win.dispatchEvent(new Event("focus"));
    expect(loop.active).toBe(false);
  });

  it("a page loaded in the background starts paused", () => {
    const doc = new FakeDoc();
    doc.hidden = true;
    const loop = new EngineLoop();
    bindFocus(new EventTarget(), doc, loop);
    expect(loop.active).toBe(false);
  });
});

describe("runLoop", () => {
  it("steps the loop on each scheduled frame and stops on cleanup", () => {
    const queue: ((t: number) => void)[] = [];
    let cancelled = -1;
    const scheduler = {
      request: (cb: (t: number) => void) => queue.push(cb),
      cancel: (id: number) => {
        cancelled = id;
      },
    };
    const loop = new EngineLoop();
    const stop = runLoop(loop, scheduler);
    for (const t of [0, 16, 32, 48]) queue.shift()!(t);
    expect(loop.frameCount).toBe(4);
    expect(loop.ticks).toBe(9);
    stop();
    expect(cancelled).toBe(queue.length);
    queue.shift()!(64);
    expect(loop.frameCount).toBe(4);
  });
});
