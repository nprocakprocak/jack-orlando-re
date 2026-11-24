// Dev page for the engine.
//
// A canvas, a key list beside it, a status line, and — only when the dev server has no game files —
// a ZIP field. What that ZIP contains: README.md. mountPlayer runs the game.
// This file obtains files, hands them to mountPlayer, and binds F.
//
// - JO_GAME_DIR, set before `npm run dev`, is served at /game/.
// - F toggles browser fullscreen (fullscreen.ts). A short Esc stays in the game.
//   Holding Esc leaves fullscreen. The canvas keeps its aspect.
// - When that directory has no game files, zip.ts shows #how-dev and the ZIP field.
// - A production build shows #how-prod instead. That text does not name JO_GAME_DIR.
// - The query string is read in query.ts.

import { httpGameFiles, mountPlayer, type PlayerHandle } from "jack-orlando-browser";
import type { GameFiles } from "jack-orlando-re";
import { bindFullscreen } from "./fullscreen";
import { mountOptionsFromQuery } from "./query";
import { showZipFallback } from "./zip";

const $ = <T extends HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const canvas = $<HTMLCanvasElement>("screen");
const stage = $<HTMLElement>("stage");
const keys = $<HTMLElement>("keys");

// F enters and leaves browser fullscreen. The game still receives the key.
// A short Esc stays with the game. Holding Esc leaves fullscreen.
bindFullscreen(stage, canvas);

let player: PlayerHandle | null = null;

// An empty status is the start screen. The player clears the line only after
// that screen is up. The key list stays hidden until then, and through a failed load.
function setInfo(text: string): void {
  $("info").textContent = text;
  if (text === "") keys.hidden = false;
}

// The dev server answers unknown /game/ URLs with its HTML page. That page
// is not a game file, so an ok response of type text/html counts as missing.
function htmlBody(res: Response): boolean {
  return (res.headers.get("content-type") ?? "").includes("text/html");
}

async function directoryAvailable(): Promise<boolean> {
  try {
    const res = await fetch("/game/Global.pak", { method: "HEAD" });
    return res.ok && !htmlBody(res);
  } catch {
    return false;
  }
}

// The first call may skip the start screen when the query says so.
// A call that replaces a session already on screen shows the start screen again.
async function adopt(files: GameFiles): Promise<void> {
  keys.hidden = true;
  const remount = player !== null;
  if (player) {
    await player.stop();
    player = null;
  }
  player = mountPlayer({
    canvas,
    files,
    onStatus: setInfo,
    ...mountOptionsFromQuery(location.search, remount),
  });
}

if (await directoryAvailable()) void adopt(httpGameFiles("/game/"));
else showZipFallback(adopt, setInfo);
