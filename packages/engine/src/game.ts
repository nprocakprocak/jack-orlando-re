// Access to the installed game files from the browser. In development a
// dev server exposes the game folder under /game/.

export interface DirEntry {
  name: string;
  dir: boolean;
}

export async function fetchGameFile(relPath: string): Promise<Uint8Array> {
  const res = await fetch(`/game/${relPath.replace(/\\/g, "/")}`);
  if (!res.ok) throw new Error(`${relPath}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function listGameDir(relPath = ""): Promise<DirEntry[]> {
  const res = await fetch(`/game/${relPath.replace(/\\/g, "/")}`);
  if (!res.ok) throw new Error(`${relPath}: HTTP ${res.status}`);
  return res.json();
}
