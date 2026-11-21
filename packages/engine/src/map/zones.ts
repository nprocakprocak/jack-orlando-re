// The click zones of a scene without control (the city map SC000D).
// Pure logic: the zones come from the scene's .ACE areas and its objects, the targets from running the
// scene's own macros on a recording host.
import type { Area } from "../formats/scene";
import { AreaState, areaUnder, macroName, spriteReaction, type MacroPort, type SpriteCandidate } from "../areas";
import { gotoSceneName, Interpreter, type Command, type Program } from "../script";

/** On the map the cursor is always the plain pointer (`noControlCursor`): the click macros are `POKAZANIE-<name>`. */
export const POINTER_VERB = "POKAZANIE";
const POINTER = { verb: POINTER_VERB, item: null };

const GOTOSCENE = 0x14;
const IF = 0x1b;
const IFF = 0x5b;

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Zone {
  /** an .ACE area (triangles) or a scene object (its opaque pixels) */
  kind: "area" | "sprite";
  name: string;
  /** `POKAZANIE-<name>`, null when the scene has no such macro (the click goes on to the sprites) */
  macro: string | null;
  /** areas: the bounding box of the triangles (the game does not use it, see); sprites: set by the caller */
  bounds: Rect | null;
  /** areas only: their index in the .ACE list */
  area?: number;
}

export function programPort(program: Program): MacroPort {
  return {
    exists: (name) => program.macros.some((m) => m.name === name),
    start: () => -1,
    interruptOutMacros: () => {},
  };
}

export function triangleBounds(triangles: readonly (readonly number[])[]): Rect | null {
  if (triangles.length === 0) return null;
  const r = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const t of triangles) {
    for (let k = 0; k < 6; k += 2) {
      r.x0 = Math.min(r.x0, t[k]);
      r.x1 = Math.max(r.x1, t[k]);
      r.y0 = Math.min(r.y0, t[k + 1]);
      r.y1 = Math.max(r.y1, t[k + 1]);
    }
  }
  return r;
}

/** Every area (with or without a macro) and every object that has a pointer macro. */
export function sceneZones(areas: readonly Area[], objectNames: readonly string[], program: Program): Zone[] {
  const port = programPort(program);
  const macro = (name: string) => {
    const m = macroName(POINTER_VERB, name);
    return port.exists(m) ? m : null;
  };
  const zones: Zone[] = areas.map((a, i) => ({
    kind: "area",
    name: a.name,
    macro: macro(a.name),
    bounds: triangleBounds(a.triangles),
    area: i,
  }));
  for (const name of new Set(objectNames)) {
    const m = macro(name);
    if (m) zones.push({ kind: "sprite", name, macro: m, bounds: null });
  }
  return zones;
}

/** What a click at a point does (the order of `resolveClick`: area with a macro, else a sprite with one). */
export interface ZoneHit {
  /** index into the zones of the zone whose macro runs, -1 = nothing */
  zone: number;
  /** index of an area hit by the click although it has no macro (it does not stop the click), -1 = none */
  silent: number;
}

/**
 * `sprites(x, y)` are the sprite candidates under the point in draw order (ScenePlayer.spriteCandidates).
 * The areas are all enabled (SC000D never disables one) - `st` lets a caller say otherwise.
 */
export function zoneAt(
  zones: readonly Zone[],
  areas: readonly Area[],
  program: Program,
  x: number,
  y: number,
  sprites: (x: number, y: number) => readonly SpriteCandidate[],
  st = new AreaState(),
): ZoneHit {
  const port = programPort(program);
  const a = areaUnder(areas, st, { x, y }, 0);
  let silent = -1;
  if (a >= 0) {
    const z = zones.findIndex((zz) => zz.kind === "area" && zz.area === a);
    if (zones[z]?.macro) return { zone: z, silent: -1 };
    silent = z;
  }
  const r = spriteReaction(sprites(x, y), port, 0, POINTER);
  if (r.exists) {
    const name = r.label.slice(POINTER_VERB.length + 1);
    return { zone: zones.findIndex((zz) => zz.kind === "sprite" && zz.name === name), silent };
  }
  return { zone: -1, silent };
}

/** Value of a cell of `hitGrid`: -1 nothing, z the zone that reacts, SILENT + z an area without a macro and nothing behind it. */
export const SILENT = 1000;

/** The click result sampled every `step` pixels (cell (cx, cy) = point (cx*step, cy*step)). */
export function hitGrid(
  width: number,
  height: number,
  step: number,
  at: (x: number, y: number) => ZoneHit,
): { cols: number; rows: number; cells: Int16Array } {
  const cols = Math.ceil(width / step),
    rows = Math.ceil(height / step);
  const cells = new Int16Array(cols * rows);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const h = at(cx * step, cy * step);
      cells[cy * cols + cx] = h.zone >= 0 ? h.zone : h.silent >= 0 ? SILENT + h.silent : -1;
    }
  }
  return { cols, rows, cells };
}

// --- where a click leads ------------------------------------------------------------------------

/** The variables a macro tests (IF / IFF) with the values worth trying: each tested value, its neighbours, 0. */
export function conditionValues(program: Program, macro: string): Map<string, number[]> {
  const out = new Map<string, Set<number>>();
  const m = program.macros.find((mm) => mm.name === macro);
  if (!m) return new Map();
  for (const c of program.commands.slice(m.start, m.start + m.count)) {
    if (c.code !== IF && c.code !== IFF) continue;
    const ref = c.refs.find((r) => r[0] === 2 && r[1] === "var");
    if (!ref) continue;
    const name = String(ref[2]);
    const s = out.get(name) ?? new Set<number>([0]);
    s.add(c.a[0]);
    s.add(c.a[0] + 1);
    if (c.code === IFF) s.add(c.a[0] - 1);
    out.set(name, s);
  }
  return new Map([...out].map(([k, v]) => [k, [...v].sort((a, b) => a - b)]));
}

export interface ClickRun {
  /** GOTOSCENE target, null = the macro ended without one */
  scene: string | null;
  /** variables the macro changed (after - before) */
  changed: Record<string, number>;
}

/**
 * Runs `macro` with the variables `vars` on a host that does every command at once and records GOTOSCENE. A macro runs
 * one command per tick and the scene changes after that tick (PlayGame `pendingScene`), so the first GOTOSCENE is the
 * target (SC000D still puts `DeactiveSelf` after `GotoScene SC032`, before its `GotoScene SC032B`).
 */
export function runClick(
  program: Program,
  macro: string,
  vars: ReadonlyMap<string, number>,
  maxTicks = 5000,
): ClickRun {
  let scene: string | null = null;
  const host = {
    command(cmd: Command) {
      if (cmd.code === GOTOSCENE && scene === null) scene = gotoSceneName(cmd.n1);
      return "done" as const;
    },
  };
  const it = new Interpreter(program, host, new Map(vars));
  it.start(macro);
  for (let t = 0; t < maxTicks && scene === null && it.isActive(macro); t++) it.tick();
  const changed: Record<string, number> = {};
  for (const [k, v] of it.vars.entries()) if (v !== (vars.get(k) ?? 0)) changed[k] = v;
  return { scene, changed };
}

export interface Rule {
  scene: string | null;
  /** the values of the deciding variables that lead there (one entry per combination) */
  when: Record<string, number>[];
}

export interface Destinations {
  /** the variables whose value changes the target */
  deciding: string[];
  rules: Rule[];
}

/** The targets of a click macro over every combination of the values its conditions test. */
export function destinations(
  program: Program,
  macro: string,
  base: ReadonlyMap<string, number> = new Map(),
): Destinations {
  const values = conditionValues(program, macro);
  const names = [...values.keys()];
  const combos: Record<string, number>[] = [{}];
  for (const n of names) {
    const next: Record<string, number>[] = [];
    for (const c of combos) for (const v of values.get(n)!) next.push({ ...c, [n]: v });
    combos.splice(0, combos.length, ...next);
  }
  const target = (c: Record<string, number>) =>
    runClick(program, macro, new Map([...base, ...Object.entries(c)])).scene;
  const results = combos.map((c) => ({ c, scene: target(c) }));
  const key = (c: Record<string, number>, skip: string) =>
    names
      .filter((n) => n !== skip)
      .map((n) => c[n])
      .join(",");
  const deciding = names.filter((n) => {
    const seen = new Map<string, string | null>();
    for (const r of results) {
      const k = key(r.c, n);
      if (seen.has(k) && seen.get(k) !== r.scene) return true;
      seen.set(k, r.scene);
    }
    return false;
  });
  const rules: Rule[] = [];
  for (const r of results) {
    const when = Object.fromEntries(deciding.map((n) => [n, r.c[n]]));
    let rule = rules.find((x) => x.scene === r.scene);
    if (!rule) rules.push((rule = { scene: r.scene, when: [] }));
    if (!rule.when.some((w) => deciding.every((n) => w[n] === when[n]))) rule.when.push(when);
  }
  return { deciding, rules };
}

/**
 * "SC032 gdy ODJECHAL69 = 0; SC032B gdy ODJECHAL69 ∈ {1, 2}". A rule that holds for every value is "zawsze".
 * Values that only stand for "any other" (a tested value + 1, 0) are printed as they are.
 */
export function describeDestinations(d: Destinations): string {
  const scene = (s: string | null) => s ?? "zostaje na mapie";
  if (d.rules.length === 1) return `${scene(d.rules[0].scene)} zawsze`;
  return d.rules
    .map((r) => {
      if (d.deciding.length === 1) {
        const n = d.deciding[0];
        const vs = r.when.map((w) => w[n]);
        return `${scene(r.scene)} gdy ${n} ${vs.length === 1 ? `= ${vs[0]}` : `∈ {${vs.join(", ")}}`}`;
      }
      return `${scene(r.scene)} gdy ${r.when.map((w) => d.deciding.map((n) => `${n} = ${w[n]}`).join(", ")).join(" lub ")}`;
    })
    .join("; ");
}

// --- the page's state and table ----------------------------------------------------------------

/** The switches of the page: every variable a zone macro tests, with the values worth trying (deciding ones first). */
export function stateControls(
  program: Program,
  zones: readonly Zone[],
): { name: string; values: number[]; deciding: boolean }[] {
  const values = new Map<string, Set<number>>();
  const deciding = new Set<string>();
  for (const z of zones) {
    if (!z.macro) continue;
    for (const [n, vs] of conditionValues(program, z.macro)) {
      const s = values.get(n) ?? new Set<number>();
      for (const v of vs) s.add(v);
      values.set(n, s);
    }
    for (const n of destinations(program, z.macro).deciding) deciding.add(n);
  }
  return [...values]
    .map(([name, s]) => ({
      name,
      values: [...s].sort((a, b) => a - b),
      deciding: deciding.has(name),
    }))
    .sort((a, b) => Number(b.deciding) - Number(a.deciding) || a.name.localeCompare(b.name));
}

export interface ZoneRow {
  name: string;
  kind: "strefa .ACE" | "sprite";
  macro: string;
  /** the target with the chosen variables, plus the switched variables the macro changes */
  now: string;
  /** every target with its conditions */
  rule: string;
}

export function zoneRows(program: Program, zones: readonly Zone[], vars: ReadonlyMap<string, number>): ZoneRow[] {
  return zones.map((z) => {
    const kind = z.kind === "area" ? "strefa .ACE" : "sprite";
    if (!z.macro)
      return {
        name: z.name,
        kind,
        macro: "— brak —",
        now: "nic (klik idzie dalej, do sprite'ów)",
        rule: "nigdzie",
      };
    const r = runClick(program, z.macro, vars);
    const sets = Object.entries(r.changed)
      .filter(([k]) => vars.has(k))
      .map(([k, v]) => `${k} → ${v}`);
    const now = (r.scene ?? "zostaje na mapie") + (sets.length ? ` (${sets.join(", ")})` : "");
    return {
      name: z.name,
      kind,
      macro: z.macro,
      now,
      rule: describeDestinations(destinations(program, z.macro)),
    };
  });
}
