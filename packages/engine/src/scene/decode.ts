// Pictures from a scene archive, and the frames drawn for Jack.

import { brightenPbm, jackBrightness, type FrameSprite } from "../anim";
import { decodeBm, PALETTE_SIZE, type Image16 } from "../formats/bm";
import { decodePbm } from "../formats/pbm";
import type { ScenePlayerState } from "./player-state";

/**
 * Image of a scene archive file. The game never looks at the extension: the format comes from the
 * CCG object type or from the loader that names the file. Here that is told from the content: a `.BM`-style file has
 * exactly `4 + 2*w*h` (16-bit) or `4 + 256 + w*h` (8-bit palette) bytes, anything else is a PBM (`DL0.011`, `DRZWI.114`, `GAZ.000`).
 */
export function decodeSceneImage(data: Uint8Array, file: string, pbm = false): Image16 {
  // `pbm`: the CCG object type says PBM (8 / -8); an all-literal PBM has the size of an 8-bit BM, so the size alone cannot tell them apart
  if (pbm || file.toUpperCase().endsWith(".PBM")) return decodePbm(data, file);
  if (data.length >= 4) {
    const n = (data[0] | (data[1] << 8)) * (data[2] | (data[3] << 8));
    if (data.length === 4 + 2 * n || data.length === 4 + PALETTE_SIZE + n) return decodeBm(data);
  }
  return decodePbm(data, file);
}

/** An empty sprite image: the shadow sprites exist from the start (Sprite_Add at scene start) and get their image when drawn. */
export const BLANK: Image16 = { width: 1, height: 1, kind: "rgb565", pixels: new Uint16Array(1) };

export function image(this: ScenePlayerState, source: FrameSprite["source"] | "phk", file: string, pbm = false): Image16 {
    const key = `${source}:${file}`;
    let img = this.cache.get(key);
    if (!img) {
      const pak =
        source === "resource" ? this.src.resource : source === "scene" ? this.src.ph2 : source === "global" ? this.src.global : this.src.phk;
      if (!pak) throw new Error(`${this.src.name}: no archive for ${key}`);
      const data = pak.read(file);
      img = decodeSceneImage(data, file, pbm);
      this.cache.set(key, img);
    }
    return img;
}

/**
 * Jack's frame under the scene lights (Game_Run walk, insertion, Jack_Stand): the palette
 * is scaled when the brightness is < 1, like the persons' frames.
 */
export function jackImage(this: ScenePlayerState, source: FrameSprite["source"], file: string): Image16 {
    const pose = this.pose();
    const lit = jackBrightness(pose.x, pose.y, this.scene.ccg.lights, pose.scale, this.brightness);
    // outside every light's range Jack_Stand leaves g_jackBrightness as it was
    const inRange = lit > this.brightness;
    if (this.jack.mode !== "stand" || inRange) this.jackLight = lit;
    if (this.jackLight >= 1 || !file.toUpperCase().endsWith(".PBM")) return this.image(source, file);
    const pak = source === "resource" ? this.src.resource : source === "scene" ? this.src.ph2 : source === "global" ? this.src.global : this.src.phk;
    if (!pak) throw new Error(`${this.src.name}: no archive for ${source}:${file}`);
    return decodePbm(brightenPbm(pak.read(file), this.jackLight), file);
}
