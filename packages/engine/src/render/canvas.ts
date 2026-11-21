// DOM side of the renderer: shows the screen window of the work buffer on a canvas.
import { presentRgba, SCREEN_H, SCREEN_W } from "./present";
import type { Surface16 } from "./surface";

export class CanvasPresenter {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly image: ImageData;

  constructor(readonly canvas: HTMLCanvasElement) {
    canvas.width = SCREEN_W;
    canvas.height = SCREEN_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    this.ctx = ctx;
    this.image = ctx.createImageData(SCREEN_W, SCREEN_H);
  }

  present(framebuffer: Surface16, scrollX: number, scrollY = 0): void {
    presentRgba(framebuffer, scrollX, scrollY, this.image.data);
    this.ctx.putImageData(this.image, 0, 0);
  }
}
