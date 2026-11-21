// Minimal embed page: chosen ZIP bytes → openZip → mountPlayer.
// What that ZIP contains: README.md.
// Imports only published jack-orlando-browser and jack-orlando-re.

import { mountPlayer, type PlayerHandle } from "jack-orlando-browser";
import { openZip } from "jack-orlando-re";

const $ = <T extends HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const canvas = $<HTMLCanvasElement>("screen");
const zipInput = $<HTMLInputElement>("zip");

let player: PlayerHandle | null = null;

function setInfo(text: string): void {
  $("info").textContent = text;
}

async function loadZip(file: File): Promise<void> {
  try {
    setInfo("Reading archive…");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const files = openZip(bytes);
    if (player) {
      await player.stop();
      player = null;
    }
    setInfo("Starting…");
    player = mountPlayer({
      canvas,
      files,
      onStatus: setInfo,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setInfo(`Error: ${message}`);
  }
}

zipInput.addEventListener("change", () => {
  const file = zipInput.files?.[0];
  if (!file) return;
  void loadZip(file);
});
