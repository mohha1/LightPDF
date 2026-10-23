/**
 * Access to the user's own folders through the File System Access API.
 * Only Chromium browsers on desktop (Chrome, Edge, Opera…) support it;
 * everywhere else LightPDF falls back to a file input and plain downloads.
 */
import { uniqueFileName } from '../editor/naming';
import type { OutputFile } from './files';

declare global {
  interface FilePickerType {
    description?: string;
    accept: Record<string, string[]>;
  }
  interface Window {
    showOpenFilePicker?(options?: { multiple?: boolean; types?: FilePickerType[]; id?: string }): Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?(options?: { suggestedName?: string; types?: FilePickerType[]; id?: string }): Promise<FileSystemFileHandle>;
    showDirectoryPicker?(options?: { mode?: 'read' | 'readwrite'; id?: string }): Promise<FileSystemDirectoryHandle>;
  }
  interface FileSystemHandle {
    queryPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
    requestPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
    remove?(): Promise<void>;
  }
  interface DataTransferItem {
    getAsFileSystemHandle?(): Promise<FileSystemHandle | null>;
  }
}

const hasWindow = typeof window !== 'undefined';

export const canPickFiles = hasWindow && typeof window.showOpenFilePicker === 'function';
export const canSaveAs =
  hasWindow && typeof window.showSaveFilePicker === 'function' && typeof window.showDirectoryPicker === 'function';
export const canDeleteFiles =
  canPickFiles && typeof FileSystemHandle !== 'undefined' && typeof FileSystemHandle.prototype.remove === 'function';

export interface PickedFile {
  file: File;
  /** Present when the browser gave access to the file on disk. */
  handle?: FileSystemFileHandle;
}

const OPEN_TYPES: FilePickerType[] = [
  {
    description: 'PDFs and images',
    accept: {
      'application/pdf': ['.pdf'],
      'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'],
    },
  },
];

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** Opens the system file picker. Returns an empty list when the user cancels. */
export async function pickFiles(): Promise<PickedFile[]> {
  try {
    const handles = await window.showOpenFilePicker!({ multiple: true, types: OPEN_TYPES, id: 'lightpdf-open' });
    return Promise.all(handles.map(async (handle) => ({ file: await handle.getFile(), handle })));
  } catch (error) {
    if (isAbort(error)) return [];
    throw error;
  }
}

/**
 * Reads dropped files, with their disk handles where the browser offers them.
 * Must be called synchronously inside the drop handler.
 */
export function filesFromDrop(data: DataTransfer): Promise<PickedFile[]> {
  const items = [...data.items].filter((item) => item.kind === 'file');
  if (!canDeleteFiles || items.some((item) => typeof item.getAsFileSystemHandle !== 'function')) {
    return Promise.resolve([...data.files].map((file) => ({ file })));
  }
  // Both calls have to happen now: the drop data is cleared once the handler returns.
  const pending = items.map((item) => ({ file: item.getAsFile(), handle: item.getAsFileSystemHandle!() }));
  return Promise.all(
    pending.map(async ({ file, handle }) => {
      const entry = await handle.catch(() => null);
      if (entry?.kind === 'file') {
        const fileHandle = entry as FileSystemFileHandle;
        return { file: file ?? (await fileHandle.getFile()), handle: fileHandle };
      }
      return file && entry?.kind !== 'directory' ? { file } : null;
    }),
  ).then((files) => files.filter((file): file is PickedFile => file !== null));
}

export type Destination =
  | { kind: 'file'; handle: FileSystemFileHandle }
  | { kind: 'folder'; handle: FileSystemDirectoryHandle };

/**
 * Asks where to save: a file name for a single output, or a folder for
 * several. Returns null when the user cancels. Call it straight from a click.
 */
export async function chooseDestination(names: string[]): Promise<Destination | null> {
  try {
    if (names.length === 1) {
      const extension = names[0].slice(names[0].lastIndexOf('.'));
      const handle = await window.showSaveFilePicker!({
        suggestedName: names[0],
        id: 'lightpdf-save',
        types: [{ description: extension.slice(1).toUpperCase(), accept: { [mimeType(extension)]: [extension] } }],
      });
      return { kind: 'file', handle };
    }
    const handle = await window.showDirectoryPicker!({ mode: 'readwrite', id: 'lightpdf-save' });
    return { kind: 'folder', handle };
  } catch (error) {
    if (isAbort(error)) return null;
    throw error;
  }
}

function mimeType(extension: string): string {
  const types: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.txt': 'text/plain',
    '.zip': 'application/zip',
  };
  return types[extension] ?? 'application/octet-stream';
}

async function writeFile(handle: FileSystemFileHandle, blob: Blob): Promise<void> {
  const stream = await handle.createWritable();
  try {
    await stream.write(blob);
    await stream.close();
  } catch (error) {
    await stream.abort().catch(() => undefined);
    throw error;
  }
}

/**
 * Writes the outputs. In a folder, existing files are never replaced: a name
 * that's taken gets " (2)" added. Returns the handles that were written.
 */
export async function writeOutputs(destination: Destination, files: OutputFile[]): Promise<FileSystemFileHandle[]> {
  if (destination.kind === 'file') {
    await writeFile(destination.handle, files[0].blob);
    return [destination.handle];
  }
  const taken = new Set<string>();
  for await (const name of destination.handle.keys()) taken.add(name);
  const written: FileSystemFileHandle[] = [];
  for (const file of files) {
    const name = uniqueFileName(file.name, taken);
    taken.add(name);
    const handle = await destination.handle.getFileHandle(name, { create: true });
    await writeFile(handle, file.blob);
    written.push(handle);
  }
  return written;
}

export interface DeleteResult {
  deleted: string[];
  /** Handles of the deleted files. */
  removed: FileSystemFileHandle[];
  /** Files left in place: no permission, already gone, or the file just saved. */
  kept: Array<{ name: string; reason: string }>;
}

/** The files this page may not yet change or delete. */
export async function lacksWriteAccess(handles: FileSystemFileHandle[]): Promise<FileSystemFileHandle[]> {
  const states = await Promise.all(handles.map((handle) => handle.queryPermission?.({ mode: 'readwrite' }).catch(() => 'prompt')));
  return handles.filter((_, i) => states[i] !== 'granted');
}

/**
 * Asks for permission to change these files, so they can be deleted later
 * without asking again. Browsers only show the prompt right after a click,
 * so call this synchronously from a click or change handler.
 * Resolves to the files that are still not allowed.
 */
export function requestWriteAccess(handles: FileSystemFileHandle[]): Promise<FileSystemFileHandle[]> {
  // Every request starts now, while the click still counts.
  const requests = handles.map((handle) =>
    (handle.requestPermission?.({ mode: 'readwrite' }) ?? Promise.resolve<PermissionState>('denied')).catch(
      (): PermissionState => 'denied',
    ),
  );
  return Promise.all(requests).then((states) => handles.filter((_, i) => states[i] !== 'granted'));
}

/** True when the page may change this file; asks the user if needed (requires a click). */
async function mayWrite(handle: FileSystemFileHandle, ask: boolean): Promise<boolean> {
  if ((await handle.queryPermission?.({ mode: 'readwrite' })) === 'granted') return true;
  if (!ask) return false;
  try {
    return (await handle.requestPermission?.({ mode: 'readwrite' })) === 'granted';
  } catch {
    // Without a recent click the browser refuses to ask.
    return false;
  }
}

/**
 * Deletes original files from disk. Never deletes one of the files just
 * written (when the output was saved over an original).
 */
export async function deleteFiles(
  handles: FileSystemFileHandle[],
  written: FileSystemFileHandle[],
  ask: boolean,
): Promise<DeleteResult & { needPermission: FileSystemFileHandle[] }> {
  const result: DeleteResult & { needPermission: FileSystemFileHandle[] } = { deleted: [], removed: [], kept: [], needPermission: [] };
  for (const handle of handles) {
    if (await isAny(handle, written)) {
      result.kept.push({ name: handle.name, reason: 'it was replaced by the saved file' });
      continue;
    }
    if (!(await mayWrite(handle, ask))) {
      result.needPermission.push(handle);
      continue;
    }
    try {
      await handle.remove!();
      result.deleted.push(handle.name);
      result.removed.push(handle);
    } catch (error) {
      const gone = error instanceof DOMException && error.name === 'NotFoundError';
      result.kept.push({ name: handle.name, reason: gone ? 'it was already gone' : 'the browser refused' });
    }
  }
  return result;
}

async function isAny(handle: FileSystemFileHandle, others: FileSystemFileHandle[]): Promise<boolean> {
  for (const other of others) {
    if (await handle.isSameEntry(other)) return true;
  }
  return false;
}
