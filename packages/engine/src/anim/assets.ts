// Loading what the animators need from the game archives (no DOM).
import { decrypt } from "../formats/textcrypt";
import { parseIcs, parseSfb, type Ics, type IcsFrame } from "../formats/global";
import type { Pak } from "../formats/pak";
import { viewOf } from "../formats/bytes";
import { standFrameFile, WALK_SERIES, walkHotSpotFile, type JackDir } from "./jack";
import { AnimError, type InsertionStart, type WalkFrameSet, type WalkFrames } from "./animator";

function loadSet(resource: Pak, uniform: boolean): WalkFrameSet {
  const hotSpots = WALK_SERIES.map((_, d) => {
    const name = walkHotSpotFile(d as JackDir, uniform);
    if (!resource.find(name)) throw new AnimError(`${name} missing`);
    return parseSfb(resource.read(name));
  });
  const standWidths = WALK_SERIES.map((_, d) => {
    const n = standFrameFile(d as JackDir, uniform);
    if (!resource.find(n)) throw new AnimError(`${n} missing`);
    return viewOf(resource.read(n)).getUint16(0, true);
  });
  return { hotSpots, standWidths };
}

/**
 * Hot spots of the walk series and widths of the standing frames, from RESOURCE.PAK: the civilian set and the
 * uniform set. The uniform set is left out when the archive has none of its hot-spot files (small test archives);
 * a partial one is an error.
 */
export function loadWalkFrames(resource: Pak): WalkFrames {
  const civilian = loadSet(resource, false);
  const anyUniform = WALK_SERIES.some((_, d) => resource.find(walkHotSpotFile(d as JackDir, true)));
  return anyUniform ? { ...civilian, uniform: loadSet(resource, true) } : civilian;
}

/** g_insFrames of a scene: all frames of <scene>.ICS in file order, with each section's range. */
export interface InsertionTable {
  frames: IcsFrame[];
  sections: { name: string; start: number; count: number }[];
}

export function insertionTable(ics: Ics): InsertionTable {
  const frames: IcsFrame[] = [];
  const sections = ics.sections.map((s) => {
    const start = frames.length;
    frames.push(...s.frames);
    return { name: s.name, start, count: s.frames.length };
  });
  return { frames, sections };
}

/** Scene insertion table from the scene archive (.PHK); empty if the scene has no .ICS. */
export function sceneInsertions(phk: Pak, scene: string): InsertionTable {
  const e = phk.find(`${scene}.ICS`);
  return insertionTable(e ? parseIcs(decrypt(phk.read(e))) : { sections: [], lostEffects: [] });
}

/**
 * Ins_Find for Jack: the first section whose name equals `name` exactly (strcmp; names
 * are upper case). null when the scene has no such insertion.
 */
export function findInsertion(table: InsertionTable, name: string, facing: 1 | -1): InsertionStart | null {
  const s = table.sections.find((x) => x.name === name);
  return s ? { frames: table.frames, start: s.start, count: s.count, facing, global: false, name } : null;
}

/** Ins_StartGlobal: one section of GLOBAL.ICS (read on demand by Ics_LoadSection). */
export function globalInsertion(globalIcs: Ics, name: string, facing: 1 | -1, scaleMul = 1): InsertionStart | null {
  const s = globalIcs.sections.find((x) => x.name === name.toUpperCase());
  return s ? { frames: s.frames, start: 0, count: s.frames.length, facing, global: true, scaleMul, name: s.name } : null;
}
