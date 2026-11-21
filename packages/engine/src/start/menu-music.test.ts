import { describe, expect, it } from "vitest";
import { MenuMusic } from "./menu-music";

function make() {
  const log: string[] = [];
  const m = new MenuMusic(
    {
      play: (n, b) => log.push(`play ${n} ${b.length}`),
      stop: () => log.push("stop"),
      setLevel: (l) => log.push(`level ${l}`),
    },
    (v) => v * 2,
  );
  return { m, log };
}

describe("MenuMusic", () => {
  it("plays a preloaded track and maps the volume to the channel level", async () => {
    const { m, log } = make();
    expect(await m.preload("TR02-22.PMS", async (rel) => (rel === "Music/TR02-22.PMS" ? new Uint8Array(3) : Promise.reject(new Error("x"))))).toBe(true);
    m.handle({ op: "stop" });
    m.handle({ op: "start", file: "TR02-22.PMS" });
    m.handle({ op: "volume", value: 5 });
    expect(log).toEqual(["stop", "play TR02-22.PMS 3", "level 10"]);
  });

  it("a track that cannot be loaded plays nothing", async () => {
    const { m, log } = make();
    expect(await m.preload("TR02-22.PMS", () => Promise.reject(new Error("missing")))).toBe(false);
    m.handle({ op: "start", file: "TR02-22.PMS" });
    expect(log).toEqual([]);
  });

  it("preloads once", async () => {
    const { m } = make();
    let reads = 0;
    const read = async () => (reads++, new Uint8Array(1));
    await m.preload("A", read);
    await m.preload("A", read);
    expect(reads).toBe(1);
  });
});
