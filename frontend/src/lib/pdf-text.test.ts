import { describe, expect, it, vi, beforeEach } from "vitest";

const getDocumentMock = vi.fn();

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument: getDocumentMock,
}));

describe("extractPdfText", () => {
  beforeEach(() => {
    getDocumentMock.mockReset();
  });

  it("utilise le parsing local sans worker distant", async () => {
    const page = {
      getTextContent: vi.fn().mockResolvedValue({
        items: [{ str: "Bonjour" }, { str: "TELKO" }],
      }),
    };
    const pdf = {
      numPages: 1,
      getPage: vi.fn().mockResolvedValue(page),
    };
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve(pdf),
    });

    const fakeBlob = {
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as unknown as Blob;

    const { extractPdfText } = await import("./pdf-text");
    const text = await extractPdfText(fakeBlob);

    expect(getDocumentMock).toHaveBeenCalledTimes(1);
    expect(getDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        disableWorker: true,
      }),
    );
    expect(text).toContain("Page 1: Bonjour TELKO");
  });
});
