import { describe, expect, it, vi } from "vitest";
import { holdSlotKey } from "./slot-key";

function press(editingSlot: number, host: () => void): void {
  const stop = (ev: Event): void => holdSlotKey(editingSlot, ev);
  window.addEventListener("keydown", host);
  window.addEventListener("keydown", stop, true);
  document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyF", key: "f", bubbles: true }));
  window.removeEventListener("keydown", host);
  window.removeEventListener("keydown", stop, true);
}

describe("holdSlotKey", () => {
  it("keeps a key from a window listener while a slot description is open", () => {
    const host = vi.fn();
    press(0, host);
    expect(host).not.toHaveBeenCalled();
  });

  it("lets the key through when no description is open", () => {
    const host = vi.fn();
    press(-1, host);
    expect(host).toHaveBeenCalledTimes(1);
  });
});
