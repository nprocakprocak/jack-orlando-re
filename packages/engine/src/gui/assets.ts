// Loads what the GUI needs from RESOURCE.PAK: JACK.FNT, JACKM.FNT, bitmaps, and TEKST.COD.
import { readBm } from "../formats/bm";
import { parseFnt } from "../formats/fnt";
import type { Pak } from "../formats/pak";
import { parseCredits } from "../formats/text";
import { decrypt } from "../formats/textcrypt";
import { bundledDarkenTables, setDarkenTables } from "./darken";
import type { MenuAssets } from "./menu";

/** `resource` is an opened Resource/Resource.pak. Also installs the exact darkening tables. */
export function loadMenuAssets(resource: Pak): MenuAssets {
  setDarkenTables(bundledDarkenTables());
  return {
    fontBig: parseFnt(resource.read("JACK.FNT")),
    fontSmall: parseFnt(resource.read("JACKM.FNT")),
    track: readBm(resource, "RAMA.BM"),
    thumb: readBm(resource, "SUWAK.BM"),
    logo: readBm(resource, "JACBM.BM"),
    copyright: readBm(resource, "COPBM.BM"),
    credits: parseCredits(decrypt(resource.read("TEKST.COD"))),
  };
}
