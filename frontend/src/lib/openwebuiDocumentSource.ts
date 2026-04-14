/**
 * Source documentaire pour le modèle Telko OpenWebUI (API /chat : openwebui_knowledge_source).
 */

export type OpenwebuiKnowledgeSource = "openwebui" | "telko";

export const OPENWEBUI_KNOWLEDGE_SOURCE_KEY = "telko_openwebui_knowledge_source";

/** Cases mutuellement exclusives : une seule base à la fois. */
export function nextSourceAfterTelkoCheckbox(checked: boolean | "indeterminate"): OpenwebuiKnowledgeSource {
  return checked === true ? "telko" : "openwebui";
}

export function nextSourceAfterOpenwebuiCheckbox(checked: boolean | "indeterminate"): OpenwebuiKnowledgeSource {
  return checked === true ? "openwebui" : "telko";
}

export function readPersistedOpenwebuiKnowledgeSource(): OpenwebuiKnowledgeSource {
  try {
    const v = window.localStorage.getItem(OPENWEBUI_KNOWLEDGE_SOURCE_KEY);
    if (v === "telko" || v === "openwebui") return v;
  } catch {
    /* quota / navigation privée */
  }
  return "telko";
}

export function persistOpenwebuiKnowledgeSource(value: OpenwebuiKnowledgeSource): void {
  try {
    window.localStorage.setItem(OPENWEBUI_KNOWLEDGE_SOURCE_KEY, value);
  } catch {
    /* quota / navigation privée */
  }
}
