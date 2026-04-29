import JSZip from "jszip";

export interface ExtractPptxTextOptions {
  maxSlides?: number;
  maxChars?: number;
}

/** Texte visible OOXML (`<a:t>` dans DrawingML). Sans DOM pour usage dans un Worker. */
export function slideXmlToPlainText(xml: string): string {
  const chunks: string[] = [];
  const re = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    chunks.push(decodeXmlEntities(m[1]));
  }
  return chunks.join(" ").replace(/\s+/g, " ").trim();
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number.parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCharCode(Number.parseInt(h, 16)));
}

export async function extractPptxPlainTextFromArrayBuffer(
  buffer: ArrayBuffer,
  options: ExtractPptxTextOptions = {},
): Promise<string> {
  const { maxSlides = 300, maxChars = 40000 } = options;

  const zip = await JSZip.loadAsync(buffer);

  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const aNum = Number.parseInt(a.match(/\d+/)?.[0] ?? "0", 10);
      const bNum = Number.parseInt(b.match(/\d+/)?.[0] ?? "0", 10);
      return aNum - bNum;
    })
    .slice(0, maxSlides);

  const parts: string[] = [];
  for (const name of slideNames) {
    const file = zip.file(name);
    if (!file) continue;
    const xml = await file.async("string");
    const text = slideXmlToPlainText(xml);
    if (text) {
      const slideNum = Number.parseInt(name.match(/\d+/)?.[0] ?? "0", 10);
      parts.push(`Diapositive ${slideNum}: ${text}`);
    }
    if (parts.join("\n\n").length >= maxChars) break;
  }

  return parts.join("\n\n").slice(0, maxChars);
}
