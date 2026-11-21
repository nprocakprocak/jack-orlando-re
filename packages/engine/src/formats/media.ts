// Video: movies Movies\*.AVX and animations *.FLX (MENU.PAK:D1.FLX, Action\*.PHK).
// FLX is the game's own format (not Autodesk FLIC): a 0x14-byte header and chunks
// [type u8, pad u8, size u32] with 8-bit delta frames, an RGB565 palette and dirty
// rectangles. AVX is a container: 4-byte header, 2.5 s of IMA ADPCM stereo sound,
// then blocks of records; each record = one FLX frame + the sound for that frame.
// Frames are decoded one at a time (generators), so a player never holds a whole movie.

export * from "./media-flx";
export * from "./media-avx";
