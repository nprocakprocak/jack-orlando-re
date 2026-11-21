// Zone overlay on a made-up grid. loadMapZones needs a scene archive and stays out.
import { describe, expect, it } from "vitest";
import { cellBounds, paintZones, SILENT_COLOR, ZONE_COLORS, zoneColor, type MapZonesData } from "./zonesScene";
import { SILENT, type Zone } from "./zones";

const zone = (macro: string | null): Zone => ({ kind: "area", name: "BOX", macro, bounds: null });

function gridData(width: number, height: number, cells: number[], zones: Zone[], step = 1): MapZonesData {
  return {
    scene: "SC001",
    width,
    height,
    background: new Uint8ClampedArray(width * height * 4),
    areas: [],
    program: { macros: [] },
    zones,
    step,
    grid: {
      cols: Math.ceil(width / step),
      rows: Math.ceil(height / step),
      cells: Int16Array.from(cells),
    },
  } as unknown as MapZonesData;
}

function pixel(buf: Uint8ClampedArray, width: number, x: number, y: number): number[] {
  const i = (y * width + x) * 4;
  return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]];
}

describe("zone overlay", () => {
  it("cellBounds is null when the value is absent, and one rectangle for adjacent cells", () => {
    const empty = { cols: 2, rows: 2, cells: Int16Array.from([-1, -1, -1, -1]) };
    expect(cellBounds(empty, 4, 0)).toBeNull();
    const row = { cols: 2, rows: 2, cells: Int16Array.from([0, 0, -1, -1]) };
    expect(cellBounds(row, 4, 0)).toEqual({ x0: 0, y0: 0, x1: 7, y1: 3 });
  });

  it("zoneColor uses the palette when the zone has a macro, and grey when it does not", () => {
    const zones = [zone("GO"), zone(null), ...Array.from({ length: ZONE_COLORS.length - 1 }, () => zone("GO"))];
    expect(zoneColor(zones, 0)).toEqual(ZONE_COLORS[0]);
    expect(zoneColor(zones, 1)).toEqual(SILENT_COLOR);
    expect(zoneColor(zones, ZONE_COLORS.length)).toEqual(ZONE_COLORS[0]);
  });

  it("paintZones leaves an empty cell, blends a live cell, hatches a silent one, and paints a highlight stronger", () => {
    const blank = new Uint8ClampedArray([10, 20, 30, 255]);
    const empty = paintZones(gridData(1, 1, [-1], [zone("GO")]), -1, blank.slice());
    expect(pixel(empty, 1, 0, 0)).toEqual([10, 20, 30, 255]);

    const white = () => {
      const b = new Uint8ClampedArray(8 * 4);
      for (let i = 0; i < 8; i++) b.set([255, 255, 255, 255], i * 4);
      return b;
    };
    const live = paintZones(gridData(1, 1, [0], [zone("GO")]), -1, white().subarray(0, 4));
    const strong = paintZones(gridData(1, 1, [0], [zone("GO")]), 0, white().subarray(0, 4));
    expect(pixel(live, 1, 0, 0)[1]).toBeLessThan(255);
    expect(pixel(strong, 1, 0, 0)[1]).toBeLessThan(pixel(live, 1, 0, 0)[1]);

    const silent = paintZones(gridData(8, 1, [SILENT], [zone(null)], 8), -1, white());
    expect(pixel(silent, 8, 0, 0)[0]).toBeLessThan(255);
    expect(pixel(silent, 8, 3, 0)).toEqual([255, 255, 255, 255]);
  });
});
