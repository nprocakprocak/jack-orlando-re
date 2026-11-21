import { describe, expect, it } from "vitest";
import type { WalkObject } from "../walk/objects";
import { arrangePerson, behindByY, personObjectDepth } from "./depth";

describe("drawing order", () => {
  const quad: WalkObject = {
    x: 100,
    y: 100,
    quad: [0, 0, 100, 0, 100, 50, 0, 50],
    center: [50, 25],
    valid: true,
  };

  it("compares feet by y", () => {
    expect(behindByY(10, 20)).toBe("behind");
    expect(behindByY(20, 10)).toBe("front");
    expect(behindByY(10, 10)).toBeNull();
  });

  it("object quads: above the floor edge = behind, below = in front, inside = unchanged", () => {
    expect(personObjectDepth(quad, 150, 80)).toBe("behind");
    expect(personObjectDepth(quad, 150, 200)).toBe("front");
    expect(personObjectDepth(quad, 150, 125)).toBeNull();
  });

  it("moves the person to the other sprite's slot only when the order is wrong", () => {
    const list = ["bg", "JACK", "P", "OBJ"];
    expect(arrangePerson(list, "P", 0, 10, [{ id: "JACK", kind: "jack", y: 20 }])).toEqual(["bg", "P", "JACK", "OBJ"]);
    expect(arrangePerson(list, "P", 0, 30, [{ id: "JACK", kind: "jack", y: 20 }])).toEqual(list);
    expect(arrangePerson(list, "P", 150, 200, [{ id: "OBJ", kind: "object", object: quad }])).toEqual([
      "bg",
      "JACK",
      "OBJ",
      "P",
    ]);
    expect(arrangePerson(list, "P", 150, 80, [{ id: "OBJ", kind: "object", object: quad }])).toEqual(list);
    // unknown ids and the person itself are ignored; equal y changes nothing
    expect(
      arrangePerson(list, "P", 0, 10, [
        { id: "ZZZ", kind: "person", y: 99 },
        { id: "P", kind: "person", y: 99 },
      ]),
    ).toEqual(list);
    expect(arrangePerson(list, "P", 0, 20, [{ id: "JACK", kind: "jack", y: 20 }])).toEqual(list);
  });
});
