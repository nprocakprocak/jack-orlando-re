// The camera, the scroll points, and the commands that leave the scene.

import type { Command, CommandResult } from "../script";
import { gotoSceneName } from "../script";
import { setPointRotate } from "../walk/turn";
import type { HostState } from "./host-state";

export function run(this: HostState, cmd: Command): CommandResult {
    const sc = this.env.scene;
    const a = cmd.a;
    switch (cmd.code) {
      case 0x96: // SETPOSSCROLL L|R x y (a[2] = 0 for L)
        this.scrollPoints[a[2] === 0 ? "L" : "R"] = { x: a[0], y: a[1] };
        return "done";
      case 0x6d: // POINTROTATE n
        this.pointRotate = a[0];
        setPointRotate(this.env.scene.tj, a[0] !== 0);
        return "done";
      case 0xa1: // SAVEABLE n
        this.saveable = a[0] !== 0;
        return "done";
      // -- camera
      case 0x2b: // SETSHIFTX
        sc.setScroll(a[0]);
        return "done";
      case 0x2f: // SCROLLLEFT
        sc.scrollDir = -1;
        return "done";
      case 0x30: // SCROLLRIGHT
        sc.scrollDir = 1;
        return "done";
      case 0x31: // SETSCROLLX1
        sc.setScrollLimits(a[0], null);
        return "done";
      case 0x32: // SETSCROLLX2
        sc.setScrollLimits(null, a[0]);
        return "done";
      case 0x57: // SCROLLMARGINL
        sc.marginL = a[0];
        return "done";
      case 0x58: // SCROLLMARGINR
        sc.marginR = a[0];
        return "done";
      case 0x99: // SETSCROLL
        sc.bgWide = a[0] !== 0;
        return "done";
      case 0x36: // BRIGHTNESS
        sc.brightness = cmd.f ?? 1;
        return "done";
      // -- scene
      case 0x81: // REFRESHSCREEN
        this.env.requestFade();
        return "done";
      case 0x14: // GOTOSCENE
        this.env.gotoScene(gotoSceneName(cmd.n1));
        return "done";
      case 0x78: // MACRODESTRUCTOR is bookkeeping in the interpreter
        return "done";
      default:
        return "unhandled";
    }
}
