interface ExtractPptxTextOptions {
  maxSlides?: number;
  maxChars?: number;
}

export async function extractPptxText(
  fileOrBlob: Blob,
  options: ExtractPptxTextOptions = {},
): Promise<string> {
  const { maxSlides = 300, maxChars = 40000 } = options;

  const JSZip = (await import("jszip")).default;
  const buffer = await fileOrBlob.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);

  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const aNum = parseInt(a.match(/\d+/)?.[0] ?? "0", 10);
      const bNum = parseInt(b.match(/\d+/)?.[0] ?? "0", 10);
      return aNum - bNum;
    })
    .slice(0, maxSlides);

  const parts: string[] = [];
  for (const name of slideNames) {
    const file = zip.file(name);
    if (!file) continue;
    const xml = await file.async("string");
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const text = [...doc.getElementsByTagNameNS("*", "t")]
      .map((node) => node.textContent || "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) {
      const slideNum = parseInt(name.match(/\d+/)?.[0] ?? "0", 10);
      parts.push(`Diapositive ${slideNum}: ${text}`);
    }
    if (parts.join("\n\n").length >= maxChars) break;
  }

  return parts.join("\n\n").slice(0, maxChars);
}
