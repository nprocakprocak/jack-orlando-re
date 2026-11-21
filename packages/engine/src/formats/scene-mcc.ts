// Section names, GoToScene targets and Jack start positions from an .MCC text.

import { Tokens, bracketName, cAtoi, cUpper } from "./global";

export interface JackStart {
  /** "PRE" or "INIT" */
  section: string;
  /** previous scene number from 'If LAST n', null = unconditional */
  last: number | null;
  x: number;
  y: number;
}

export interface Macros {
  sections: string[];
  /** GoToScene targets without extension */
  gotos: string[];
  jackStarts: JackStart[];
}

/** Only section names, GoToScene targets and Jack's start positions (the language is). */
export function parseMcc(plain: Uint8Array): Macros {
  const text = new Tokens(plain).text.replace(/\/[^/]*\//g, " ");
  const sections: string[] = [];
  const gotos: string[] = [];
  const jackStarts: JackStart[] = [];
  let section: string | null = null;
  let last: number | null = null;
  for (const raw of text.split("\r\n")) {
    // NUL through space separates words.
    // eslint-disable-next-line no-control-regex -- the separators are those bytes
    const words = raw.split(/[\x00-\x20]+/).filter((w) => w);
    if (!words.length) continue;
    const w0 = cUpper(words[0]);
    if (w0.startsWith("[")) {
      section = cUpper(bracketName(words[0]));
      sections.push(section);
      last = null;
      continue;
    }
    if (w0 === "GOTOSCENE" && words.length > 1) gotos.push(cUpper(words[1]).split(".")[0]);
    if (section !== "PRE" && section !== "INIT") continue;
    if (w0 === "IF" && words.length > 2 && cUpper(words[1]) === "LAST") last = cAtoi(words[2]);
    else if (w0 === "ENDIF") last = null;
    else if (w0 === "SETPOSITION" && words.length > 3 && cUpper(words[1]) === "JACK") {
      const x = cAtoi(words[2]);
      const y = cAtoi(words[3]);
      const st = jackStarts.find((s) => s.section === section && s.last === last);
      if (st) {
        st.x = x;
        st.y = y;
      } else jackStarts.push({ section, last, x, y });
    }
  }
  return { sections, gotos, jackStarts };
}
