import type { ExtractPptxTextOptions } from "../lib/pptx-extract-core";
import { extractPptxPlainTextFromArrayBuffer } from "../lib/pptx-extract-core";

self.onmessage = async (ev: MessageEvent<{ buffer: ArrayBuffer; options?: ExtractPptxTextOptions }>) => {
  const { buffer, options } = ev.data ?? {};
  if (!buffer) {
    self.postMessage({ ok: false, error: "buffer manquant" });
    return;
  }
  try {
    const text = await extractPptxPlainTextFromArrayBuffer(buffer, options ?? {});
    self.postMessage({ ok: true, text });
  } catch (err) {
    self.postMessage({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
