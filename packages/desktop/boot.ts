// Boot page. Files arrive over HTTP. A ZIP source is game assets packed from
// inside the game directory. What to pack: README.md. The play session lives in mountPlayer.

import { httpGameFiles, mountPlayer } from "jack-orlando-browser";
import { openZip } from "jack-orlando-re";

const canvas = document.querySelector("#screen");
const status = document.querySelector("#status");

if (!(canvas instanceof HTMLCanvasElement) || !(status instanceof HTMLElement)) {
  throw new Error("Boot page is missing the canvas or the status line.");
}

function setStatus(text: string): void {
  status.textContent = text;
}

// "Exit" on the main menu. The process listens for this and closes the window.
function quitApp(): void {
  void fetch("/quit", { method: "POST" }).catch(() => undefined);
}

// F toggles the window the same way F11 does. The listener is on the bubble,
// so a slot description, which stops the key on the way down, leaves fullscreen alone.
window.addEventListener("keydown", (ev) => {
  if (ev.code !== "KeyF" || ev.repeat) return;
  if (ev.ctrlKey || ev.altKey || ev.metaKey || ev.shiftKey) return;
  void fetch("/fullscreen", { method: "POST" }).catch(() => undefined);
});

type Source = { type?: string };

async function start(): Promise<void> {
  const described = await fetch("/source.json");
  if (!described.ok) throw new Error("No source");
  const source = (await described.json()) as Source;
  if (source.type === "directory") {
    mountPlayer({
      canvas,
      files: httpGameFiles("/game/"),
      onStatus: setStatus,
      fit: "contain",
      onQuit: quitApp,
    });
    return;
  }
  if (source.type === "zip") {
    setStatus("Opening archive");
    const archive = await fetch("/archive.zip");
    if (!archive.ok) throw new Error("No archive");
    mountPlayer({
      canvas,
      files: openZip(new Uint8Array(await archive.arrayBuffer())),
      onStatus: setStatus,
      fit: "contain",
      onQuit: quitApp,
    });
    return;
  }
  throw new Error("Unknown source");
}

start().catch((err: unknown) => {
  setStatus(err instanceof Error ? err.message : "Could not start");
});
