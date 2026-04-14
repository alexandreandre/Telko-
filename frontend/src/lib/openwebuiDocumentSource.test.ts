import { describe, expect, it, beforeEach } from "vitest";
import {
  OPENWEBUI_KNOWLEDGE_SOURCE_KEY,
  nextSourceAfterOpenwebuiCheckbox,
  nextSourceAfterTelkoCheckbox,
  persistOpenwebuiKnowledgeSource,
  readPersistedOpenwebuiKnowledgeSource,
} from "./openwebuiDocumentSource";

describe("nextSourceAfterTelkoCheckbox", () => {
  it("coche Telko → source telko", () => {
    expect(nextSourceAfterTelkoCheckbox(true)).toBe("telko");
  });
  it("décoche Telko → source openwebui (l’autre case devient la seule logique)", () => {
    expect(nextSourceAfterTelkoCheckbox(false)).toBe("openwebui");
  });
  it("indeterminate se comporte comme non coché Telko", () => {
    expect(nextSourceAfterTelkoCheckbox("indeterminate")).toBe("openwebui");
  });
});

describe("nextSourceAfterOpenwebuiCheckbox", () => {
  it("coche Open WebUI → source openwebui", () => {
    expect(nextSourceAfterOpenwebuiCheckbox(true)).toBe("openwebui");
  });
  it("décoche Open WebUI → source telko", () => {
    expect(nextSourceAfterOpenwebuiCheckbox(false)).toBe("telko");
  });
});

describe("persistance localStorage", () => {
  beforeEach(() => {
    localStorage.removeItem(OPENWEBUI_KNOWLEDGE_SOURCE_KEY);
  });

  it("défaut telko si clé absente", () => {
    expect(readPersistedOpenwebuiKnowledgeSource()).toBe("telko");
  });

  it("relit la valeur persistée", () => {
    persistOpenwebuiKnowledgeSource("openwebui");
    expect(readPersistedOpenwebuiKnowledgeSource()).toBe("openwebui");
    persistOpenwebuiKnowledgeSource("telko");
    expect(readPersistedOpenwebuiKnowledgeSource()).toBe("telko");
  });
});
