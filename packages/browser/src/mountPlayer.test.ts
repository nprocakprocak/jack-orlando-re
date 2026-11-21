import type { GameFiles } from "jack-orlando-re/play";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountPlayer } from "jack-orlando-browser";

const files: GameFiles = {
  async read() {
    throw new Error("missing");
  },
  async exists() {
    return false;
  },
};

function stubCanvas2d(canvas: HTMLCanvasElement): void {
  const ctx = {
    createImageData(w: number, h: number) {
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    },
    putImageData() {},
  };
  vi.spyOn(canvas, "getContext").mockImplementation((type) =>
    type === "2d" ? (ctx as unknown as CanvasRenderingContext2D) : null,
  );
}

describe("mountPlayer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports a failed start load, then stop drops canvas listeners", async () => {
    const canvas = document.createElement("canvas");
    document.body.append(canvas);
    stubCanvas2d(canvas);

    const rectSpy = vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 640,
      height: 480,
      top: 0,
      left: 0,
      right: 640,
      bottom: 480,
      toJSON: () => ({}),
    });

    const statuses: string[] = [];
    const handle = mountPlayer({
      canvas,
      files,
      audio: false,
      onStatus: (text) => statuses.push(text),
    });

    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 120, clientY: 80, bubbles: true }),
    );
    expect(rectSpy).toHaveBeenCalled();

    await vi.waitFor(() => {
      expect(statuses.some((s) => s.length > 0)).toBe(true);
    });

    rectSpy.mockClear();
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 200, clientY: 100, bubbles: true }),
    );
    expect(rectSpy).toHaveBeenCalled();

    await handle.stop();

    rectSpy.mockClear();
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 300, clientY: 120, bubbles: true }),
    );
    expect(rectSpy).not.toHaveBeenCalled();

    canvas.remove();
  });
});