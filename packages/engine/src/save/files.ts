// Save/open windows of the system (the original's GetSaveFileNameA / GetOpenFileNameA).
// Chromium: File System Access API. Firefox/Safari: <input type=file> and a download. Logic works on an injected `env`.

export interface OpenedFile {
  name: string;
  data: Uint8Array;
}

export interface FilePicker {
  /** Save window. `false` = cancelled. */
  save(data: Uint8Array, suggestedName: string, light: boolean): Promise<boolean>;
  /** Open window. `null` = cancelled. */
  open(light: boolean): Promise<OpenedFile | null>;
}

/** Subset of the browser API the picker uses (`window` fits; tests pass a fake). */
export interface PickerEnv {
  showSaveFilePicker?: (o: unknown) => Promise<FileHandleLike>;
  showOpenFilePicker?: (o: unknown) => Promise<FileHandleLike[]>;
  /** fallback: build an <input type=file> and resolve with the chosen file (null = cancelled) */
  chooseFile?: (accept: string) => Promise<{ name: string; bytes: Uint8Array } | null>;
  /** fallback: offer `data` as a download */
  download?: (name: string, data: Uint8Array) => void;
}

export interface FileHandleLike {
  name: string;
  createWritable?: () => Promise<{ write(d: Uint8Array): Promise<void>; close(): Promise<void> }>;
  getFile?: () => Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
}

export const extensionOf = (light: boolean) => (light ? "SVL" : "SAV");

/** `lpstrDefExt`: the extension is appended when the name has none. */
export function withDefaultExtension(name: string, light: boolean): string {
  return /\.[^./\\]+$/.test(name) ? name : `${name}.${extensionOf(light)}`;
}

/** Filter of the original: a single entry whose description is the pattern, `(*.SAV)` / `(*.SVL)`. */
export function pickerTypes(light: boolean) {
  const ext = extensionOf(light);
  return [
    {
      description: `(*.${ext})`,
      accept: { "application/octet-stream": [`.${ext}`, `.${ext.toLowerCase()}`] },
    },
  ];
}

const isAbort = (e: unknown) => e instanceof Error && e.name === "AbortError";

export class BrowserFilePicker implements FilePicker {
  constructor(private readonly env: PickerEnv) {}

  /** True when the real system windows are available (the File System Access API). */
  get native(): boolean {
    return !!(this.env.showSaveFilePicker && this.env.showOpenFilePicker);
  }

  async save(data: Uint8Array, suggestedName: string, light: boolean): Promise<boolean> {
    const name = withDefaultExtension(suggestedName, light);
    if (this.env.showSaveFilePicker) {
      try {
        const h = await this.env.showSaveFilePicker({
          suggestedName: name,
          types: pickerTypes(light),
        });
        const w = await h.createWritable!();
        await w.write(data);
        await w.close();
        return true;
      } catch (e) {
        if (isAbort(e)) return false;
        throw e;
      }
    }
    if (!this.env.download) return false;
    this.env.download(name, data);
    return true;
  }

  async open(light: boolean): Promise<OpenedFile | null> {
    if (this.env.showOpenFilePicker) {
      try {
        const [h] = await this.env.showOpenFilePicker({
          types: pickerTypes(light),
          multiple: false,
        });
        if (!h) return null;
        const f = await h.getFile!();
        return { name: h.name, data: new Uint8Array(await f.arrayBuffer()) };
      } catch (e) {
        if (isAbort(e)) return null;
        throw e;
      }
    }
    const f = await this.env.chooseFile?.(`.${extensionOf(light)},.${extensionOf(light).toLowerCase()}`);
    return f ? { name: f.name, data: f.bytes } : null;
  }
}

/** The real browser environment (needs a DOM; call it only in the browser). */
export function windowPickerEnv(w: Window & typeof globalThis = window): PickerEnv {
  const anyW = w as unknown as PickerEnv;
  return {
    showSaveFilePicker: anyW.showSaveFilePicker?.bind(w),
    showOpenFilePicker: anyW.showOpenFilePicker?.bind(w),
    chooseFile: (accept) =>
      new Promise((resolve) => {
        const input = w.document.createElement("input");
        input.type = "file";
        input.accept = accept;
        input.onchange = async () => {
          const f = input.files?.[0];
          resolve(f ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null);
        };
        input.oncancel = () => resolve(null);
        input.click();
      }),
    download: (name, data) => {
      const url = URL.createObjectURL(new Blob([data as BlobPart], { type: "application/octet-stream" }));
      const a = w.document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  };
}
