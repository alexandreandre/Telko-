import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  getApiBaseUrl: () => "https://api.test",
}));

import {
  KNOWLEDGE_API_UPLOAD_MAX_BYTES,
  exceedsKnowledgeApiUploadLimit,
  extractDocumentTextViaApi,
} from "./knowledge-files";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("exceedsKnowledgeApiUploadLimit", () => {
  it("autorise un PPTX lourd (import côté navigateur)", () => {
    const heavyPptx = {
      name: "Proposition Pack Telephonie Integree MARS 2026.pptx",
      size: 34 * 1024 * 1024,
    } as Pick<File, "name" | "size">;

    expect(exceedsKnowledgeApiUploadLimit(heavyPptx)).toBe(false);
  });

  it("refuse un PDF au-dessus de la limite API", () => {
    const heavyPdf = {
      name: "Presentation Pack Internet Integre L'Agence Telecom.pdf",
      size: KNOWLEDGE_API_UPLOAD_MAX_BYTES + 1,
    } as Pick<File, "name" | "size">;

    expect(exceedsKnowledgeApiUploadLimit(heavyPdf)).toBe(true);
  });
});

describe("extractDocumentTextViaApi", () => {
  it("réessaie une fois en cas d'erreur réseau transitoire", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ text: "contenu extrait" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const text = await extractDocumentTextViaApi(
      new Blob(["dummy"]),
      "document.pdf",
      "token",
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(text).toBe("contenu extrait");
  });
});
