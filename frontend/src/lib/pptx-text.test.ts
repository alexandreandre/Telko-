import { describe, expect, it } from "vitest";
import JSZip from "jszip";

import { extractPptxText } from "./pptx-text";

async function createPptxBlob(slides: Array<{ index: number; text: string }>): Promise<Blob> {
  const zip = new JSZip();
  for (const slide of slides) {
    zip.file(
      `ppt/slides/slide${slide.index}.xml`,
      `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${slide.text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    );
  }
  const data = await zip.generateAsync({ type: "uint8array" });
  return {
    arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
  } as unknown as Blob;
}

describe("extractPptxText", () => {
  it("extrait le texte des slides PPTX côté navigateur", async () => {
    const blob = await createPptxBlob([
      { index: 2, text: "Slide deux" },
      { index: 1, text: "Slide un" },
    ]);

    const text = await extractPptxText(blob);

    expect(text).toContain("Diapositive 1: Slide un");
    expect(text).toContain("Diapositive 2: Slide deux");
    expect(text.indexOf("Diapositive 1")).toBeLessThan(text.indexOf("Diapositive 2"));
  });

  it("respecte maxChars pour éviter les extractions trop volumineuses", async () => {
    const blob = await createPptxBlob([{ index: 1, text: "A".repeat(5000) }]);

    const text = await extractPptxText(blob, { maxChars: 120 });

    expect(text.length).toBe(120);
    expect(text.startsWith("Diapositive 1:")).toBe(true);
  });
});
