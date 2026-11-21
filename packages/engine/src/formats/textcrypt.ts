// Encrypted text files (Text_Decrypt).
// Every byte is stored as ~(b - 7) == (6 - b) mod 256, so the same function
// encrypts and decrypts. Plain text is Mazovia (CP437 + Polish letters), CRLF lines.

/** Extensions the game passes through Text_Decrypt. */
export const ENCRYPTED_EXTENSIONS = ["ACE", "ACI", "CCG", "COD", "DCG", "DCN", "FCC", "FCM", "ICS", "MCC", "PCS", "SSD"];

/** Bytes 0x80..0xFF of the Mazovia code page. */
const MAZOVIA_HIGH =
  "ÇüéâäàąçêëèïîćÄĄĘęłôöĆûùŚÖÜ¢Ł¥śƒŹŻóÓńŃźż¿⌐¬½¼¡«»" +
  "░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀" +
  "αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

/** Byte -> character for all 256 values. */
export const MAZOVIA: readonly string[] = [
  ...Array.from({ length: 128 }, (_, b) => String.fromCharCode(b)),
  ...MAZOVIA_HIGH,
];

/** Non-ASCII bytes expected in game text: Polish letters and 'é' (0x82). */
export const TEXT_HIGH_BYTES: ReadonlySet<number> = new Set([
  0x82, 0x86, 0x8d, 0x8f, 0x90, 0x91, 0x92, 0x95, 0x98, 0x9c, 0x9e, 0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
]);

/** Other high bytes found in game files (typos in dialogue). */
const KNOWN_ODD_BYTES: Record<string, number[]> = { "SC205.DCN": [0x9f], "SC205.DCG": [0x9f] };

/** Text_Decrypt: b = ~(b - 7). Returns a new array. */
export function decrypt(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = (6 - data[i]) & 0xff;
  return out;
}

/** The cipher is an involution: encrypting is the same operation. */
export const encrypt = decrypt;

/** Decrypted bytes -> string (Mazovia). Line ends stay as "\r\n". */
export function decodeText(plain: Uint8Array): string {
  let s = "";
  for (let i = 0; i < plain.length; i++) s += MAZOVIA[plain[i]];
  return s;
}

export function decryptText(data: Uint8Array): string {
  return decodeText(decrypt(data));
}

export function isEncryptedName(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot >= 0 && ENCRYPTED_EXTENSIONS.includes(name.slice(dot + 1).toUpperCase());
}

/** Problems with decrypted text; empty = Mazovia text with CRLF lines. Mirrors check_text() in the external checker. */
export function checkText(name: string, plain: Uint8Array): string[] {
  if (plain.length === 0) return ["empty file"];
  const problems: string[] = [];
  const odd = new Set(KNOWN_ODD_BYTES[name.toUpperCase()] ?? []);
  const isMacro = name.toUpperCase().endsWith(".MCC");
  let line = 1;
  let slashInLine = false;
  for (let i = 0; i < plain.length; i++) {
    const b = plain[i];
    if (b === 0x0d && plain[i + 1] === 0x0a) {
      line++;
      slashInLine = false;
      i++;
      continue;
    }
    if (b < 0x20 && b !== 0x09) problems.push(`line ${line}: control byte 0x${hex(b)}`);
    else if (b >= 0x80 && !TEXT_HIGH_BYTES.has(b) && !odd.has(b) && !(isMacro && slashInLine)) {
      // .MCC comments ("/ ... /") were typed in other code pages
      problems.push(`line ${line}: unexpected byte 0x${hex(b)}`);
    }
    if (b === 0x2f) slashInLine = true;
    if (problems.length >= 10) return problems;
  }
  if (plain[plain.length - 2] !== 0x0d || plain[plain.length - 1] !== 0x0a) problems.push("does not end with CRLF");
  return problems;
}

function hex(b: number): string {
  return b.toString(16).padStart(2, "0");
}
