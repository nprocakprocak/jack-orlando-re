// Loads what the start screen needs: the menu assets (fonts from Resource.pak, darkening tables) and the picture
// under the window: SETUP_OK.BM from Resource.pak (640 x 480 RGB565).
// [engine; user decision 2026-11-07] The original has no start screen; the picture is an unused asset.
import { decodeBm } from "../formats/bm";
import { Pak } from "../formats/pak";
import { loadMenuAssets } from "../gui/assets";
import type { MenuAssets } from "../gui/menu";
import { blitCopy, createSurface, type Surface16 } from "../render/surface";
import { SCREEN_H, SCREEN_W } from "../gui/window";

export const BACKGROUND_FILE = "SETUP_OK.BM";

export interface StartAssets {
  menu: MenuAssets;
  background: Surface16;
}

/**
 * The start screen picture drawn onto a black 640 x 480 surface, so transparent pixels (color 0) show black.
 * A missing or undecodable file gives just the black screen.
 */
export function setupBackground(resource: Pak): Surface16 {
  const out = createSurface(SCREEN_W, SCREEN_H);
  const entry = resource.entries.find((e) => e.name.toUpperCase() === BACKGROUND_FILE);
  if (!entry) return out;
  try {
    const bm = decodeBm(resource.read(entry.name));
    blitCopy(bm, 0, 0, Math.min(SCREEN_W, bm.width), Math.min(SCREEN_H, bm.height), out, 0, 0);
  } catch {
    out.pixels.fill(0);
  }
  return out;
}

export async function loadStartAssets(read: (rel: string) => Promise<Uint8Array>): Promise<StartAssets> {
  const pak = new Pak(await read("Resource/Resource.pak"));
  return { menu: loadMenuAssets(pak), background: setupBackground(pak) };
}
