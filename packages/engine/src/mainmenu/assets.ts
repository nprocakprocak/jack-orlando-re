// Loads the main menu's pictures from MENU.PAK (Menu_OpenPak) and JACK.FNT from Resource.pak.
import { decodeBm } from "../formats/bm";
import { parseFnt } from "../formats/fnt";
import { Pak } from "../formats/pak";
import type { Surface16 } from "../render/surface";
import type { MainMenuAssets } from "./menu";

const numbered = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(2, "0")}.BM`);

/** Everything Menu_OpenPak loads, in its order (the logos and COPYR.BM of MENU.PAK are not loaded here). */
export const MENU_PAK_FILES = [
  "JACK2.BM", "_SAMOCH1.BM", "D1.FLX", ...numbered("WSK", 9), ...numbered("CD", 40), "LADEN.BM",
] as const;

function bm(pak: Pak, name: string): Surface16 {
  const img = decodeBm(pak.read(name));
  return { width: img.width, height: img.height, pixels: img.pixels };
}

/** Pictures from `menu.PAK`. The label font is `JACK.FNT` in Resource.pak. */
export function loadMainMenuAssets(menuPak: Pak, resource: Pak): MainMenuAssets {
  return {
    background: bm(menuPak, "JACK2.BM"),
    truck: bm(menuPak, "_SAMOCH1.BM"),
    smoke: menuPak.read("D1.FLX"),
    arrows: numbered("WSK", 9).map((n) => bm(menuPak, n)),
    discs: numbered("CD", 40).map((n) => bm(menuPak, n)),
    loading: bm(menuPak, "LADEN.BM"),
    font: parseFnt(resource.read("JACK.FNT")),
  };
}

/** `read` is relative to the game directory, like fetchGameFile. */
export async function fetchMainMenuAssets(read: (rel: string) => Promise<Uint8Array>): Promise<MainMenuAssets> {
  const [menu, resource] = await Promise.all([read("menu.PAK"), read("Resource/RESOURCE.PAK")]);
  return loadMainMenuAssets(new Pak(menu), new Pak(resource));
}
