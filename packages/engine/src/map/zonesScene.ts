// Click-zone data for a scene without control, built from the scene archives (no DOM): the background as the
// scene draws it, the zones, the hit grid, and the overlay painted into one RGBA buffer.
import { Pak } from "../formats/pak";
import { decrypt } from "../formats/textcrypt";
import { windowToRgba } from "../render/surface";
import { ScenePlayer } from "../scene/player";
import { compileMcc, type Program } from "../script";
import type { Area } from "../formats/scene";
import { mapClickAreas } from "./clickzones";
import { hitGrid, sceneZones, SILENT, zoneAt, type Rect, type Zone } from "./zones";

export interface MapZonesData {
  scene: string;
  width: number;
  height: number;
  /** the background with the scene objects at their .CCG places, RGBA */
  background: Uint8ClampedArray;
  areas: readonly Area[];
  program: Program;
  zones: Zone[];
  step: number;
  grid: { cols: number; rows: number; cells: Int16Array };
}

/** Builds everything from the archives of the scene (`Action/<scene>.phk`, `Resource/RESOURCE.PAK`). */
export function loadMapZones(scene: string, resource: Pak, phk: Pak, ph2: Pak | null, step = 2): MapZonesData {
  const player = new ScenePlayer({ name: scene, resource, phk, ph2 }, { scripted: true });
  player.hideJack();
  player.tick();
  const program = compileMcc(decrypt(phk.read(`${scene}.MCC`)));
  const sc = player.scene;
  const objects = sc.ccg.objects.slice(0, sc.ccg.count).map((o) => o.name);
  // the click zones the engine really uses (the hover rectangles), not the triangles of the .ACE file
  const areas = mapClickAreas(sc.areas, program);
  const zones = sceneZones(areas, objects, program);
  const fb = player.renderer.framebuffer;
  const width = player.bgWidth, height = fb.height;
  const grid = hitGrid(width, height, step, (x, y) => zoneAt(zones, areas, program, x, y, (px, py) => player.spriteCandidates(px, py)));
  // a sprite's box: where its macro actually reacts (opaque pixels not covered by an area with a macro)
  for (let z = 0; z < zones.length; z++) if (zones[z].kind === "sprite") zones[z].bounds = cellBounds(grid, step, z);
  return { scene, width, height, background: windowToRgba(fb, 0, 0, width, height), areas, program, zones, step, grid };
}

export function cellBounds(grid: { cols: number; rows: number; cells: Int16Array }, step: number, value: number): Rect | null {
  let r: Rect | null = null;
  for (let cy = 0; cy < grid.rows; cy++) {
    for (let cx = 0; cx < grid.cols; cx++) {
      if (grid.cells[cy * grid.cols + cx] !== value) continue;
      const x = cx * step, y = cy * step;
      if (!r) r = { x0: x, y0: y, x1: x + step - 1, y1: y + step - 1 };
      else {
        r.x0 = Math.min(r.x0, x);
        r.y0 = Math.min(r.y0, y);
        r.x1 = Math.max(r.x1, x + step - 1);
        r.y1 = Math.max(r.y1, y + step - 1);
      }
    }
  }
  return r;
}

/** Zone colours (RGB); an area without a macro is drawn grey and hatched. */
export const ZONE_COLORS: readonly (readonly [number, number, number])[] = [
  [255, 80, 80], [80, 200, 255], [255, 210, 60], [120, 255, 120], [230, 120, 255], [255, 150, 60],
];
export const SILENT_COLOR = [190, 190, 190] as const;

export function zoneColor(zones: readonly Zone[], z: number): readonly [number, number, number] {
  return zones[z]?.macro ? ZONE_COLORS[z % ZONE_COLORS.length] : SILENT_COLOR;
}

/**
 * The overlay: every grid cell blended with the colour of its zone (silent areas hatched), the zone boxes outlined.
 * `highlight` (a zone index or -1) is drawn stronger, the others fainter.
 */
export function paintZones(data: MapZonesData, highlight = -1, out = new Uint8ClampedArray(data.background)): Uint8ClampedArray {
  const { width, height, step, grid, zones } = data;
  const blend = (x: number, y: number, c: readonly number[], a: number) => {
    const i = (y * width + x) * 4;
    for (let k = 0; k < 3; k++) out[i + k] = Math.round(out[i + k] * (1 - a) + c[k] * a);
  };
  for (let y = 0; y < height; y++) {
    const cy = Math.floor(y / step);
    for (let x = 0; x < width; x++) {
      const v = grid.cells[cy * grid.cols + Math.floor(x / step)];
      if (v < 0) continue;
      const silent = v >= SILENT;
      const z = silent ? v - SILENT : v;
      const strong = z === highlight;
      if (silent && (x + y) % 8 >= 3) continue; // hatching
      blend(x, y, zoneColor(zones, z), strong ? 0.6 : highlight >= 0 ? 0.2 : 0.38);
    }
  }
  zones.forEach((z, i) => {
    const b = z.bounds;
    if (!b) return;
    const c = zoneColor(zones, i), a = i === highlight ? 1 : 0.85;
    const x0 = Math.max(0, b.x0), x1 = Math.min(width - 1, b.x1), y0 = Math.max(0, b.y0), y1 = Math.min(height - 1, b.y1);
    for (let w = 0; w < (i === highlight ? 3 : 1); w++) {
      for (let x = x0; x <= x1; x++) {
        if (y0 + w <= y1) blend(x, y0 + w, c, a);
        if (y1 - w >= y0) blend(x, y1 - w, c, a);
      }
      for (let y = y0; y <= y1; y++) {
        if (x0 + w <= x1) blend(x0 + w, y, c, a);
        if (x1 - w >= x0) blend(x1 - w, y, c, a);
      }
    }
  });
  return out;
}
