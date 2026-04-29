import type { ExtractPptxTextOptions } from "@/lib/pptx-extract-core";

import PptxExtractWorker from "../workers/pptx-extract.worker.ts?worker";

export type { ExtractPptxTextOptions };

async function extractViaWorker(buffer: ArrayBuffer, options: ExtractPptxTextOptions | undefined): Promise<string> {
  try {
    return await new Promise<string>((resolve, reject) => {
      const worker = new PptxExtractWorker();

      const timeoutMs = 180_000;
      const timer = globalThis.setTimeout(() => {
        worker.terminate();
        reject(new Error("Timeout extraction PPTX"));
      }, timeoutMs);

      worker.onmessage = (ev: MessageEvent<{ ok: boolean; text?: string; error?: string }>) => {
        globalThis.clearTimeout(timer);
        worker.terminate();
        const data = ev.data;
        if (data.ok && typeof data.text === "string") resolve(data.text);
        else reject(new Error(data.error || "Échec extraction PPTX (worker)"));
      };

      worker.onerror = (err: ErrorEvent) => {
        globalThis.clearTimeout(timer);
        worker.terminate();
        reject(err.error ?? new Error("Erreur worker PPTX"));
      };

      worker.postMessage({ buffer, options });
    });
  } catch (err: unknown) {
    console.warn("pptx worker fallback:", err);
    const { extractPptxPlainTextFromArrayBuffer } = await import("@/lib/pptx-extract-core");
    return extractPptxPlainTextFromArrayBuffer(buffer, options);
  }
}

export async function extractPptxText(
  fileOrBlob: Blob,
  options: ExtractPptxTextOptions = {},
): Promise<string> {
  const buffer = await fileOrBlob.arrayBuffer();

  const WorkerCtor = typeof globalThis !== "undefined" ? globalThis.Worker : undefined;
  if (!WorkerCtor) {
    const { extractPptxPlainTextFromArrayBuffer } = await import("@/lib/pptx-extract-core");
    return extractPptxPlainTextFromArrayBuffer(buffer, options);
  }

  return extractViaWorker(buffer, options);
}
