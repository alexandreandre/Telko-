import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, FileText } from "lucide-react";
import { getKnowledgeFileKind, type KnowledgeFileKind } from "@/lib/knowledge-files";

interface KnowledgeFilePreviewProps {
  blob: Blob;
  blobUrl: string;
  downloadFileName: string;
}

function DownloadFallback({
  blobUrl,
  downloadFileName,
  message,
}: {
  blobUrl: string;
  downloadFileName: string;
  message: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-12 px-4 text-center">
      <FileText className="h-16 w-16 text-muted-foreground" />
      <p className="text-sm text-muted-foreground max-w-md">{message}</p>
      <Button asChild>
        <a href={blobUrl} download={downloadFileName}>
          <Download className="mr-2 h-4 w-4" />
          Télécharger le fichier
        </a>
      </Button>
    </div>
  );
}

type SheetBlock = { name: string; rows: (string | number | boolean)[][] };

export default function KnowledgeFilePreview({ blob, blobUrl, downloadFileName }: KnowledgeFilePreviewProps) {
  const kind: KnowledgeFileKind = getKnowledgeFileKind(downloadFileName);
  const docxRef = useRef<HTMLDivElement>(null);
  const [sheets, setSheets] = useState<SheetBlock[] | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [pptxSlides, setPptxSlides] = useState<string[] | null>(null);
  const [pptxError, setPptxError] = useState<string | null>(null);
  const [docxError, setDocxError] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== "docx" || !docxRef.current) return;
    const el = docxRef.current;
    el.innerHTML = "";
    setDocxError(null);
    let cancelled = false;
    (async () => {
      try {
        const mod = await import("docx-preview");
        const ab = await blob.arrayBuffer();
        if (cancelled || !docxRef.current) return;
        await mod.renderAsync(ab, docxRef.current, undefined, {
          className: "docx-wrapper",
          inWrapper: true,
          breakPages: true,
        });
      } catch {
        if (!cancelled) setDocxError("Impossible d’afficher ce document Word dans le navigateur.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blob, kind]);

  useEffect(() => {
    if (kind !== "spreadsheet") return;
    setSheets(null);
    setSheetError(null);
    let cancelled = false;
    (async () => {
      try {
        const XLSX = await import("xlsx");
        const ab = await blob.arrayBuffer();
        const wb = XLSX.read(ab, { type: "array", cellDates: true });
        if (cancelled) return;
        const blocks: SheetBlock[] = wb.SheetNames.map((name) => ({
          name,
          rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" }) as (
            | string
            | number
            | boolean
          )[][],
        }));
        setSheets(blocks);
      } catch {
        if (!cancelled) setSheetError("Impossible d’afficher ce classeur Excel dans le navigateur.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blob, kind]);

  useEffect(() => {
    if (kind !== "pptx") return;
    setPptxSlides(null);
    setPptxError(null);
    let cancelled = false;
    (async () => {
      try {
        const JSZip = (await import("jszip")).default;
        const ab = await blob.arrayBuffer();
        const zip = await JSZip.loadAsync(ab);
        const names = Object.keys(zip.files)
          .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
          .sort((a, b) => {
            const na = parseInt(a.match(/\d+/)?.[0] ?? "0", 10);
            const nb = parseInt(b.match(/\d+/)?.[0] ?? "0", 10);
            return na - nb;
          });
        const slides: string[] = [];
        for (const n of names) {
          const f = zip.file(n);
          if (!f) continue;
          const xml = await f.async("string");
          const doc = new DOMParser().parseFromString(xml, "application/xml");
          const texts = [...doc.getElementsByTagNameNS("*", "t")]
            .map((node) => node.textContent || "")
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
          slides.push(texts);
        }
        if (!cancelled) setPptxSlides(slides.length ? slides : []);
      } catch {
        if (!cancelled) setPptxError("Impossible d’afficher cette présentation dans le navigateur.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blob, kind]);

  if (kind === "pdf") {
    return (
      <object data={blobUrl} type="application/pdf" className="w-full flex-1 min-h-[70vh] rounded border">
        <DownloadFallback
          blobUrl={blobUrl}
          downloadFileName={downloadFileName}
          message="Votre navigateur ne peut pas afficher ce PDF. Téléchargez-le pour l’ouvrir avec un lecteur adapté."
        />
      </object>
    );
  }

  if (kind === "legacyWord" || kind === "legacyPpt") {
    return (
      <DownloadFallback
        blobUrl={blobUrl}
        downloadFileName={downloadFileName}
        message={
          kind === "legacyWord"
            ? "Les fichiers Word .doc (format classique) ne peuvent pas être prévisualisés dans l’application. Téléchargez le fichier pour l’ouvrir dans Microsoft Word ou un logiciel compatible."
            : "Les présentations .ppt (format classique) ne peuvent pas être prévisualisées dans l’application. Téléchargez le fichier pour l’ouvrir dans PowerPoint ou un logiciel compatible."
        }
      />
    );
  }

  if (kind === "docx") {
    if (docxError) {
      return <DownloadFallback blobUrl={blobUrl} downloadFileName={downloadFileName} message={docxError} />;
    }
    return (
      <div
        ref={docxRef}
        className="docx-preview-wrap overflow-y-auto max-h-[70vh] border rounded p-4 bg-background text-foreground"
      />
    );
  }

  if (kind === "spreadsheet") {
    if (sheetError) {
      return <DownloadFallback blobUrl={blobUrl} downloadFileName={downloadFileName} message={sheetError} />;
    }
    if (!sheets) {
      return (
        <div className="flex justify-center py-16 text-sm text-muted-foreground">Chargement du classeur…</div>
      );
    }
    const maxRows = 500;
    return (
      <div className="overflow-y-auto max-h-[70vh] space-y-8 border rounded p-4 bg-background">
        {sheets.map((sheet) => (
          <div key={sheet.name}>
            <h3 className="text-sm font-semibold mb-2">{sheet.name}</h3>
            <div className="overflow-x-auto rounded border">
              <table className="w-full text-xs border-collapse">
                <tbody>
                  {sheet.rows.slice(0, maxRows).map((row, ri) => (
                    <tr key={ri} className="border-b border-border/60">
                      {row.map((cell, ci) => (
                        <td key={ci} className="border-r border-border/40 px-2 py-1 whitespace-nowrap max-w-[240px] truncate">
                          {String(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sheet.rows.length > maxRows && (
              <p className="text-xs text-muted-foreground mt-2">
                Aperçu limité aux {maxRows} premières lignes. Téléchargez le fichier pour voir l’intégralité.
              </p>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (kind === "pptx") {
    if (pptxError) {
      return <DownloadFallback blobUrl={blobUrl} downloadFileName={downloadFileName} message={pptxError} />;
    }
    if (!pptxSlides) {
      return (
        <div className="flex justify-center py-16 text-sm text-muted-foreground">Chargement de la présentation…</div>
      );
    }
    return (
      <div className="overflow-y-auto max-h-[70vh] space-y-4 border rounded p-4 bg-background">
        {pptxSlides.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun texte extractible dans cette présentation.</p>
        ) : (
          pptxSlides.map((text, i) => (
            <div key={i} className="rounded-lg border border-border p-4 bg-muted/30">
              <p className="text-xs font-medium text-muted-foreground mb-2">Diapositive {i + 1}</p>
              <p className="text-sm whitespace-pre-wrap">{text || "—"}</p>
            </div>
          ))
        )}
      </div>
    );
  }

  return (
    <DownloadFallback
      blobUrl={blobUrl}
      downloadFileName={downloadFileName}
      message="Ce type de fichier ne peut pas être prévisualisé ici. Téléchargez-le pour l’ouvrir avec une application adaptée."
    />
  );
}
