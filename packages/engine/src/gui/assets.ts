// Loads what the GUI needs from RESOURCE.PAK: JACK.FNT, JACKM.FNT, bitmaps, and TEKST.COD.
import { decodeBm } from "../formats/bm";
import { parseFnt } from "../formats/fnt";
import type { Pak } from "../formats/pak";
import { parseCredits } from "../formats/text";
import { decrypt } from "../formats/textcrypt";
import { bundledDarkenTables, setDarkenTables } from "./darken";
import type { MenuAssets } from "./menu";

/** `resource` is an opened Resource/Resource.pak. Also installs the exact darkening tables. */
export function loadMenuAssets(resource: Pak): MenuAssets {
  setDarkenTables(bundledDarkenTables());
  const bm = (name: string) => decodeBm(resource.read(name));
  return {
    fontBig: parseFnt(resource.read("JACK.FNT")),
    fontSmall: parseFnt(resource.read("JACKM.FNT")),
    track: bm("RAMA.BM"),
    thumb: bm("SUWAK.BM"),
    logo: bm("JACBM.BM"),
    copyright: bm("COPBM.BM"),
    credits: parseCredits(decrypt(resource.read("TEKST.COD"))),
  };
}
