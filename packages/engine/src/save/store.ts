// The virtual SAVEGAME directory: an async file store with Windows-like names (case-insensitive, listing sorted).
// Logic talks to `SaveStore` only; the browser implementation is IndexedDB, tests use `MemoryStore`.

export interface SaveStore {
  /** file names as written (original case), sorted case-insensitively like an NTFS listing */
  list(): Promise<string[]>;
  read(name: string): Promise<Uint8Array | null>;
  write(name: string, data: Uint8Array): Promise<void>;
  remove(name: string): Promise<void>;
}

const key = (name: string) => name.toLowerCase();
const byName = (a: string, b: string) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);

export class MemoryStore implements SaveStore {
  private readonly files = new Map<string, { name: string; data: Uint8Array }>();

  async list(): Promise<string[]> {
    return [...this.files.values()].map((f) => f.name).sort(byName);
  }
  async read(name: string): Promise<Uint8Array | null> {
    const f = this.files.get(key(name));
    return f ? f.data.slice() : null;
  }
  async write(name: string, data: Uint8Array): Promise<void> {
    this.files.set(key(name), { name, data: data.slice() });
  }
  async remove(name: string): Promise<void> {
    this.files.delete(key(name));
  }
}

export const IDB_NAME = "jack-orlando-save";
/** object stores: the virtual SAVEGAME directory and the legacy slots */
export const IDB_SAVEGAME = "SAVEGAME";
export const IDB_SLOTS = "SLOTS";

/** One object store of the IndexedDB database `jack-orlando-save` (key = lower-case name, value = {name, data}). */
export class IdbStore implements SaveStore {
  private db: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly storeName: string = IDB_SAVEGAME,
    private readonly factory: IDBFactory = indexedDB,
    private readonly dbName: string = IDB_NAME,
  ) {}

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = this.factory.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        for (const s of [IDB_SAVEGAME, IDB_SLOTS]) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  }

  private async run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = f(db.transaction(this.storeName, mode).objectStore(this.storeName));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async list(): Promise<string[]> {
    const all = await this.run("readonly", (s) => s.getAll() as IDBRequest<{ name: string }[]>);
    return all.map((f) => f.name).sort(byName);
  }
  async read(name: string): Promise<Uint8Array | null> {
    const f = await this.run("readonly", (s) => s.get(key(name)) as IDBRequest<{ data: Uint8Array } | undefined>);
    return f ? f.data.slice() : null;
  }
  async write(name: string, data: Uint8Array): Promise<void> {
    await this.run("readwrite", (s) => s.put({ name, data: data.slice() }, key(name)));
  }
  async remove(name: string): Promise<void> {
    await this.run("readwrite", (s) => s.delete(key(name)));
  }
}
