import { describe, expect, it } from "vitest";
import {
  INTRO_PIXELS_MAX,
  SUBS_BUFFER,
  SubtitleTrack,
  SubtitlesError,
  isIntro,
  parseSubtitles,
  rgb888To565,
  verifySubtitles,
} from "./subtitles";

// --- synthetic data ---------------------------------------------------------

function u16(...v: number[]): number[] {
  return v.flatMap((x) => [x & 0xff, x >> 8]);
}

/** INTRO record: w, h, x, y, first, last, segment, colour, 7 padding bytes, 8-bit pixels. */
function intro(o: {
  w: number;
  h: number;
  x?: number;
  y?: number;
  first?: number;
  last?: number;
  seg?: number;
  color?: number[];
  px: number[];
}) {
  return [
    ...u16(o.w, o.h, o.x ?? 0, o.y ?? 0, o.first ?? 1, o.last ?? 5, o.seg ?? 0),
    ...(o.color ?? [255, 255, 0]),
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    ...o.px,
  ];
}

/** RGB565 record: first, last, x, y, unk, w, h, 16-bit pixels. */
function rgb(o: {
  w: number;
  h: number;
  x?: number;
  y?: number;
  first?: number;
  last?: number;
  unk?: number;
  px: number[];
}) {
  return [...u16(o.first ?? 1, o.last ?? 5, o.x ?? 0, o.y ?? 0, o.unk ?? 0, o.w, o.h), ...u16(...o.px)];
}

describe("subtitles on synthetic data", () => {
  it("maps INTRO pixels through the palette: 0 -> 1, 128 -> 0, 255 -> colour", () => {
    const [s] = parseSubtitles(
      new Uint8Array(intro({ w: 3, h: 1, px: [0, 128, 255], color: [0x2c, 0xd9, 0x0d] })),
      true,
    );
    expect([...s.pixels]).toEqual([1, 0, rgb888To565(0x2c, 0xd9, 0x0d)]);
    expect(rgb888To565(0x2c, 0xd9, 0x0d)).toBe((0x28 << 8) | (0xd8 << 3) | 1);
    expect(s.color).toEqual([0x2c, 0xd9, 0x0d]);
    expect(s.segment).toBe(0);
  });

  it("maps any other INTRO value to 0 (zeroed palette entry)", () => {
    const [s] = parseSubtitles(new Uint8Array(intro({ w: 2, h: 1, px: [7, 254] })), true);
    expect([...s.pixels]).toEqual([0, 0]);
  });

  it("reads INTRO header fields", () => {
    const [s] = parseSubtitles(
      new Uint8Array(intro({ w: 1, h: 1, x: 210, y: 406, first: 32, last: 78, seg: 25, px: [255] })),
      true,
    );
    expect([s.x, s.y, s.first, s.last, s.segment, s.width, s.height]).toEqual([210, 406, 32, 78, 25, 1, 1]);
  });

  it("reads RGB565 records and keeps 0 as transparent", () => {
    const [s] = parseSubtitles(
      new Uint8Array(rgb({ w: 2, h: 2, x: 7, y: 9, first: 5, last: 75, px: [0, 0xffff, 0x1234, 0] })),
      false,
    );
    expect([s.first, s.last, s.x, s.y, s.width, s.height, s.segment, s.color]).toEqual([5, 75, 7, 9, 2, 2, null, null]);
    expect([...s.pixels]).toEqual([0, 0xffff, 0x1234, 0]);
  });

  it("reads several records in order", () => {
    const data = new Uint8Array([
      ...rgb({ w: 1, h: 1, first: 1, last: 2, px: [1] }),
      ...rgb({ w: 2, h: 1, first: 3, last: 4, px: [2, 3] }),
    ]);
    expect(parseSubtitles(data, false).map((s) => [s.first, s.pixels.length])).toEqual([
      [1, 1],
      [3, 2],
    ]);
  });

  it("accepts an empty file", () => {
    expect(parseSubtitles(new Uint8Array(0), false)).toEqual([]);
  });

  it("rejects a truncated header", () => {
    expect(() => parseSubtitles(new Uint8Array(13), false)).toThrow(/record header truncated at 0x0/);
    expect(() => parseSubtitles(new Uint8Array(23), true)).toThrow(/record header truncated/);
  });

  it("rejects truncated pixels", () => {
    const data = new Uint8Array(rgb({ w: 2, h: 2, px: [1, 2, 3, 4] }));
    expect(() => parseSubtitles(data.subarray(0, data.length - 1), false)).toThrow(/pixels truncated/);
    const i = new Uint8Array(intro({ w: 4, h: 1, px: [0, 0, 0, 0] }));
    expect(() => parseSubtitles(i.subarray(0, i.length - 1), true)).toThrow(/pixels truncated/);
  });

  it("reports the offset of the failing record", () => {
    const first = rgb({ w: 1, h: 1, px: [1] });
    const data = new Uint8Array([...first, ...u16(1, 2, 0, 0, 0, 5, 5)]);
    expect(() => parseSubtitles(data, false)).toThrow(`record at 0x${first.length.toString(16)}`);
  });

  it("rejects files that do not fit the game's buffer", () => {
    expect(() => parseSubtitles(new Uint8Array(SUBS_BUFFER + 1), false)).toThrow(/do not fit/);
    expect(parseSubtitles(new Uint8Array(0), true)).toEqual([]);
  });

  it("rejects an INTRO picture larger than the mapped-picture buffer", () => {
    const big = new Uint8Array(24);
    new DataView(big.buffer).setUint16(0, INTRO_PIXELS_MAX + 1, true);
    new DataView(big.buffer).setUint16(2, 1, true);
    expect(() => parseSubtitles(big, true)).toThrow(/exceeds the mapped-picture buffer/);
  });

  it("throws SubtitlesError", () => {
    expect(() => parseSubtitles(new Uint8Array(1), false)).toThrow(SubtitlesError);
  });

  it("chooses the layout by file name", () => {
    expect(isIntro("INTRO.DLG")).toBe(true);
    expect(isIntro("Movies\\intro.dlg")).toBe(true);
    expect(isIntro("MUN16.DLG")).toBe(false);
  });
});

describe("verifySubtitles on synthetic data", () => {
  const ok = (extra: Parameters<typeof rgb>[0]) => verifySubtitles("X.DLG", new Uint8Array(rgb(extra)));

  it("accepts a good file", () => {
    expect(ok({ w: 1, h: 1, px: [1] })).toEqual([]);
  });

  it("passes parse errors through", () => {
    expect(verifySubtitles("X.DLG", new Uint8Array(3))).toEqual(["record header truncated at 0x0"]);
  });

  it("flags every kind of problem", () => {
    expect(verifySubtitles("X.DLG", new Uint8Array(0))).toEqual(["no records"]);
    expect(ok({ w: 0, h: 1, px: [] })).toContain("record 0: empty picture 0x1");
    expect(ok({ w: 1, h: 1, first: 5, last: 5, px: [1] })).toContain("record 0: first 5 >= last 5");
    expect(ok({ w: 1, h: 1, x: 640, px: [1] })[0]).toMatch(/leaves the 640x480 screen/);
    expect(ok({ w: 1, h: 1, unk: 3, px: [1] })).toContain("record 0: unk 3 (documented as 0)");
    expect(ok({ w: 1, h: 1, px: [0] })).toContain("record 0: fully transparent");
  });

  it("flags INTRO pixel values and record order", () => {
    expect(verifySubtitles("INTRO.DLG", new Uint8Array(intro({ w: 1, h: 1, px: [77] })))).toContain(
      "record 0: pixel values other than 0, 128, 255",
    );
    const unsorted = [...intro({ w: 1, h: 1, seg: 2, px: [255] }), ...intro({ w: 1, h: 1, seg: 1, px: [255] })];
    expect(verifySubtitles("INTRO.DLG", new Uint8Array(unsorted))).toContain("records not sorted by (segment, first)");
    const sorted = [
      ...intro({ w: 1, h: 1, seg: 1, first: 1, last: 3, px: [255] }),
      ...intro({ w: 1, h: 1, seg: 1, first: 3, last: 9, px: [255] }),
    ];
    expect(verifySubtitles("INTRO.DLG", new Uint8Array(sorted))).toEqual([]);
  });
});

describe("SubtitleTrack (Media_DrawSubtitles state machine)", () => {
  const make = (recs: { first: number; last: number; seg?: number }[], isIntroLayout: boolean) =>
    new SubtitleTrack(
      recs.map((r) => ({
        ...r,
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        segment: isIntroLayout ? (r.seg ?? 0) : null,
        color: null,
        pixels: new Uint16Array([1]),
        unk: 0,
        rawValues: null,
      })),
      isIntroLayout,
    );

  it("shows from first up to, excluding, last (counter equality)", () => {
    const t = make([{ first: 3, last: 6 }], false);
    const seen = [1, 2, 3, 4, 5, 6, 7].map((f) => t.step(0, f) !== null);
    expect(seen).toEqual([false, false, true, true, true, false, false]);
  });

  it("switches directly when the next record starts on the previous one's last frame", () => {
    const t = make(
      [
        { first: 2, last: 4 },
        { first: 4, last: 6 },
      ],
      false,
    );
    expect(t.step(0, 2)!.first).toBe(2);
    expect(t.step(0, 4)!.first).toBe(4);
    expect(t.position).toBe(1);
  });

  it("ignores the segment outside INTRO: the counter restarts, the record index carries on", () => {
    const t = make(
      [
        { first: 2, last: 3 },
        { first: 2, last: 3 },
      ],
      false,
    );
    expect(t.step(0, 2)).not.toBeNull();
    expect(t.step(0, 3)).toBeNull();
    expect(t.step(1, 2)).not.toBeNull();
    expect(t.step(1, 3)).toBeNull();
    expect(t.step(2, 2)).toBeNull(); // out of records
  });

  it("requires the segment to match in INTRO", () => {
    const t = make([{ first: 2, last: 3, seg: 5 }], true);
    expect(t.step(4, 2)).toBeNull();
    expect(t.step(5, 2)).not.toBeNull();
    expect(t.step(4, 3)).not.toBeNull(); // wrong segment: not hidden yet
    expect(t.step(5, 3)).toBeNull();
  });

  it("stays visible if the end frame is never seen", () => {
    const t = make([{ first: 2, last: 4 }], false);
    t.step(0, 2);
    expect(t.step(0, 5)).not.toBeNull();
    expect(t.isVisible).toBe(true);
  });

  it("handles no subtitles", () => {
    expect(make([], false).step(0, 1)).toBeNull();
  });
});
