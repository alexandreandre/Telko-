import { isAllowedKnowledgeUpload } from "@/lib/knowledge-files";

/** Limite pratique pour éviter de figer le navigateur sur des arborescences énormes. */
export const KNOWLEDGE_MAX_BATCH_FILES = 200;

const SKIP_PATH_SUBSTRINGS = [
  "/__macosx/",
  "\\__macosx\\",
  "__macosx/",
  "__macosx\\",
  "/.spotlight-v100/",
  "\\.spotlight-v100\\",
  "/.fseventsd/",
  "\\.fseventsd\\",
  "/.temporaryitems/",
  "\\.temporaryitems\\",
  "/.trashes/",
  "\\.trashes\\",
  "/document revisions/",
  "\\document revisions\\",
  "/.documentrevisions-v100/",
  "\\.documentrevisions-v100\\",
  "/$recycle.bin/",
  "\\$recycle.bin\\",
  "/system volume information/",
  "\\system volume information\\",
];

function basenameFromPath(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

/**
 * Dédoublonnage brut (sélecteur dossier ou glisser-déposer : entrées parfois en double ;
 * chemins relatifs normalisés en minuscules pour macOS insensible à la casse).
 */
export function dedupeRawKnowledgeFiles(files: File[]): File[] {
  const seen = new Set<string>();
  const out: File[] = [];
  for (const f of files) {
    const rp = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
    const norm =
      rp && rp.length > 0
        ? `rp:${rp.replace(/\\/g, "/").toLowerCase()}`
        : `f:${f.name.toLowerCase()}\0${f.size}\0${f.lastModified}\0${f.type || ""}`;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(f);
  }
  return out;
}

/**
 * Chemins / noms à exclure avant même le filtre MIME : latéraux macOS (._*),
 * verrous Office (~$*), métadonnées courantes — souvent comptés par le
 * navigateur à l’import dossier alors qu’ils sont invisibles dans le Finder.
 */
export function shouldSkipBatchFilePath(pathOrName: string): boolean {
  const lower = pathOrName.replace(/\\/g, "/").toLowerCase();
  if (SKIP_PATH_SUBSTRINGS.some((s) => lower.includes(s))) return true;

  const baseRaw = basenameFromPath(pathOrName);
  const base = baseRaw.trim();
  const baseLower = base.toLowerCase();
  /** Icône de dossier macOS (`Icon\r`) ou autres noms avec caractères de contrôle */
  if (/[\x00-\x1f\x7f]/.test(base)) return true;

  if (baseLower === ".ds_store" || baseLower === "thumbs.db" || baseLower === "desktop.ini") return true;
  if (baseLower === "ehthumbs.db" || baseLower === "ehthumbs_vista.db") return true;
  if (baseLower === ".localized") return true;
  /** AppleDouble / métadonnées Apple (peuvent finir en .pdf, .docx, etc.) */
  if (baseLower.startsWith("._")) return true;
  /** Fichier de verrouillage Word / Excel quand le document est ouvert */
  if (baseLower.startsWith("~$")) return true;

  return false;
}

/** Titre pour l’index (préserve le chemin relatif si import depuis un dossier). */
export function knowledgeDocumentDisplayTitle(file: File): string {
  const rp = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  const withoutExt = (name: string) => name.replace(/\.[^.]+$/, "");
  if (rp && rp.length > 0) {
    return withoutExt(rp).replace(/[/\\]/g, " / ");
  }
  return withoutExt(file.name);
}

function fileFromEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

function readEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    reader.readEntries(resolve, reject);
  });
}

async function collectFromDirectory(
  entry: FileSystemDirectoryEntry,
  seenFullPaths: Set<string>,
): Promise<File[]> {
  const out: File[] = [];
  const reader = entry.createReader();
  let batch: FileSystemEntry[];
  do {
    batch = await readEntries(reader);
    for (const child of batch) {
      if (child.isFile) {
        const fe = child as FileSystemFileEntry;
        const key = fe.fullPath.replace(/\\/g, "/").toLowerCase();
        if (seenFullPaths.has(key)) continue;
        seenFullPaths.add(key);
        out.push(await fileFromEntry(fe));
      } else if (child.isDirectory) {
        out.push(...(await collectFromDirectory(child as FileSystemDirectoryEntry, seenFullPaths)));
      }
    }
  } while (batch.length > 0);
  return out;
}

/**
 * Fichiers glissés-déposés (fichiers isolés + dossiers récursifs).
 * Nécessite Chromium / Safari / Edge (API `webkitGetAsEntry`).
 */
export async function collectFilesFromDataTransfer(dataTransfer: DataTransfer): Promise<File[]> {
  const collected: File[] = [];
  const items = dataTransfer.items;
  /** Évite les doublons si le navigateur expose à la fois l’arborescence et des entrées redondantes. */
  const seenFullPaths = new Set<string>();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind !== "file") continue;

    const entry = typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null;
    if (entry) {
      if (entry.isFile) {
        const fe = entry as FileSystemFileEntry;
        const key = fe.fullPath.replace(/\\/g, "/").toLowerCase();
        if (seenFullPaths.has(key)) continue;
        seenFullPaths.add(key);
        collected.push(await fileFromEntry(fe));
      } else if (entry.isDirectory) {
        collected.push(...(await collectFromDirectory(entry as FileSystemDirectoryEntry, seenFullPaths)));
      }
    } else {
      const f = item.getAsFile();
      if (f) collected.push(f);
    }
  }

  if (collected.length === 0 && dataTransfer.files?.length) {
    for (let j = 0; j < dataTransfer.files.length; j++) {
      collected.push(dataTransfer.files[j]);
    }
  }

  return dedupeRawKnowledgeFiles(collected);
}

/**
 * Filtre extensions autorisées + MIME + chemins système à ignorer.
 */
export function filterBatchKnowledgeFiles(files: File[]): File[] {
  const seen = new Set<string>();
  const out: File[] = [];

  for (const file of files) {
    const rp = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    const pathForSkip = ((rp && rp.length > 0 ? rp : file.name) || "").trim();
    if (shouldSkipBatchFilePath(pathForSkip)) continue;
    if (!isAllowedKnowledgeUpload(file)) continue;

    const key =
      rp && rp.length > 0
        ? rp.replace(/\\/g, "/").toLowerCase()
        : `${file.name.toLowerCase()}:${file.size}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(file);
  }

  return out;
}
