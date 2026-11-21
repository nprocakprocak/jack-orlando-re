// Scene logic without DOM: stay facings, click hits and window clips on invented state.
import { describe, expect, it } from "vitest";
import { Renderer, createSurface } from "../render";
import { ScenePlayer } from "./player";

describe("CHWINDOW clip (synthetic)", () => {
  const clip = { left: 10, top: 20, right: 300, bottom: 400 };

  function shell(over: Record<string, unknown> = {}) {
    const img = createSurface(2, 2);
    const renderer = new Renderer(createSurface(32, 32));
    const jackId = renderer.add(img, 5);
    const shadowIds = [renderer.add(img, 0), renderer.add(img, 0)];
    const p = Object.assign(Object.create(ScenePlayer.prototype), {
      jackId,
      shadowIds,
      renderer,
      ticks: 1,
      objectByName: new Map(),
      persons: { find: () => -1 },
      personIds: [] as number[],
      personShadowIds: [] as number[],
      ...over,
    });
    return { p, renderer, jackId, shadowIds, img };
  }

  it("JACK clips Jack and both shadows; the rectangle is a copy and survives a move in the list", () => {
    const { p, renderer, jackId, shadowIds, img } = shell();
    const other = renderer.add(img, 3);
    expect(p.setClip("JACK", clip)).toBe(true);
    for (const id of [jackId, ...shadowIds]) expect(renderer.sprite(id)!.clip).toEqual(clip);
    expect(renderer.sprite(jackId)!.clip).not.toBe(clip);
    renderer.placeUnder(jackId, other);
    expect(renderer.sprite(jackId)!.clip).toEqual(clip);
    expect(p.setClip("NOPE", clip)).toBe(false);
  });

  it("a person name clips that person and their shadow, not another sprite", () => {
    const { p, renderer, img } = shell();
    const bob = renderer.add(img, 2);
    const bobShadow = renderer.add(img, 0);
    const other = renderer.add(img, 4);
    p.persons = { find: (n: string) => (n === "BOB" ? 0 : -1) };
    p.personIds = [bob];
    p.personShadowIds = [bobShadow];
    expect(p.setClip("BOB", clip)).toBe(true);
    expect(renderer.sprite(bob)!.clip).toEqual(clip);
    expect(renderer.sprite(bobShadow)!.clip).toEqual(clip);
    expect(renderer.sprite(other)!.clip).not.toEqual(clip);
  });
});
