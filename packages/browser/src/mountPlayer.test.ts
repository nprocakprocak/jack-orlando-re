import type { GameFiles } from "jack-orlando-re/play";
import { afterEach, describe, expect, it, vi } from "vitest";
import { httpGameFiles, mountPlayer } from "jack-orlando-browser";

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

  it("stop a second time resolves", async () => {
    const canvas = document.createElement("canvas");
    document.body.append(canvas);
    stubCanvas2d(canvas);
    const handle = mountPlayer({ canvas, files, audio: false });
    await handle.stop();
    await expect(handle.stop()).resolves.toBeUndefined();
    canvas.remove();
  });
});

describe("httpGameFiles", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function reply(status: number, type: string, body: BodyInit = ""): Response {
    return new Response(body, { status, headers: { "content-type": type } });
  }

  it("reads bytes, treats an html body as missing, and checks existence with HEAD", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/missing.bin")) return reply(404, "text/plain");
      if (url.endsWith("/page.bin")) return reply(200, "text/html; charset=utf-8", "<p>no</p>");
      if (url.endsWith("/item.bin") && method === "HEAD") return reply(200, "application/octet-stream");
      if (url.endsWith("/item.bin")) return reply(200, "application/octet-stream", new Uint8Array([7, 8]));
      return reply(500, "text/plain");
    });

    const files = httpGameFiles("http://files/");
    await expect(files.read("missing.bin")).rejects.toThrow(/HTTP 404/);
    await expect(files.read("page.bin")).rejects.toThrow(/HTTP 200/);
    expect(await files.read("item.bin")).toEqual(new Uint8Array([7, 8]));
    expect(await files.exists("item.bin")).toBe(true);
    expect(await files.exists("page.bin")).toBe(false);
    expect(await files.exists("missing.bin")).toBe(false);
    const heads = fetchMock.mock.calls.filter((c) => c[1]?.method === "HEAD").map((c) => String(c[0]));
    expect(heads).toEqual([
      "http://files/item.bin",
      "http://files/page.bin",
      "http://files/missing.bin",
    ]);
  });
});