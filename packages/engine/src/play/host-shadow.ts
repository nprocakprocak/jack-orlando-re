// Shadow commands: persons, Jack, and shadows baked into the background.

import type { Command, CommandResult } from "../script";
import type { HostState } from "./host-state";

export function run(this: HostState, cmd: Command): CommandResult {
    const sc = this.env.scene;
    const a = cmd.a;
    const isJack = cmd.n1 === "JACK";
    const person = (): number => sc.persons.find(cmd.n1);
    switch (cmd.code) {
      // -- shadows: the state and the drawing are the scene's
      case 0x13: // SETSHADOW person n
        if (!isJack && person() < 0) return "unhandled";
        sc.setShadow(isJack ? null : person(), a[0]);
        return "done";
      case 0x8b: // MINSHADOW person n [which]: Jack's second shadow with which = 1
        if (!isJack && person() < 0) return "unhandled";
        sc.fadeShadowOut(isJack ? null : person(), a[0], a[2]);
        return "done";
      case 0x8c: // MAXSHADOW person n [which]
        if (!isJack && person() < 0) return "unhandled";
        sc.fadeShadowIn(isJack ? null : person(), a[0], a[2]);
        return "done";
      case 0x8f: { // SHIFTSHADOWP person dx dy
        const p = sc.persons.get(cmd.n1);
        if (!p) return "unhandled";
        p.shadowDx = a[1];
        p.shadowDy = a[2];
        return "done";
      }
      case 0x9a: { // SETSPECSHADOW person object: both names are read into n1, the person stays in the refs
        const who = sc.persons.find((cmd.refs.find((r) => r[1] === "person")?.[2] as string | undefined) ?? "");
        return who >= 0 && sc.setSpecShadow(who, cmd.n1) ? "done" : "unhandled";
      }
      case 0x9b: // SHOWSHADOW person x y scale (EXTRA = -1: the extra sprite's shadow)
        if (a[0] < 0) {
          sc.showExtraShadow(a[1], a[2], cmd.f ?? 1);
          return "done";
        }
        if (person() < 0) return "unhandled";
        sc.showShadow(person(), a[1], a[2], cmd.f ?? 1);
        return "done";
      case 0x9c: // SHADOWSTATUS person 0|1
        if (person() < 0) return "unhandled";
        sc.setShadowStatus(person(), a[1] === 1);
        return "done";
      case 0x9d: // HIDESHADOW person
        if (a[0] < 0) {
          sc.showExtraShadow(0, 500, 1);
          return "done";
        }
        if (person() < 0) return "unhandled";
        sc.hideShadow(person());
        return "done";
      // -- shadows of objects
      case 0x12: // SHADOWBY object dx dy level: the object's image baked into the background as a shadow
        return sc.shadowBy(cmd.n1, a[0], a[1], a[2]) ? "done" : "unhandled";
      case 0x8d: // PUTSHADOW x y f: the round shadow baked into the background
        sc.putShadowOnBackground(a[0], a[1], cmd.f ?? 1);
        return "done";
      case 0x8e: { // ANIMASHADOW anim person shadow|NULL n: Jack's shadow follows the points while the FLX anim runs
        const anim = cmd.refs.find((r) => r[1] === "anim")?.[2] as string | undefined;
        const shadow = cmd.n1 === "NULL" ? null : /^SHAD(\d+)$/.exec(cmd.n1)?.[1];
        if (!anim || shadow === undefined) return "unhandled";
        return sc.setAnimShadow(anim, a[1] === 0x66 ? null : a[1], shadow === null ? null : Number(shadow), a[3] !== 0) ? "done" : "unhandled";
      }
      case 0x9e: // SHADOWONE object: persons' shadows are composed with the sprites up to the object's layer
        return sc.setShadowOne(cmd.n1) ? "done" : "unhandled";
      default:
        return "unhandled";
    }
}
