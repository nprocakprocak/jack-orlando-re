import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { zipSync } from "fflate";
import type { GameFiles } from "../src/play/game";
import type { PlayGame, PlayInput } from "../src/play/game";

const IDLE: PlayInput = { x: 320, y: 240, pressed: false, down: false, inWindow: true };

const target = process.argv.slice(2).find((arg) => !arg.startsWith("-"));

if (!target) {
  console.log(
    "No game files were given, so this run uses a stand-in archive built in the script.\n" +
      "The stand-in checks that the built Node package starts: it opens a ZIP, creates PlayGame, and steps a few frames. Nothing is drawn, and this is not the game.\n" +
      "Pass a directory or a .zip file to load your own files.",
  );
}

const build = spawnSync("npm", ["run", "build"], { stdio: "inherit", shell: true });
if (build.status !== 0) process.exit(build.status ?? 1);

const { openDirectory, openZipFile } = await import("../dist/node.js");
const { PlayGame: Play } = await import("../dist/node.js");

function statusLine(game: PlayGame): string {
  const err = game.error ? ` error=${game.error}` : "";
  return `phase=${game.phase} scene=${game.sceneName || "-"}${err}`;
}

async function runFrames(game: PlayGame): Promise<void> {
  await game.settle();
  for (let i = 0; i < 8; i++) {
    game.frame(IDLE);
    game.update();
  }
}

async function playFromPath(filePath: string): Promise<void> {
  let files: GameFiles | null;
  try {
    const st = fs.statSync(filePath);
    files = st.isDirectory() ? openDirectory(filePath) : filePath.toLowerCase().endsWith(".zip") ? await openZipFile(filePath) : null;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }
  if (!files) {
    console.error("Expected a directory or a .zip file.");
    process.exitCode = 1;
    return;
  }
  await play(files);
}

/** Text cipher used by the loaders: each byte becomes (6 - b) mod 256. */
function cipher(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = (6 - text.charCodeAt(i)) & 0xff;
  return out;
}

/** 1×1 RGB565 image. */
function bm1(): Uint8Array {
  const out = new Uint8Array(6);
  const view = new DataView(out.buffer);
  view.setUint16(0, 1, true);
  view.setUint16(2, 1, true);
  return out;
}

/** 1×1 paletted image: header, 256-byte palette, one literal pixel. */
function pbm1(): Uint8Array {
  const out = new Uint8Array(4 + 256 + 1);
  const view = new DataView(out.buffer);
  view.setUint16(0, 1, true);
  view.setUint16(2, 1, true);
  return out;
}

/** Archive the Pak reader accepts. Names are ASCII plus a trailing NUL. */
function pak(files: Record<string, Uint8Array>): Uint8Array {
  const names = Object.keys(files);
  const nameBytes = names.map((name) => {
    const bytes = new Uint8Array(name.length + 1);
    for (let i = 0; i < name.length; i++) bytes[i] = name.charCodeAt(i);
    return bytes;
  });
  const dirSize = nameBytes.reduce((n, bytes) => n + 12 + bytes.length, 0);
  const dataStart = 16 + dirSize;
  const total = dataStart + names.reduce((n, name) => n + files[name].length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  out[0] = 0x50;
  out[1] = 0x41;
  out[2] = 0x4b;
  view.setUint32(4, names.length, true);
  view.setUint32(8, dataStart, true);
  let dir = 16;
  let data = dataStart;
  names.forEach((name, i) => {
    const body = files[name];
    view.setUint32(dir, data, true);
    view.setUint32(dir + 4, body.length, true);
    view.setUint32(dir + 8, nameBytes[i].length, true);
    out.set(nameBytes[i], dir + 12);
    dir += 12 + nameBytes[i].length;
    out.set(body, data);
    data += body.length;
  });
  return out;
}

/**
 * Smallest scene PlayGame.create can enter with dialogs and the menu off.
 * Names are the ones the loaders ask for. Every byte is built here.
 */
function inventedZip(): Uint8Array {
  const width = Uint8Array.of(1, 0);
  const hotSpots = new Uint8Array(6);
  const resource: Record<string, Uint8Array> = {
    "VARIABLE.ALL": new Uint8Array(0),
    "CIEN1.BM": bm1(),
    "SSFR2.PBM": pbm1(),
    "SSPR2.PBM": width,
    "SSBA2.PBM": width,
    "SSSP2.PBM": width,
    "SSST2.PBM": width,
  };
  for (const series of ["FRON", "PROF", "BACK", "SKFR", "SKBA"]) resource[`${series}.SFB`] = hotSpots;
  return zipSync({
    "Resource/RESOURCE.PAK": pak(resource),
    "Global.pak": pak({ "GLOBAL.ICS": cipher("[A]\r\n") }),
    "Action/SC001.phk": pak({
      "SC001.CCG": cipher("[grafiki]\r\nA.BM\r\n"),
      "SC001.MCC": new Uint8Array(0),
      "A.BM": bm1(),
    }),
  });
}

async function play(files: GameFiles): Promise<void> {
  try {
    const game = await Play.create(files, { dialogs: false, menu: false });
    await runFrames(game);
    console.log(statusLine(game));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

/** No path: a temp zip of the bytes above. A path still opens that directory or .zip. */
async function playInvented(): Promise<void> {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "jo-play-"));
  try {
    const zipPath = nodePath.join(dir, "invented.zip");
    fs.writeFileSync(zipPath, inventedZip());
    await play(await openZipFile(zipPath));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (target) await playFromPath(target);
else await playInvented();
