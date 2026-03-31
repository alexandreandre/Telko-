const PDF_PLACEHOLDER_PATTERN = /^\[Fichier PDF:\s*.+\]$/i;

export const isPdfPlaceholderContent = (content: string): boolean =>
  PDF_PLACEHOLDER_PATTERN.test(content.trim());

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

  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const loadingTask = pdfjs.getDocument({ data: buffer });
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
