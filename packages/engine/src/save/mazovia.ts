// Characters a player can type into a description: printable ASCII and the Polish letters of Mazovia (the game's font).
import { MAZOVIA, TEXT_HIGH_BYTES } from "../formats/textcrypt";

export const ENCODABLE: ReadonlySet<string> = new Set([
  ...MAZOVIA.slice(0x20, 0x7f),
  ...[...TEXT_HIGH_BYTES].map((b) => MAZOVIA[b]),
]);
