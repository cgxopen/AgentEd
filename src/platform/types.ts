export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface FileResult {
  content: string;
  path: string;
}

export interface PlatformIO {
  /** Whether this platform can write to multiple file paths (directories, attachments) */
  readonly supportsMultiFile: boolean;
  openFile(path?: string): Promise<FileResult | null>;
  /** Show a file picker with custom filter; returns absolute path or null if cancelled */
  pickFile(filterName: string, extensions: string[]): Promise<string | null>;
  readText(path: string): Promise<string>;
  saveFile(path: string, content: string): Promise<void>;
  saveFileAs(content: string, filterName?: string, extensions?: string[]): Promise<string | null>;
  readBinary(path: string): Promise<Uint8Array>;
  writeBinary(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  listDir(path: string): Promise<FileEntry[]>;
  mkdir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  /**
   * Open `path` with the host OS's default application for that
   * file type (Tauri-only). Throws on Web — there's no equivalent
   * primitive in the browser File System Access API.
   */
  openWithSystem(path: string): Promise<void>;
}
