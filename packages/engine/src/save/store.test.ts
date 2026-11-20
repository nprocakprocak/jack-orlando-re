// IdbStore against an in-memory IDBFactory. No browser database.
import { describe, expect, it } from "vitest";
import { IDB_NAME, IDB_SAVEGAME, IDB_SLOTS, IdbStore } from "./store";

interface Row {
  name: string;
  data: Uint8Array;
}

class MemDb {
  readonly stores = new Map<string, Map<string, Row>>();
  readonly created: string[] = [];
  readonly objectStoreNames = { contains: (name: string) => this.stores.has(name) };

  createObjectStore(name: string): void {
    this.created.push(name);
    this.stores.set(name, new Map());
  }

  transaction(name: string): { objectStore: () => MemStore } {
    const map = this.stores.get(name);
    if (!map) throw new Error(`no store ${name}`);
    return { objectStore: () => new MemStore(map) };
  }
}

class MemStore {
  constructor(private readonly map: Map<string, Row>) {}

  get(key: string): MemRequest {
    return MemRequest.of(this.map.get(key));
  }
  getAll(): MemRequest {
    return MemRequest.of([...this.map.values()]);
  }
  put(value: Row, key: string): MemRequest {
    this.map.set(key, value);
    return MemRequest.of(undefined);
  }
  delete(key: string): MemRequest {
    this.map.delete(key);
    return MemRequest.of(undefined);
  }
}

/** Fires onsuccess on a later turn, after the caller assigns the handler. */
class MemRequest {
  result: unknown;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  constructor(result: unknown) {
    this.result = result;
  }
  static of(result: unknown): MemRequest {
    const req = new MemRequest(result);
    queueMicrotask(() => req.onsuccess?.());
    return req;
  }
}

function memoryIdb(): { factory: IDBFactory; dbs: Map<string, MemDb> } {
  const dbs = new Map<string, MemDb>();
  const factory = {
    open(name: string): IDBOpenDBRequest {
      const req = new MemRequest(undefined);
      queueMicrotask(() => {
        let db = dbs.get(name);
        if (!db) {
          db = new MemDb();
          dbs.set(name, db);
          req.result = db;
          req.onupgradeneeded?.();
        }
        req.result = db;
        req.onsuccess?.();
      });
      return req as unknown as IDBOpenDBRequest;
    },
  };
  return { factory: factory as unknown as IDBFactory, dbs };
}

describe("IdbStore", () => {
  it("writes, reads a copy under another case, lists in order, and removes", async () => {
    const { factory, dbs } = memoryIdb();
    const store = new IdbStore(IDB_SAVEGAME, factory, IDB_NAME);
    const bytes = new Uint8Array([1, 2, 3]);
    await store.write("Note.bin", bytes);
    await store.write("b.dat", new Uint8Array([9]));
    const read = await store.read("NOTE.BIN");
    expect(read).toEqual(bytes);
    expect(read).not.toBe(bytes);
    read![0] = 0;
    expect(await store.read("note.bin")).toEqual(bytes);
    expect(await store.list()).toEqual(["b.dat", "Note.bin"]);
    await store.remove("NOTE.BIN");
    expect(await store.read("Note.bin")).toBeNull();
    expect(dbs.get(IDB_NAME)?.created).toEqual([IDB_SAVEGAME, IDB_SLOTS]);
  });

  it("opens the slot store created by the same upgrade", async () => {
    const { factory } = memoryIdb();
    const slots = new IdbStore(IDB_SLOTS, factory, IDB_NAME);
    await slots.write("Slot.00", new Uint8Array([4]));
    expect(await slots.read("slot.00")).toEqual(new Uint8Array([4]));
  });
});
