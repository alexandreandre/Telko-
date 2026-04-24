/**
 * Sélection de dossier via File System Access API (sans <input webkitdirectory>),
 * ce qui évite la bannière Chrome « Importer N fichiers sur ce site ».
 */

const SKIP_DIR_NAMES = new Set(
  [
    "__macosx",
    ".git",
    "node_modules",
    ".spotlight-v100",
    ".fseventsd",
    ".temporaryitems",
    ".trashes",
    "$recycle.bin",
    "system volume information",
    ".documentrevisions-v100",
  ].map((s) => s.toLowerCase()),
);

function shouldSkipSubdirectory(name: string): boolean {
  return SKIP_DIR_NAMES.has(name.trim().toLowerCase());
}

function attachRelativePath(file: File, relativePath: string): File {
  try {
    Object.defineProperty(file, "webkitRelativePath", {
      value: relativePath,
      writable: false,
      configurable: true,
      enumerable: true,
    });
  } catch {
    /* navigateur très strict : le titre utilisera file.name */
  }
  return file;
}

async function collectFromDirectoryHandle(
  dirHandle: FileSystemDirectoryHandle,
  pathPrefix: string,
): Promise<File[]> {
  const out: File[] = [];

  for await (const handle of dirHandle.values()) {
    const name = handle.name;
    const rel = pathPrefix ? `${pathPrefix}/${name}` : name;

    if (handle.kind === "file") {
      const file = await (handle as FileSystemFileHandle).getFile();
      out.push(attachRelativePath(file, rel));
    } else if (handle.kind === "directory") {
      if (shouldSkipSubdirectory(name)) continue;
      out.push(...(await collectFromDirectoryHandle(handle as FileSystemDirectoryHandle, rel)));
    }
  }

  return out;
}

export function isDirectoryPickerSupported(): boolean {
  if (typeof window === "undefined") return false;
  /** L’API n’est pas exposée en http non-localhost. */
  if (!window.isSecureContext) return false;
  return typeof window.showDirectoryPicker === "function";
}

/**
 * Ouvre le sélecteur de dossier natif du système, lit l’arborescence, renvoie des `File`
 * avec `webkitRelativePath` renseigné pour l’indexation Telko.
 * @throws DOMException avec `name === "AbortError"` si l’utilisateur annule
 */
export async function collectFilesWithDirectoryPicker(): Promise<File[]> {
  if (!isDirectoryPickerSupported()) {
    throw new Error("Ce navigateur ne prend pas en charge la sélection de dossier (API manquante).");
  }

  const root = await window.showDirectoryPicker({ mode: "read" });
  const base = root.name;
  return collectFromDirectoryHandle(root, base);
}
