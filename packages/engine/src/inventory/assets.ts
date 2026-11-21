// Loading the coat's bitmaps (GLOBAL.PAK), the item names (RESOURCE.PAK: ELEM.LST) and JACKM.FNT.
import { encodeMazovia } from "../dialog/caption";
import { readBm } from "../formats/bm";
import { parseFnt } from "../formats/fnt";
import type { Pak } from "../formats/pak";
import { parseItems, lookupItem, type ItemRecord } from "../formats/text";
import type { CoatAssets, CoatImages } from "./screen";

function version(global: Pak, v: "C" | "M"): CoatImages {
  return {
    background: readBm(global, `INV_${v}.BM`),
    up: readBm(global, `A_UP1_${v}.BM`),
    down: readBm(global, `A_DN1_${v}.BM`),
    opt: readBm(global, `OPT1_${v}.BM`),
    upPressed: readBm(global, `A_UP2_${v}.BM`),
    downPressed: readBm(global, `A_DN2_${v}.BM`),
    optPressed: readBm(global, `OPT2_${v}.BM`),
  };
}

/** `global` is Global.pak. `resource` is Resource.pak; the name strip uses `JACKM.FNT`. */
export function loadCoatAssets(global: Pak, resource: Pak): CoatAssets {
  return {
    civilian: version(global, "C"),
    uniform: version(global, "M"),
    font: parseFnt(resource.read("JACKM.FNT")),
  };
}

/** Display names back to font bytes (`parseItems` decoded them). Same map as `encodeMazovia`, including `é` drawn as `e`. */
export const encodeText = encodeMazovia;

/** Item_LookupName over ELEM.LST (plaintext of `Resource.pak`): file → name bytes, null without a record. */
export function itemNameLookup(elemLst: Uint8Array): (file: string) => Uint8Array | null {
  const items: ItemRecord[] = parseItems(elemLst);
  return (file) => {
    const n = lookupItem(items, file);
    return n ? encodeText(n) : null;
  };
}
