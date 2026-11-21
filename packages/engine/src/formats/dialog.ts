// Dialogue files .DCN and face lists .FCC of a scene.
// Same as the external checker.
import { cAtoi, cUpper, s16, Tokens } from "./global";
import type { Pak } from "./pak";
import { decodeText, decrypt } from "./textcrypt";

export const LINE_TEXT_MAX = 0x103; // 0x118-byte entry: text 0x104 bytes with NUL, then the sound name
export const SOUND_MAX = 13; // sound name field +0x104..+0x111
export const ID_TOKEN_MAX = 7; // the id token is read into char[8] (Scene_LoadDcn)
export const MAX_OPTIONS = 8; // keeps 8 option slots
export const FACE_NAME_MAX = 19; // face name table: 0x14 bytes per face
export const FIRST_FACE = 2; // Scene_LoadFcc fills slots from 2 (0 and 1 are not loaded from FCC)
export const EYE_FRAMES = 3;
export const MOUTH_FRAMES = 5;

export class DialogError extends Error {}

/** Tokens plus strict reads: the game leaves a field unchanged at the end of the text. */
class Reader {
  readonly t: Tokens;

  constructor(plain: Uint8Array) {
    this.t = new Tokens(plain);
    this.t.skip();
  }

  more(): boolean {
    return !this.t.atEnd();
  }

  word(what: string): string {
    if (this.t.atEnd()) throw new DialogError(`truncated: ${what} missing at end of file`);
    return this.t.next();
  }

  number(what: string): number {
    if (this.t.atEnd()) throw new DialogError(`truncated: ${what} missing at end of file`);
    return this.t.short()!;
  }

  /** First token of a record. The loaders return when it is the last token. */
  head(): string | null {
    const tok = this.t.next();
    return this.t.pos >= this.t.len ? null : tok;
  }
}

// --- .DCN ------------------------------------------------------------------------------------

export interface DcnEntry {
  id: number;
  /** Mazovia-decoded, '_' turned back into spaces */
  text: string;
  /** caption width in pixels (param 3) */
  width: number;
  /** ".SND"; the voice is .S22 (Sound_PlayTalk) */
  sound: string;
}

export interface DcnDialog {
  id: number;
  /** "Q" = answer menu, "R" = random group; the loader treats both alike */
  kind: "Q" | "R";
  /** index of option 0 in `entries` */
  first: number;
  count: number;
}

export interface Dcn {
  /** the game's single line table: lone lines and every dialog's options, in file order */
  entries: DcnEntry[];
  dialogs: DcnDialog[];
}

/** Scene_LoadDcn. Option i of a dialog is entries[first + i] with id = dialog id + i. */
export function parseDcn(plain: Uint8Array): Dcn {
  const r = new Reader(plain);
  const entries: DcnEntry[] = [];
  const dialogs: DcnDialog[] = [];

  const entry = (id: number, text: string, width: number, sound: string) => {
    if (sound.length > SOUND_MAX)
      throw new DialogError(`sound name too long (${sound.length} > ${SOUND_MAX}): ${sound}`);
    const bytes = Uint8Array.from(text.replaceAll("_", " "), (c) => c.charCodeAt(0));
    entries.push({ id, text: decodeText(bytes), width, sound });
  };

  while (r.more()) {
    const tok = r.head();
    if (tok === null) break;
    if (tok[0] === "Q" || tok[0] === "R") {
      const did = r.number("dialog id");
      const count = r.number("option count");
      const first = entries.length;
      for (let i = 0; i < count; i++) {
        const text = r.word("option text");
        if (text.length > LINE_TEXT_MAX)
          throw new DialogError(`option text too long (${text.length}) in dialog ${did}`);
        const width = r.number("option width");
        entry(s16(did + i), text, width, r.word("option sound"));
      }
      dialogs.push({ id: did, kind: tok[0], first, count: Math.max(count, 0) });
    } else {
      if (tok.length > ID_TOKEN_MAX) throw new DialogError(`line id token too long: ${tok}`);
      const text = r.word("line text").slice(0, LINE_TEXT_MAX); // the loader cuts a long text at 0x103
      const width = r.number("line width");
      entry(s16(cAtoi(tok)), text, width, r.word("line sound"));
    }
  }
  return { entries, dialogs };
}

/** Script_FindTalkLine: index of the first entry with this id, or -1. */
export function findTalkLine(dcn: Dcn, id: number): number {
  return dcn.entries.findIndex((e) => e.id === id);
}

/** Script_FindDialog: index of the first dialog with this id, or -1. */
export function findDialog(dcn: Dcn, id: number): number {
  return dcn.dialogs.findIndex((d) => d.id === id);
}

/** Options of a dialog (entries `first first + count`). */
export function dialogOptions(dcn: Dcn, dialogIndex: number): DcnEntry[] {
  const d = dcn.dialogs[dialogIndex];
  return dcn.entries.slice(d.first, d.first + d.count);
}

/** Sound_PlayTalk replaces the extension with .S22. */
export function voiceName(sound: string): string {
  const i = sound.lastIndexOf(".");
  return (i < 0 ? sound : sound.slice(0, i)) + ".S22";
}

// --- .FCC ------------------------------------------------------------------------------------

export interface Face {
  name: string;
  /** background image of the face window */
  face: string;
  eyesPos: [number, number];
  /** 3 blink frames (upper-cased like the game does) */
  eyes: string[];
  mouthPos: [number, number];
  /** 5 mouth frames */
  mouth: string[];
}

/** Scene_LoadFcc. The game's face index is the position + FIRST_FACE. */
export function parseFcc(plain: Uint8Array): Face[] {
  const r = new Reader(plain);
  const faces: Face[] = [];
  while (r.more()) {
    const head = r.head();
    if (head === null) break;
    const name = head.slice(1, -1); // Str_StripEnds: drops the first and last character, whatever they are
    if (name.length > FACE_NAME_MAX) throw new DialogError(`face name too long: ${name}`);
    const face = r.word("face image");
    const ex = r.number("eyes x");
    const ey = r.number("eyes y");
    const eyes = Array.from({ length: EYE_FRAMES }, () => cUpper(r.word("eye frame")));
    const mx = r.number("mouth x");
    const my = r.number("mouth y");
    const mouth = Array.from({ length: MOUTH_FRAMES }, () => r.word("mouth frame"));
    faces.push({ name, face, eyesPos: [ex, ey], eyes, mouthPos: [mx, my], mouth });
  }
  return faces;
}

/** Script_FindFace: game face index (position + 2; case-sensitive), or -1. */
export function findFace(faces: Face[], name: string): number {
  const i = faces.findIndex((f) => f.name === name);
  return i < 0 ? -1 : i + FIRST_FACE;
}

export function faceFiles(f: Face): string[] {
  return [f.face, ...f.eyes, ...f.mouth];
}

// --- scene archive ---------------------------------------------------------------------------

export interface SceneDialogs {
  scene: string;
  /** null = the scene has no such file (the loaders check Pak_Exists) */
  dcn: Dcn | null;
  fcc: Face[] | null;
}

/** DCN and FCC of scene `scene` ("SC001") from its SCxxx.PHK. */
export function parseSceneDialogs(pak: Pak, scene: string): SceneDialogs {
  const plain = (ext: string) => {
    const e = pak.find(`${scene}.${ext}`);
    return e ? decrypt(pak.read(e)) : null;
  };
  const d = plain("DCN");
  const f = plain("FCC");
  return { scene, dcn: d ? parseDcn(d) : null, fcc: f ? parseFcc(f) : null };
}

export const PATTERNS = ["SC*.PHK"];
