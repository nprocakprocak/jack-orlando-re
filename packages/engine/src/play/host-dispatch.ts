// SceneHost command dispatch. Each case calls the group that already owns that command.

import { WORDS, type Command, type CommandContext, type CommandResult } from "../script";
import { varIndex } from "./host";
import * as animBody from "./host-anim";
import * as areaBody from "./host-areas";
import * as filmBody from "./host-film";
import * as itemBody from "./host-items";
import * as objectBody from "./host-objects";
import * as personBody from "./host-persons";
import * as sceneBody from "./host-scene";
import * as shadowBody from "./host-shadow";
import * as soundBody from "./host-sound";
import type { HostState } from "./host-state";
import * as talkBody from "./host-talk";

export function run(this: HostState, cmd: Command, ctx: CommandContext): CommandResult {
  const self = this as unknown as HostState;
  switch (cmd.code) {
    case WORDS.SETPOSITION:
    case WORDS.SETPERSONDATA:
    case WORDS.SETPERSPY:
    case WORDS.MOVEP:
      return personBody.run.call(self, cmd, ctx);
    case WORDS.WALKTO: // WALKTO person x y
    case WORDS.WALKTODIR: // WALKTODIR person x y dir
      return personBody.walkTo.call(self, cmd, ctx, cmd.code === WORDS.WALKTODIR ? cmd.a[2] : null);
    case WORDS.INITFIRST: // INITFIRST person insertion dir
    case WORDS.RUNINSERTION: // RUNINSERTION person insertion f dir
      return personBody.insertion.call(self, cmd, ctx);
    case WORDS.HIDE:
    case WORDS.STAY:
    case WORDS.STAYDEF:
    case WORDS.SETFRAME:
    case WORDS.SHOWFRAME:
    case WORDS.SETDIRWALK:
    case WORDS.SETCHKPRIOR:
    case WORDS.CHKDISTANCE:
      return personBody.run.call(self, cmd, ctx);
    case WORDS.SETSHADOW:
    case WORDS.MINSHADOW:
    case WORDS.MAXSHADOW:
    case WORDS.SHIFTSHADOWP:
    case WORDS.SETSPECSHADOW:
    case WORDS.SHOWSHADOW:
    case WORDS.SHADOWSTATUS:
    case WORDS.HIDESHADOW:
    case WORDS.SHADOWBY:
    case WORDS.PUTSHADOW:
    case WORDS.ANIMASHADOW:
    case WORDS.SHADOWONE:
      return shadowBody.run.call(self, cmd);
    case WORDS.LOOKTO:
    case WORDS.ROTATETO:
      return personBody.run.call(self, cmd, ctx);
    case WORDS.GETPERSONX: // GETPERSONX
    case WORDS.GETPERSONY: // GETPERSONY
      return personBody.getPersonCoord.call(self, cmd, ctx);
    case WORDS.JACKTEMPO:
    case WORDS.LOCKWALK:
    case WORDS.UNLOCKWALK:
      return personBody.run.call(self, cmd, ctx);
    case WORDS.HAVEGUN:
    case WORDS.NOHAVEGUN:
    case WORDS.TAKE:
      return itemBody.run.call(self, cmd, ctx);
    case WORDS.NOHAVE: // NOHAVE
    case WORDS.HAVETOOL: // HAVETOOL object
    case WORDS.NOHAVETOOL: // NOHAVETOOL name
    case WORDS.MOUSETOTOOL: // MOUSETOTOOL
    case WORDS.ITEMPRESENT: // ITEMPRESENT name var
      return itemBody.itemCommand.call(self, cmd, ctx);
    case WORDS.CLEARMENUBAR:
      return itemBody.run.call(self, cmd, ctx);
    case WORDS.SETPOSITIONE: // SETPOSITIONE object x y
    case WORDS.SETPOSITIONEV: // SETPOSITIONEV
      return objectBody.setObjectPosition.call(self, cmd, ctx);
    case WORDS.MOVEE:
      return objectBody.run.call(self, cmd);
    case WORDS.PUNDERE: // PUNDERE person object
    case WORDS.POVERE: // POVERE
      return objectBody.placeAgainst.call(self, cmd);
    case WORDS.PUNDERP:
    case WORDS.EOVERE:
    case WORDS.CHWINDOW:
      return objectBody.run.call(self, cmd);
    case WORDS.PICKUP: // PICKUP n
    case WORDS.GIVE: // GIVE n
    case WORDS.SHOOTF: // SHOOTF n
    case WORDS.SLAPF: // SLAPF n
      return this.gesture(cmd, ctx);
    case WORDS.SHOWANIMAFRAME:
    case WORDS.SETDARKNESSANIMA:
      return animBody.run.call(self, cmd, ctx);
    case WORDS.BRIGHTNESSE:
      return objectBody.run.call(self, cmd);
    case WORDS.CLEARANIMABUFFER:
      return animBody.run.call(self, cmd, ctx);
    case WORDS.MOVEEP:
      return objectBody.run.call(self, cmd);
    case WORDS.RELATIVEMULP:
      return personBody.run.call(self, cmd, ctx);
    case WORDS.HIDEE:
    case WORDS.SHOWE:
      return objectBody.run.call(self, cmd);
    case WORDS.ANIMA:
    case WORDS.STOPANIMA:
    case WORDS.CONTINUEANIMA:
    case WORDS.STOPANIMANEG:
    case WORDS.SETANIMAFRAME:
    case WORDS.WAITWHILEANIMA:
    case WORDS.WAITTOANIMAFRAME:
    case WORDS.ANIMADELAY:
      return animBody.run.call(self, cmd, ctx);
    case WORDS.SETPOSSCROLL:
    case WORDS.POINTROTATE:
    case WORDS.SAVEABLE:
      return sceneBody.run.call(self, cmd);
    case WORDS.ACTIVEMACROANIMA:
      return animBody.run.call(self, cmd, ctx);
    case WORDS.PAUSE: // PAUSE
      return "unhandled";
    case WORDS.TALK: // TALK
    case WORDS.TALKRANDOM: // TALKRANDOM
    case WORDS.TALKRANDOMINDEX: // TALKRANDOMINDEX
      return talkBody.talk.call(self, cmd, ctx);
    case WORDS.SHOWFACE:
    case WORDS.HIDEFACE:
    case WORDS.HIDEFACEAT:
    case WORDS.SETDIALOG:
      return talkBody.run.call(self, cmd, ctx);
    case WORDS.EXTRA:
      return itemBody.run.call(self, cmd, ctx);
    case WORDS.SETPOSXY:
      return talkBody.run.call(self, cmd, ctx);
    case WORDS.EFFECT: // EFFECT
    case WORDS.EFFECTVOLUME: // EFFECTVOLUME
    case WORDS.WAITWHILEEFFECT: // WAITWHILEEFFECT
    case WORDS.UNLOCKCANAL: // UNLOCKCANAL
    case WORDS.WALKEFFECT: // WALKEFFECT
    case WORDS.ANIMAEFFECT: // ANIMAEFFECT
      return soundBody.sound.call(self, cmd, ctx);
    case WORDS.MUSIC:
    case WORDS.MUSICVOLUME:
      return soundBody.run.call(self, cmd, ctx);
    case WORDS.RUNFILMP:
    case WORDS.RUNGLOBALFILMP:
    case WORDS.RUNAVX:
      return filmBody.run.call(self, cmd, ctx);
    case WORDS.SETSHIFTX:
    case WORDS.SCROLLLEFT:
    case WORDS.SCROLLRIGHT:
    case WORDS.SETSCROLLX1:
    case WORDS.SETSCROLLX2:
    case WORDS.SCROLLMARGINL:
    case WORDS.SCROLLMARGINR:
    case WORDS.SETSCROLL:
    case WORDS.BRIGHTNESS:
      return sceneBody.run.call(self, cmd);
    case WORDS.SETAREA:
    case WORDS.SETSPECAREA:
    case WORDS.IGNOREAREA:
      return areaBody.apply.call(self, cmd);
    case WORDS.PINAREA:
    case WORDS.POINTINSECAREA:
    case WORDS.POINTINWALKAREA:
      return areaBody.run.call(self, cmd, ctx);
    case WORDS.DIALOG:
      return talkBody.run.call(self, cmd, ctx);
    case WORDS.REFRESHSCREEN:
    case WORDS.GOTOSCENE:
    case WORDS.MACRODESTRUCTOR:
      return sceneBody.run.call(self, cmd);
    case WORDS.AUTOINCRANGE: {
      // AUTOINCRANGE var min max (case 0x5b): the interpreter set `var = min`; the clock takes the range
      const i = varIndex(this.interpreter.vars, cmd.n1);
      if (i >= 0) this.env.autoInc?.start(i, cmd.a[0], cmd.a[1]);
      return "done";
    }
    default:
      return "unhandled";
  }
}
