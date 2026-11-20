// Bitmaps of the small map (GLOBAL.PAK): MAP2.BM and the 20 marker frames of the set for the chapter.
import { readBm, type Image16 } from "../formats/bm";
import type { Pak } from "../formats/pak";
import { MARKER_FRAMES, markerFileName, markerSetFor } from "./layout";
import type { MiniMapAssets } from "./screen";

export function loadMiniMapAssets(global: Pak, chapter: number): MiniMapAssets {
  const set = markerSetFor(chapter);
  const frames: Image16[] = [];
  if (set !== null) for (let i = 0; i < MARKER_FRAMES; i++) frames.push(readBm(global, markerFileName(set, i)));
  return { map: readBm(global, "MAP2.BM"), set, frames };
}
