// Music at loading a save: Save_LoadState stops the music for another track, Scene_SetNumberAndMapFlag
// starts the saved track when the scene is loaded. Own data only: a tiny .PMS built here and the TimedBackend (no game files).
import { describe, expect, it } from "vitest";
import { TimedBackend } from "../play/testing";
import { gameVolumeToLevel, Mixer, MUSIC_CHANNEL } from "./index";
import { MusicPlayer } from "./music";

/** A .PMS of 80 frames: 24-byte codec header + 20 words of zeros. */
function pms(): Uint8Array {
  const out = new Uint8Array(24 + 80);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x33, true);
  v.setUint32(4, 80, true);
  v.setUint32(8, 320, true);
  return out;
}

function setup(opts: { enabled?: boolean } = {}) {
  const backend = new TimedBackend();
  const mixer = new Mixer(backend);
  const music = new MusicPlayer(mixer, { musicVolume: 40, ...opts });
  const files = new Map<string, Uint8Array>([["ARREST.PMS", pms()], ["STREET.PMS", pms()], ["OFFICE.PMS", pms()]]);
  /** What PlayGame.applyLoaded + enter do: remember the saved track, then start it before the scene's scripts. */
  const load = (saved: string) => {
    music.loadSaved(saved);
    const pending = music.pendingSavedTrack;
    music.startSaved(pending ? files.get(pending) : undefined);
  };
  const live = () => backend.voices.filter((v) => v.kind === "stream" && !v.stopped);
  return { backend, mixer, music, load, live, files };
}

describe("music at loading", () => {
  it("another track: the old one stops, the saved one starts from the beginning at full volume (no audible fade-in)", () => {
    const t = setup();
    t.music.play("STREET.PMS", t.files.get("STREET.PMS")!, 0); // SC011
    t.backend.advance(0.1);
    t.load("ARREST.PMS"); // save of SC026
    expect(t.music.trackName).toBe("ARREST.PMS");
    expect(t.live()).toHaveLength(1);
    expect(t.backend.voices.filter((v) => v.kind === "stream")).toHaveLength(2);
    expect(t.mixer.isPlaying(MUSIC_CHANNEL)).toBe(true);
    t.music.tick14ms();
    expect(t.mixer.level(MUSIC_CHANNEL)).toBe(gameVolumeToLevel(t.music.musicVolume)); // first tick: full level
  });

  it("the same track plays on: no stop, no restart", () => {
    const t = setup();
    t.music.play("ARREST.PMS", t.files.get("ARREST.PMS")!, 0);
    const before = t.backend.voices.length;
    t.load("ARREST.PMS");
    expect(t.backend.voices).toHaveLength(before);
    expect(t.backend.voices[0].stopped).toBe(false);
  });

  it("several loads in a row: every one ends with the track of its save (the old code left silence)", () => {
    const t = setup();
    t.music.play("STREET.PMS", t.files.get("STREET.PMS")!, 0);
    for (const name of ["ARREST.PMS", "OFFICE.PMS", "ARREST.PMS", "STREET.PMS", "STREET.PMS", "ARREST.PMS"]) {
      t.load(name);
      expect(t.music.trackName).toBe(name);
      expect(t.live()).toHaveLength(1);
      expect(t.mixer.isPlaying(MUSIC_CHANNEL)).toBe(true);
    }
  });

  it("a second load before the first track started asks for the track about to play, not the stale name", () => {
    const t = setup();
    t.music.play("STREET.PMS", t.files.get("STREET.PMS")!, 0);
    t.music.loadSaved("ARREST.PMS"); // enter has not reached the start yet
    t.music.loadSaved("STREET.PMS"); // loads the first save again: differs from the pending name -> switches back
    expect(t.music.pendingSavedTrack).toBe("STREET.PMS");
    t.music.startSaved(t.files.get("STREET.PMS"));
    expect(t.music.trackName).toBe("STREET.PMS");
    expect(t.live()).toHaveLength(1);
    // the pending name is used once
    expect(t.music.pendingSavedTrack).toBeNull();
  });

  it("loading right after the game started (nothing played yet): the saved track starts", () => {
    const t = setup();
    expect(t.music.trackName).toBe("");
    t.load("ARREST.PMS");
    expect(t.live()).toHaveLength(1);
    expect(t.music.trackName).toBe("ARREST.PMS");
  });

  it("the scene's own MUSIC command for the saved track does nothing more (same name); another one switches", () => {
    const t = setup();
    t.load("ARREST.PMS");
    const n = t.backend.voices.length;
    expect(t.music.command("ARREST.PMS", 0, 1, () => t.files.get("ARREST.PMS")!)).toBe("done");
    expect(t.backend.voices).toHaveLength(n);
    expect(t.music.command("OFFICE.PMS", 0, 1, () => t.files.get("OFFICE.PMS")!)).toBe("done");
    expect(t.music.trackName).toBe("OFFICE.PMS");
    expect(t.live()).toHaveLength(1);
  });

  it("a missing file: silence but the name is remembered; empty name: silence", () => {
    const t = setup();
    t.music.play("STREET.PMS", t.files.get("STREET.PMS")!, 0);
    t.load("NOFILE.PMS");
    expect(t.live()).toHaveLength(0);
    expect(t.music.trackName).toBe("NOFILE.PMS");
    t.load("");
    expect(t.live()).toHaveLength(0);
    expect(t.music.trackName).toBe("");
    t.load("ARREST.PMS"); // and back to a real track
    expect(t.live()).toHaveLength(1);
  });

  it("without music (disabled) a load does nothing", () => {
    const t = setup({ enabled: false });
    t.load("ARREST.PMS");
    expect(t.backend.voices).toHaveLength(0);
    expect(t.music.trackName).toBe("");
  });
});
