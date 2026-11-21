// Game files from a directory on disk, for tests and tools.
import type { GameFiles } from "./game";
import { openDirectory } from "../node";

export function diskFiles(gameDir: string): GameFiles {
  return openDirectory(gameDir);
}