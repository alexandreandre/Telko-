export { isKnowledgeFilePlaceholder as isPdfPlaceholderContent } from "@/lib/knowledge-files";

interface ExtractPdfTextOptions {
  maxPages?: number;
  maxChars?: number;
}

export async function extractPdfText(
  fileOrBlob: Blob,
  options: ExtractPdfTextOptions = {},
): Promise<string> {
  const { maxPages = 30, maxChars = 40000 } = options;

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const buffer = await fileOrBlob.arrayBuffer();

  // Mode sans worker pour éviter les échecs de chargement dynamique du worker
  // sur certains déploiements front (assets hashés/CDN/cache).
  const loadingTask = pdfjs.getDocument({ data: buffer, disableWorker: true });
  const pdf = await loadingTask.promise;

  const pageCount = Math.min(pdf.numPages, maxPages);
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();

    const text = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (text) {
      pages.push(`Page ${pageNumber}: ${text}`);
    }

    if (pages.join("\n\n").length >= maxChars) {
      break;
    }
  }

  return pages.join("\n\n").slice(0, maxChars);
}
