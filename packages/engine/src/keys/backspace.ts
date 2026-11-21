// Backspace table of Game_Run (filled once from Game_Main): scene number -> where Backspace leads.

export interface BackspaceCondition {
  /** Game variable (name in `n * 0x1e`) */
  variable: string;
  /** Value it must have (`n * 4`) */
  value: number;
}

export interface BackspaceEntry {
  /** Number of the scene the key is pressed in (`g_sceneNumber`, see sceneNumber) */
  scene: number;
  /** Value written to variable `LAST` */
  target: number;
  /** Scene file to load (copied to `g_sceneName`) */
  file: string;
  cond?: BackspaceCondition;
  /** Second table, tried when the first one's condition fails */
  secondary?: true;
}

/** The 69 calls, in call order. */
export const BACKSPACE_TABLE: readonly BackspaceEntry[] = [
  { scene: 0, target: 0, file: "SC005B.CCG" },
  { scene: 7, target: 7, file: "SC005B.CCG" },
  { scene: 9, target: 7, file: "SC005B.CCG" },
  { scene: 20, target: 20, file: "SC018.CCG" },
  { scene: 11, target: 11, file: "SC005B.CCG" },
  { scene: 13, target: 11, file: "SC005B.CCG" },
  { scene: 14, target: 11, file: "SC005B.CCG" },
  { scene: 3, target: 0, file: "SC005B.CCG", cond: { variable: "ROZMZINSP", value: 1 } },
  { scene: 3, target: 3, file: "SC000B.CCG", cond: { variable: "ROZMZINSP", value: 0 }, secondary: true },
  { scene: 4, target: 2, file: "SC006.CCG" },
  { scene: 2, target: 2, file: "SC006.CCG" },
  { scene: 8, target: 8, file: "SC006.CCG" },
  { scene: 10, target: 8, file: "SC006.CCG" },
  { scene: 21, target: 21, file: "SC019.CCG" },
  { scene: 12, target: 12, file: "SC006.CCG" },
  { scene: 15, target: 12, file: "SC006.CCG" },
  { scene: 41, target: 40, file: "SC039.CCG" },
  { scene: 42, target: 40, file: "SC039.CCG" },
  { scene: 43, target: 40, file: "SC039.CCG" },
  { scene: 40, target: 40, file: "SC039.CCG" },
  { scene: 45, target: 45, file: "SC039.CCG" },
  { scene: 44, target: 44, file: "SC039.CCG" },
  { scene: 53, target: 53, file: "SC052.CCG" },
  { scene: 47, target: 47, file: "SC046.CCG" },
  { scene: 48, target: 47, file: "SC046.CCG" },
  { scene: 49, target: 47, file: "SC046.CCG" },
  { scene: 51, target: 47, file: "SC046.CCG" },
  { scene: 50, target: 47, file: "SC046.CCG" },
  { scene: 35, target: 34, file: "SC033.CCG" },
  { scene: 37, target: 34, file: "SC033.CCG" },
  { scene: 34, target: 34, file: "SC033.CCG" },
  { scene: 55, target: 58, file: "SC052.CCG", cond: { variable: "LANCUCH58", value: 1 } },
  { scene: 56, target: 58, file: "SC052.CCG", cond: { variable: "LANCUCH58", value: 1 } },
  { scene: 57, target: 58, file: "SC052.CCG", cond: { variable: "LANCUCH58", value: 1 } },
  { scene: 58, target: 58, file: "SC052.CCG", cond: { variable: "LANCUCH58", value: 1 } },
  { scene: 60, target: 60, file: "SC059.CCG" },
  { scene: 72, target: 72, file: "SC066.CCG" },
  { scene: 73, target: 72, file: "SC066.CCG" },
  { scene: 62, target: 62, file: "SC061.CCG" },
  { scene: 64, target: 64, file: "SC063.CCG" },
  { scene: 65, target: 65, file: "SC063.CCG" },
  { scene: 70, target: 69, file: "SC068.CCG" },
  { scene: 69, target: 69, file: "SC068.CCG" },
  { scene: 71, target: 69, file: "SC068.CCG" },
  { scene: 95, target: 95, file: "SC094.CCG" },
  { scene: 85, target: 85, file: "SC084.CCG" },
  { scene: 76, target: 76, file: "SC075.CCG" },
  { scene: 79, target: 79, file: "SC078.CCG" },
  { scene: 80, target: 79, file: "SC078.CCG" },
  { scene: 81, target: 81, file: "SC078.CCG" },
  { scene: 105, target: 105, file: "SC104.CCG" },
  { scene: 103, target: 103, file: "SC102.CCG" },
  { scene: 107, target: 107, file: "SC106.CCG" },
  { scene: 118, target: 118, file: "SC111.CCG" },
  { scene: 119, target: 119, file: "SC110.CCG" },
  { scene: 114, target: 113, file: "SC112.CCG" },
  { scene: 115, target: 113, file: "SC112.CCG" },
  { scene: 116, target: 113, file: "SC112.CCG" },
  { scene: 113, target: 113, file: "SC112.CCG" },
  { scene: 100, target: 100, file: "SC101.CCG", cond: { variable: "D100OPEN", value: 1 } },
  { scene: 201, target: 40, file: "SC039.CCG" },
  { scene: 202, target: 40, file: "SC039.CCG" },
  { scene: 203, target: 40, file: "SC039.CCG" },
  { scene: 204, target: 40, file: "SC039.CCG" },
  { scene: 205, target: 40, file: "SC039.CCG" },
  { scene: 207, target: 210, file: "SC061.CCG" },
  { scene: 208, target: 210, file: "SC061.CCG" },
  { scene: 209, target: 210, file: "SC061.CCG" },
  { scene: 210, target: 210, file: "SC061.CCG" },
];

/** Entries of the tables are indexed by scene number 0..0xf9 (`0xfa` slots). */
export const BACKSPACE_SLOTS = 0xfa;

/**
 * Scene number of a scene file name: `atoi` of the characters from index 2 up to the '.',
 * so `SC005B.CCG` -> 5 (atoi stops at the letter) and `SC039.CCG` -> 39. No digits -> 0.
 */
export function sceneNumber(sceneName: string): number {
  let end = 2;
  while (end < sceneName.length && sceneName[end] !== ".") end++;
  const m = /^\s*([+-]?\d+)/.exec(sceneName.slice(2, end));
  return m ? parseInt(m[1], 10) : 0;
}

/** Chapter of a scene number: 1 below 31, 2 below 75, 3 below 100, 4 below 200, else 2. */
export function sceneChapter(n: number): number {
  return n < 0x1f ? 1 : n < 0x4b ? 2 : n < 100 ? 3 : n < 200 ? 4 : 2;
}

export interface BackspaceTarget {
  file: string;
  /** New value of variable `LAST` */
  last: number;
}

function find(scene: number, secondary: boolean): BackspaceEntry | undefined {
  return BACKSPACE_TABLE.find((e) => e.scene === scene && !!e.secondary === secondary);
}

/**
 * What Backspace does in scene `scene`. The key needs a primary entry; when it has no
 * condition or the condition holds, that entry is used; otherwise the secondary entry, if its own condition holds.
 * `getVar` reads a game variable by name. Returns undefined when nothing happens.
 */
export function backspaceTarget(scene: number, getVar: (name: string) => number): BackspaceTarget | undefined {
  const first = find(scene, false);
  if (!first) return undefined;
  const ok = (e: BackspaceEntry) => !e.cond || getVar(e.cond.variable) === e.cond.value;
  const pick = ok(first) ? first : (() => {
    const second = find(scene, true);
    return second && ok(second) ? second : undefined;
  })();
  return pick && { file: pick.file, last: pick.target };
}
