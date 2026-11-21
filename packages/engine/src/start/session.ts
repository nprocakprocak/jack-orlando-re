// What a host acquires for a running game (the loop, focus handlers, the AudioContext, the game).
// Register it here and release it in reverse order when the session ends.

export type Disposer = () => void | Promise<void>;

export class Disposables {
  private readonly list: { name: string; fn: Disposer }[] = [];

  add(name: string, fn: Disposer): void {
    this.list.push({ name, fn });
  }

  get size(): number {
    return this.list.length;
  }

  /**
 * Runs every disposer once, last added first. A failing one does not stop the rest; the failures are returned
 * as "name: message". Disposers added while disposing belong to the next round.
 */
  async dispose(): Promise<string[]> {
    const items = this.list.splice(0).reverse();
    const errors: string[] = [];
    for (const { name, fn } of items) {
      try {
        await fn();
      } catch (e) {
        errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return errors;
  }
}
