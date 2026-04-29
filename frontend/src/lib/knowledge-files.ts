import type { LucideIcon } from "lucide-react";
import { FileSpreadsheet, FileText, FileType2, Presentation } from "lucide-react";

import { getApiBaseUrl } from "@/lib/api";

export const KNOWLEDGE_API_UPLOAD_MAX_BYTES = 30 * 1024 * 1024;

/** Valeur de l'attribut `accept` pour l'input fichier (base documentaire). */
export const KNOWLEDGE_UPLOAD_ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation";

const KNOWLEDGE_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
]);

const KNOWLEDGE_MIME_ALLOWLIST = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

export function extensionFromFilename(name: string): string {
  const i = name.lastIndexOf(".");
  if (i < 0) return "";
  return name.slice(i).toLowerCase();
}

export function exceedsKnowledgeApiUploadLimit(file: Pick<File, "name" | "size">): boolean {
  // Les .pptx sont extraits côté navigateur, sans passer par l'API d'extraction.
  if (extensionFromFilename(file.name) === ".pptx") return false;
  return file.size > KNOWLEDGE_API_UPLOAD_MAX_BYTES;
}

export function isAllowedKnowledgeExtension(name: string): boolean {
  return KNOWLEDGE_EXTENSIONS.has(extensionFromFilename(name));
}

/** MIME strict OU type vide / octet-stream avec extension autorisée (navigateurs Office). */
export function isAllowedKnowledgeUpload(file: File): boolean {
  if (!isAllowedKnowledgeExtension(file.name)) return false;
  if (KNOWLEDGE_MIME_ALLOWLIST.has(file.type)) return true;
  if (file.type === "" || file.type === "application/octet-stream") return true;
  return false;
}

export type KnowledgeFileKind =
  | "pdf"
  | "docx"
  | "spreadsheet"
  | "pptx"
  | "legacyWord"
  | "legacyPpt"
  | "unknown";

export function getKnowledgeFileKind(fileNameOrPath: string): KnowledgeFileKind {
  const base = fileNameOrPath.includes("/") ? fileNameOrPath.split("/").pop() ?? "" : fileNameOrPath;
  const ext = extensionFromFilename(base);
  switch (ext) {
    case ".pdf":
      return "pdf";
    case ".docx":
      return "docx";
    case ".xls":
    case ".xlsx":
      return "spreadsheet";
    case ".pptx":
      return "pptx";
    case ".doc":
      return "legacyWord";
    case ".ppt":
      return "legacyPpt";
    default:
      return "unknown";
  }
}

export function knowledgeFileLucideIcon(kind: KnowledgeFileKind): LucideIcon {
  switch (kind) {
    case "spreadsheet":
      return FileSpreadsheet;
    case "pptx":
    case "legacyPpt":
      return Presentation;
    case "docx":
    case "legacyWord":
      return FileType2;
    default:
      return FileText;
  }
}

export function knowledgeFileKindLabel(kind: KnowledgeFileKind): string {
  switch (kind) {
    case "pdf":
      return "PDF";
    case "docx":
      return "Word";
    case "spreadsheet":
      return "Excel";
    case "pptx":
      return "PowerPoint";
    case "legacyWord":
      return "Word (classique)";
    case "legacyPpt":
      return "PowerPoint (classique)";
    default:
      return "Fichier";
  }
}

/** Placeholder stocké côté base quand seul le fichier binaire est disponible (mention @). */
export function isKnowledgeFilePlaceholder(content: string): boolean {
  return /^\[Fichier [^:]+:\s*.+\]$/i.test(content.trim());
}

export async function extractDocumentTextViaApi(
  file: Blob,
  filename: string,
  accessToken: string,
): Promise<string> {
  if (file.size > KNOWLEDGE_API_UPLOAD_MAX_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    const limitMb = (KNOWLEDGE_API_UPLOAD_MAX_BYTES / (1024 * 1024)).toFixed(0);
    throw new Error(
      `Le fichier ${filename} fait ${sizeMb} Mo et dépasse la limite d'import (${limitMb} Mo). Découpez-le ou compressez-le avant import.`,
    );
  }

  const form = new FormData();
  form.append("file", file, filename.split("/").pop() || filename);
  let resp: Response | null = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      resp = await fetch(`${getApiBaseUrl()}/extract-document-text`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      });
      break;
    } catch (err) {
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    }
  }
  if (!resp) {
    throw new Error(
      `Impossible d'envoyer ${filename}. Vérifiez la connexion réseau ou réduisez la taille du document avant import.`,
    );
  }
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    throw new Error((errBody as { error?: string }).error || resp.statusText);
  }
  const data = (await resp.json()) as { text?: string };
  return data.text ?? "";
}

export function suggestedDownloadFilename(title: string, storagePath: string | null): string {
  const fromPath = storagePath?.split("/").pop();
  if (fromPath?.includes(".")) return fromPath;
  const ext = extensionFromFilename(title);
  if (ext) return title.replace(/[/\\]/g, "_");
  return `${title.replace(/[/\\]/g, "_")}.bin`;
}
