// Dev page for the engine.
//
// A canvas, a status line, and — only when the dev server has no game files —
// a ZIP field. What that ZIP contains: README.md. mountPlayer runs the game.
// This file only obtains files and hands them over.
//
// - JO_GAME_DIR, set before `npm run dev`, is served at /game/.
// - When that directory has no game files, zip.ts shows #how-dev and the ZIP field.
// - A production build shows #how-prod instead. That text does not name JO_GAME_DIR.
// - The query string is read in query.ts.

import { httpGameFiles, mountPlayer, type PlayerHandle } from "jack-orlando-browser";
import type { GameFiles } from "jack-orlando-re";
import { mountOptionsFromQuery } from "./query";
import { showZipFallback } from "./zip";

const $ = <T extends HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const canvas = $<HTMLCanvasElement>("screen");

let player: PlayerHandle | null = null;

function setInfo(text: string): void {
  $("info").textContent = text;
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
