// Macro compiler.MCC text -> commands, after Script_CompileMacros.
// Same model as the external checker (keys as in Python).
// The game reads each command into a 0x6c-byte record: names n1 (+0x02) and n2 (+0x2a),
// shorts a[0..6] (+0x52..), a float f (+0x60) and the first char c of a flag token (+0x68).
// Names of scene things stay names in `refs` ([slot, kind, name]); the game resolves them
// to indices while compiling, the engine resolves them when a command runs.

import { Tokens } from "../formats/global";
import {
  FLAG_MAX, MACRO_NAME_MAX, NAME_MAX, V,
  type Command, type Program,
} from "./compiler-words";
export {
  DONOTHING, ENDIF, FLAG_MAX, IF_CODES, JACK, MACRO_NAME_MAX, MAX_COMMANDS, MAX_MACROS,
  NAME_MAX, NAMES, WORDS, MacroError, stripBrackets,
} from "./compiler-words";
export type { Command, Macro, Program, Ref, RefKind } from "./compiler-words";
export { compileMcc } from "./compiler-emit";

export function findMacro(program: Program, name: string): number {
  return program.macros.findIndex((m) => m.name === name);
}

export function macroCommands(program: Program, name: string): Command[] | null {
  const m = program.macros.find((x) => x.name === name);
  return m ? program.commands.slice(m.start, m.start + m.count) : null;
}

/** Var_LoadAll: names and start values of RESOURCE.PAK:VARIABLE.ALL (plain text). */
export function parseVariables(plain: Uint8Array): Map<string, number> {
  const t = new Tokens(plain);
  const out = new Map<string, number>();
  t.skip();
  while (!t.atEnd()) {
    const name = t.next("name");
    const v = t.short() ?? 0;
    if (!out.has(name)) out.set(name, v);
  }
  return out;
}

/** Problems the game would get wrong (same checks as the external checker problems_of). */
export function problemsOf(program: Program, variables: ReadonlyMap<string, number>, known: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = [];
  for (const m of program.macros) {
    if (m.name.length > MACRO_NAME_MAX) out.push(`[${m.name}]: name longer than ${MACRO_NAME_MAX}`);
  }
  for (const cmd of program.commands) {
    const where = `line ${cmd.line} ${cmd.word}`;
    for (const f of ["n1", "n2"] as const) {
      if (cmd[f].length > NAME_MAX) out.push(`${where}: ${f} "${cmd[f]}" longer than ${NAME_MAX}`);
    }
    if (cmd.flag !== undefined && cmd.flag.length > FLAG_MAX) out.push(`${where}: flag "${cmd.flag}" overruns the compiler's stack`);
    for (const [, kind, name] of cmd.refs) {
      if (kind === V && !variables.has(name as string) && !known.has(name as string)) {
        out.push(`${where}: variable "${name}" not in VARIABLE.ALL`);
      }
    }
  }
  return out;
}
