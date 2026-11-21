import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, defaultConfig, sanitizeConfig } from "./config";
import { ConfigStore, STORAGE_KEY, type KeyValueStorage } from "./store";
import { copyStereo, stereoMatrix } from "./stereo";

function fakeStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

describe("config", () => {
  it("has the defaults of Sys_InitConfigAndCd", () => {
    expect(DEFAULT_CONFIG).toMatchObject({ walkSpeed: 1, musicVol: 0x23, sfxVol: 0x20, talkVol: 0x40, reverseStereo: 0, surround: 1, musicDown: 1, talkInterrupt: 1, showText: 1, showBullet: 1 });
  });
  it("defaultConfig returns a copy", () => {
    const c = defaultConfig();
    c.walkSpeed = 5;
    expect(DEFAULT_CONFIG.walkSpeed).toBe(1);
  });
  it("clamps out-of-range values and ignores junk", () => {
    const c = sanitizeConfig({ walkSpeed: 99, musicVol: -4, sfxVol: 12.9, talkVol: "x", surround: 7, bogus: 1 });
    expect(c).toMatchObject({ walkSpeed: 6, musicVol: 0, sfxVol: 12, talkVol: 0x40, surround: 1 });
    expect(c).not.toHaveProperty("bogus");
  });
  it("falls back to defaults for non-objects", () => {
    expect(sanitizeConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(sanitizeConfig(42)).toEqual(DEFAULT_CONFIG);
  });
});

describe("ConfigStore", () => {
  it("saves and loads", () => {
    const st = fakeStorage();
    const store = new ConfigStore(st);
    const c = defaultConfig();
    c.walkSpeed = 4;
    c.musicVol = 10;
    expect(store.save(c)).toBe(true);
    expect(JSON.parse(st.data[STORAGE_KEY]).walkSpeed).toBe(4);
    expect(new ConfigStore(st).load()).toMatchObject({ walkSpeed: 4, musicVol: 10 });
  });
  it("loads defaults when empty or broken", () => {
    expect(new ConfigStore(fakeStorage()).load()).toEqual(DEFAULT_CONFIG);
    expect(new ConfigStore(fakeStorage({ [STORAGE_KEY]: "{oops" })).load()).toEqual(DEFAULT_CONFIG);
  });
  it("works without storage", () => {
    const store = new ConfigStore(null);
    expect(store.load()).toEqual(DEFAULT_CONFIG);
    expect(store.save(defaultConfig())).toBe(false);
  });
  it("survives a throwing storage", () => {
    const bad: KeyValueStorage = {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("quota"); },
    };
    const store = new ConfigStore(bad);
    expect(store.load()).toEqual(DEFAULT_CONFIG);
    expect(store.save(defaultConfig())).toBe(false);
  });
});

describe("stereo (Snd_CopyStereo)", () => {
  const src = Int16Array.of(100, -200, -32768, 32767);
  it("is the identity without options", () => {
    expect(stereoMatrix(false, false)).toEqual({ ll: 1, lr: 0, rl: 0, rr: 1 });
    expect([...copyStereo(src, false, false)]).toEqual([...src]);
  });
  it("surround inverts the phase of the left channel", () => {
    expect([...copyStereo(Int16Array.of(100, -200), true, false)]).toEqual([-100, -200]);
  });
  it("reverse swaps the channels", () => {
    expect([...copyStereo(Int16Array.of(100, -200), false, true)]).toEqual([-200, 100]);
  });
  it("both: L' = R, R' = -L", () => {
    expect([...copyStereo(Int16Array.of(100, -200), true, true)]).toEqual([-200, -100]);
  });
  it("-(-32768) wraps like int16", () => {
    expect(copyStereo(Int16Array.of(-32768, 1), true, false)[0]).toBe(-32768);
  });
  it("ignores a dangling odd sample", () => {
    expect(copyStereo(Int16Array.of(1, 2, 3), false, false).length).toBe(3);
  });
});
