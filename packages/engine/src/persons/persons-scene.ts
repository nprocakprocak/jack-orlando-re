// Every person in a scene, ticked together.

import { MAX_PERSONS, type PersonDef, type PersonEnv, type PersonOptions, type PersonUpdate } from "./persons";
import { ScenePerson } from "./persons-actor";

function merge(a: PersonUpdate, b: PersonUpdate): PersonUpdate {
  return {
    sprite: b.sprite ?? a.sprite,
    sounds: [...a.sounds, ...b.sounds],
    shadow: b.shadow !== undefined ? b.shadow : a.shadow,
    events: [...a.events, ...b.events],
  };
}

/** All persons of a scene, ticked like Game_Run: every walking part first, then every insertion part. */
export class ScenePersons {
  readonly persons: ScenePerson[];
  private byName = new Map<string, number>();

  constructor(defs: readonly PersonDef[], opts: PersonOptions) {
    if (defs.length > MAX_PERSONS) throw new Error(`${defs.length} persons, the game has room for ${MAX_PERSONS}`);
    this.persons = defs.map((d) => new ScenePerson(d, opts));
    // Script_FindPerson returns the FIRST person of that name: SC083's .PCS has two GANGSTER sections
    defs.forEach((d, i) => {
      if (!this.byName.has(d.name)) this.byName.set(d.name, i);
    });
  }

  /** Script_FindPerson: index of the first person with that name, -1 when missing. */
  find(name: string): number {
    return this.byName.get(name) ?? -1;
  }

  get(name: string): ScenePerson | undefined {
    const i = this.find(name);
    return i < 0 ? undefined : this.persons[i];
  }

  /** One 15 ms tick: timers, walking steps, insertion steps. Result index = person index. */
  tick(env: PersonEnv): (PersonUpdate | null)[] {
    const res: (PersonUpdate | null)[] = this.persons.map(() => null);
    for (const p of this.persons) p.countdown();
    this.persons.forEach((p, i) => {
      if (p.walkDue) res[i] = p.walkStep(env);
    });
    this.persons.forEach((p, i) => {
      if (!p.insertionDue) return;
      const u = p.insertionStep(env);
      const prev = res[i];
      res[i] = prev ? merge(prev, u) : u;
    });
    return res;
  }
}
