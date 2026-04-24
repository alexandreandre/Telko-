import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import KnowledgeFilePreview from "@/components/knowledge/KnowledgeFilePreview";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, Upload, Trash2, Loader2, Search, BookOpen, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";
import jsPDF from "jspdf";
import { getApiBaseUrl } from "@/lib/api";
import {
  extractDocumentTextViaApi,
  getKnowledgeFileKind,
  KNOWLEDGE_UPLOAD_ACCEPT,
  knowledgeFileKindLabel,
  knowledgeFileLucideIcon,
  suggestedDownloadFilename,
} from "@/lib/knowledge-files";
import { extractPdfText } from "@/lib/pdf-text";
import {
  collectFilesFromDataTransfer,
  dedupeRawKnowledgeFiles,
  filterBatchKnowledgeFiles,
  KNOWLEDGE_MAX_BATCH_FILES,
  knowledgeDocumentDisplayTitle,
} from "@/lib/knowledge-batch-upload";
import { cn } from "@/lib/utils";
import {
  collectFilesWithDirectoryPicker,
  isDirectoryPickerSupported,
} from "@/lib/knowledge-directory-picker";

interface KnowledgeDoc {
  id: string;
  title: string;
  content: string;
  source_type: string;
  file_path: string | null;
  created_at: string;
  user_id: string;
}

type OpenDocState = {
  title: string;
  content: string;
  fileBlobUrl: string | null;
  fileBlob: Blob | null;
  storagePath: string | null;
};

export default function KnowledgeBase() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [documents, setDocuments] = useState<KnowledgeDoc[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadBatchProgress, setUploadBatchProgress] = useState<{
    done: number;
    total: number;
    currentName: string | null;
  } | null>(null);
  const [folderImportOpen, setFolderImportOpen] = useState(false);
  const [folderDialogBusy, setFolderDialogBusy] = useState(false);
  const folderFallbackInputRef = useRef<HTMLInputElement>(null);
  const [openDoc, setOpenDoc] = useState<OpenDocState | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const loadDocuments = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from("knowledge_documents")
      .select("id, title, content, source_type, file_path, created_at, user_id")
      .order("created_at", { ascending: false });
    if (error) console.error("Error loading documents:", error);
    setDocuments((data as KnowledgeDoc[]) ?? []);
    setIsLoading(false);
  }, []);

  useEffect(() => { loadDocuments(); }, [loadDocuments]);

  const openDocument = useCallback(
    async (doc: KnowledgeDoc) => {
      if (doc.file_path) {
        setIsDownloading(doc.id);
        const { data, error } = await supabase.storage.from("knowledge-files").download(doc.file_path);
        setIsDownloading(null);

        if (error || !data) {
          toast({
            title: "Erreur",
            description: "Impossible de prévisualiser ce document.",
            variant: "destructive",
          });
          return;
        }

        const blobUrl = URL.createObjectURL(data);
        setOpenDoc({
          title: doc.title,
          content: "",
          fileBlobUrl: blobUrl,
          fileBlob: data,
          storagePath: doc.file_path,
        });
        return;
      }

      setOpenDoc({
        title: doc.title,
        content: doc.content,
        fileBlobUrl: null,
        fileBlob: null,
        storagePath: null,
      });
    },
    [toast],
  );

  const docQueryId = searchParams.get("doc");
  useEffect(() => {
    if (!docQueryId || isLoading) return;
    const doc = documents.find((d) => d.id === docQueryId);
    if (!doc) return;
    void openDocument(doc);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("doc");
        return next;
      },
      { replace: true },
    );
  }, [docQueryId, isLoading, documents, openDocument, setSearchParams]);

  const generatePdfFromContent = (title: string, content: string): Blob => {
    const doc = new jsPDF({ putOnlyUsedFonts: true, compress: true });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const maxWidth = pageWidth - margin * 2;
    let y = 30;

    const addPageIfNeeded = (extraHeight: number) => {
      if (y + extraHeight > pageHeight - 25) {
        doc.addPage();
        y = 25;
      }
    };

    // Red header line
    doc.setDrawColor(200, 30, 30);
    doc.setLineWidth(0.8);
    doc.line(margin, 18, pageWidth - margin, 18);

    // Title
    doc.setFontSize(20);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 30, 30);
    const titleLines: string[] = doc.splitTextToSize(title, maxWidth);
    doc.text(titleLines, margin, y);
    y += titleLines.length * 9 + 6;

    // Red line under title
    doc.line(margin, y, pageWidth - margin, y);
    y += 12;

    // Body
    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(50, 50, 50);

    const paragraphs = content.split("\n");
    for (const rawLine of paragraphs) {
      const line = rawLine.trimEnd();

      if (line.startsWith("### ")) {
        y += 4;
        addPageIfNeeded(10);
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(40, 40, 40);
        const text = line.replace(/^###\s*/, "");
        const wrapped: string[] = doc.splitTextToSize(text, maxWidth);
        doc.text(wrapped, margin, y);
        y += wrapped.length * 6 + 4;
        doc.setFontSize(11);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(50, 50, 50);
      } else if (line.startsWith("## ")) {
        y += 5;
        addPageIfNeeded(12);
        doc.setFontSize(14);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(35, 35, 35);
        const text = line.replace(/^##\s*/, "");
        const wrapped: string[] = doc.splitTextToSize(text, maxWidth);
        doc.text(wrapped, margin, y);
        y += wrapped.length * 7 + 4;
        doc.setFontSize(11);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(50, 50, 50);
      } else if (line.startsWith("# ")) {
        y += 6;
        addPageIfNeeded(14);
        doc.setFontSize(16);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(30, 30, 30);
        const text = line.replace(/^#\s*/, "");
        const wrapped: string[] = doc.splitTextToSize(text, maxWidth);
        doc.text(wrapped, margin, y);
        y += wrapped.length * 8 + 5;
        doc.setFontSize(11);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(50, 50, 50);
      } else if (line.startsWith("- ") || line.startsWith("* ")) {
        addPageIfNeeded(7);
        const bulletText = line.replace(/^[-*]\s*/, "");
        const cleaned = bulletText.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1");
        const wrapped: string[] = doc.splitTextToSize(cleaned, maxWidth - 8);
        doc.text("\u2022", margin + 2, y);
        doc.text(wrapped, margin + 8, y);
        y += wrapped.length * 5.5 + 2;
      } else if (line.trim() === "") {
        y += 4;
      } else {
        const cleaned = line.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1");
        const wrapped: string[] = doc.splitTextToSize(cleaned, maxWidth);
        addPageIfNeeded(wrapped.length * 5.5);
        doc.text(wrapped, margin, y);
        y += wrapped.length * 5.5 + 2;
      }
    }

    // Footer on every page
    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.setFont("helvetica", "normal");
      doc.text(`L'Agence Telecom — ${title}`, margin, pageHeight - 10);
      doc.text(`Page ${i}/${totalPages}`, pageWidth - margin - 20, pageHeight - 10);
      // Bottom line
      doc.setDrawColor(200, 30, 30);
      doc.setLineWidth(0.4);
      doc.line(margin, pageHeight - 15, pageWidth - margin, pageHeight - 15);
    }

    return doc.output("blob");
  };

  const generateAndUploadPdf = async (docRecord: KnowledgeDoc) => {
    if (!user) return;
    setIsGenerating(true);
    try {
      const blob = generatePdfFromContent(docRecord.title, docRecord.content);
      const filePath = `${user.id}/${Date.now()}-${docRecord.title.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`;

      const { error: uploadError } = await supabase.storage
        .from("knowledge-files")
        .upload(filePath, blob, { contentType: "application/pdf" });
      if (uploadError) throw uploadError;

      await supabase
        .from("knowledge_documents")
        .update({ file_path: filePath })
        .eq("id", docRecord.id);

      toast({ title: "PDF généré", description: `Le PDF pour "${docRecord.title}" a été créé.` });
      loadDocuments();
    } catch (e) {
      console.error(e);
      toast({ title: "Erreur", description: "Impossible de générer le PDF.", variant: "destructive" });
    }
    setIsGenerating(false);
  };

  const regenerateAllPdfs = async () => {
    if (documents.length === 0) return;
    setIsGenerating(true);
    let count = 0;
    for (const doc of documents) {
      try {
        // Delete old file if exists
        if (doc.file_path) {
          await supabase.storage.from("knowledge-files").remove([doc.file_path]);
        }
        const blob = generatePdfFromContent(doc.title, doc.content);
        const filePath = `${user!.id}/${Date.now()}-${doc.title.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`;
        const { error: uploadError } = await supabase.storage
          .from("knowledge-files")
          .upload(filePath, blob, { contentType: "application/pdf", upsert: true });
        if (uploadError) throw uploadError;
        await supabase
          .from("knowledge_documents")
          .update({ file_path: filePath })
          .eq("id", doc.id);
        count++;
      } catch (e) {
        console.error(`Error generating PDF for ${doc.title}:`, e);
      }
    }
    toast({ title: "PDF régénérés", description: `${count} PDF ont été créés avec succès.` });
    loadDocuments();
    setIsGenerating(false);
  };

  const [isDownloading, setIsDownloading] = useState<string | null>(null);

  const ingestOneKnowledgeFile = async (file: File, token: string, userId: string) => {
    let extractedContent: string;
    if (getKnowledgeFileKind(file.name) === "pdf") {
      extractedContent = await extractPdfText(file);
    } else {
      extractedContent = await extractDocumentTextViaApi(file, file.name, token);
    }
    if (!extractedContent.trim()) {
      throw new Error("Aucun texte exploitable détecté dans ce fichier.");
    }

    const leaf = file.name.split(/[/\\]/).pop() || file.name;
    const safeLeaf = leaf.replace(/[^\w.-]+/g, "_").slice(0, 120) || "document";
    const filePath = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 11)}-${safeLeaf}`;

    const { error: uploadError } = await supabase.storage.from("knowledge-files").upload(filePath, file);
    if (uploadError) throw uploadError;

    const title = knowledgeDocumentDisplayTitle(file);

    const apiBase = getApiBaseUrl();
    const resp = await fetch(`${apiBase}/embed-document`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        title,
        content: extractedContent,
        source_type: "file",
        file_path: filePath,
      }),
    });
    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      throw new Error((errBody as { error?: string }).error || resp.statusText);
    }
  };

  const processKnowledgeUploadBatch = async (rawFiles: File[]) => {
    if (!user || rawFiles.length === 0) return;

    const uniqueRaw = dedupeRawKnowledgeFiles(rawFiles);
    const files = filterBatchKnowledgeFiles(uniqueRaw);
    if (files.length === 0) {
      toast({
        title: "Aucun fichier valide",
        description:
          "Formats acceptés : PDF, Word, Excel, PowerPoint. Les autres fichiers du dossier ont été ignorés.",
        variant: "destructive",
      });
      return;
    }

    if (files.length > KNOWLEDGE_MAX_BATCH_FILES) {
      toast({
        title: "Trop de fichiers",
        description: `Limite : ${KNOWLEDGE_MAX_BATCH_FILES} documents par import. Réduisez le dossier ou importez en plusieurs fois.`,
        variant: "destructive",
      });
      return;
    }

    if (uniqueRaw.length > files.length) {
      toast({
        title: "Fichiers filtrés",
        description: `${files.length} document(s) retenu(s) sur ${uniqueRaw.length} (métadonnées macOS « ._ », verrous Office « ~$ », formats non supportés, etc.).`,
      });
    }

    setIsUploading(true);
    setUploadBatchProgress({ done: 0, total: files.length, currentName: files[0]?.name ?? null });

    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Session requise pour indexer un document.");

      let ok = 0;
      const failures: string[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setUploadBatchProgress({ done: i, total: files.length, currentName: file.name });
        try {
          await ingestOneKnowledgeFile(file, token, user.id);
          ok++;
        } catch (err) {
          console.error(err);
          const msg = err instanceof Error ? err.message : "Erreur";
          failures.push(`${file.name} — ${msg}`);
        }
      }

      setUploadBatchProgress(null);

      if (ok === files.length) {
        toast({
          title: ok === 1 ? "Document ajouté" : "Import terminé",
          description:
            ok === 1
              ? `${files[0].name} a été indexé.`
              : `${ok} document(s) indexé(s) avec succès.`,
        });
      } else if (ok > 0) {
        toast({
          title: "Import partiel",
          description: `${ok} réussi(s), ${failures.length} échec(s). ${failures.slice(0, 3).join(" · ")}${failures.length > 3 ? "…" : ""}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Échec de l’import",
          description: failures[0] ?? "Impossible d’indexer les fichiers.",
          variant: "destructive",
        });
      }

      loadDocuments();
    } catch (e) {
      console.error(e);
      setUploadBatchProgress(null);
      toast({
        title: "Erreur",
        description: e instanceof Error ? e.message : "Impossible d’uploader les fichiers.",
        variant: "destructive",
      });
    }

    setIsUploading(false);
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list?.length) return;
    await processKnowledgeUploadBatch(Array.from(list));
    e.target.value = "";
  };

  const handleFolderFallbackInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list?.length) return;
    setFolderImportOpen(false);
    await processKnowledgeUploadBatch(Array.from(list));
    e.target.value = "";
  };

  const runFolderImportWithDirectoryPicker = async () => {
    setFolderDialogBusy(true);
    try {
      const raw = await collectFilesWithDirectoryPicker();
      setFolderImportOpen(false);
      await processKnowledgeUploadBatch(raw);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      console.error(e);
      toast({
        title: "Impossible de lire le dossier",
        description: e instanceof Error ? e.message : "Réessaie ou utilise le glisser-déposer.",
        variant: "destructive",
      });
    } finally {
      setFolderDialogBusy(false);
    }
  };

  const handleDropZoneDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const raw = await collectFilesFromDataTransfer(e.dataTransfer);
      await processKnowledgeUploadBatch(raw);
    } catch (err) {
      console.error(err);
      toast({
        title: "Lecture du dossier impossible",
        description:
          err instanceof Error
            ? err.message
            : "Votre navigateur ne permet peut‑être pas le dépôt de dossiers. Essayez « Choisir un dossier ».",
        variant: "destructive",
      });
    }
  };

  const deleteDocument = async (docId: string, ev: React.MouseEvent) => {
    ev.stopPropagation();
    const { error } = await supabase.from("knowledge_documents").delete().eq("id", docId);
    if (error) {
      toast({ title: "Erreur", description: "Impossible de supprimer le document.", variant: "destructive" });
    } else {
      toast({ title: "Supprimé", description: "Document supprimé de la base." });
      loadDocuments();
    }
  };

  const filtered = documents.filter(
    (d) =>
      d.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.content.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const missingPdfCount = documents.filter((d) => !d.file_path).length;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
              <BookOpen className="h-6 w-6" />
              Base documentaire
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Uploadez des PDF ou des documents Office (Word, Excel, PowerPoint). Plusieurs fichiers, un dossier
              entier ou un glisser-déposer sont pris en charge.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <label>
              <input
                type="file"
                className="hidden"
                multiple
                accept={KNOWLEDGE_UPLOAD_ACCEPT}
                onChange={handleFileInputChange}
                disabled={isUploading}
              />
              <Button asChild disabled={isUploading} variant="default">
                <span className="cursor-pointer">
                  {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                  Fichier(s)
                </span>
              </Button>
            </label>
            <Button
              type="button"
              variant="outline"
              disabled={isUploading}
              onClick={() => setFolderImportOpen(true)}
            >
              Choisir un dossier
            </Button>
          </div>
        </div>

        <Dialog open={folderImportOpen} onOpenChange={setFolderImportOpen}>
          <DialogContent className="sm:max-w-md" onPointerDownOutside={(ev) => folderDialogBusy && ev.preventDefault()}>
            <DialogHeader>
              <DialogTitle>Importer un dossier</DialogTitle>
              <DialogDescription>
                Seuls les PDF et documents Office (Word, Excel, PowerPoint) sont indexés ; le reste est ignoré
                automatiquement.
              </DialogDescription>
            </DialogHeader>
            {isDirectoryPickerSupported() ? (
              <p className="text-sm text-muted-foreground">
                Tu ouvriras le sélecteur de dossier du système (pas la fenêtre « importer des fichiers sur le site » du
                navigateur). Tu peux annuler à tout moment.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Ce navigateur n’expose pas la sélection de dossier moderne : utilise le bouton ci-dessous — une
                confirmation du navigateur peut encore s’afficher — ou glisse-dépose un dossier sur la zone en pointillés.
              </p>
            )}
            <input
              ref={folderFallbackInputRef}
              type="file"
              className="hidden"
              // @ts-expect-error sélection d’arborescence (repli navigateurs sans showDirectoryPicker)
              webkitdirectory=""
              // @ts-expect-error complément pour certains navigateurs
              directory=""
              multiple
              onChange={handleFolderFallbackInputChange}
              disabled={isUploading || folderDialogBusy}
            />
            <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setFolderImportOpen(false)} disabled={folderDialogBusy}>
                Annuler
              </Button>
              {isDirectoryPickerSupported() ? (
                <Button
                  type="button"
                  onClick={() => void runFolderImportWithDirectoryPicker()}
                  disabled={isUploading || folderDialogBusy}
                >
                  {folderDialogBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Parcourir le dossier…
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={() => folderFallbackInputRef.current?.click()}
                  disabled={isUploading || folderDialogBusy}
                >
                  Ouvrir le sélecteur du navigateur
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div
          className={cn(
            "flex min-h-[100px] flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/25 bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground transition-colors",
            !isUploading && "hover:border-muted-foreground/40 hover:bg-muted/30",
            isUploading && "pointer-events-none opacity-70",
          )}
          onDragOver={(ev) => {
            ev.preventDefault();
            ev.stopPropagation();
          }}
          onDrop={handleDropZoneDrop}
        >
          {uploadBatchProgress ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <p className="font-medium text-foreground">
                Indexation {uploadBatchProgress.done + 1} / {uploadBatchProgress.total}
              </p>
              {uploadBatchProgress.currentName ? (
                <p className="max-w-full truncate text-xs">{uploadBatchProgress.currentName}</p>
              ) : null}
            </>
          ) : (
            <>
              <Upload className="h-5 w-5 opacity-60" />
              <p>
                <span className="font-medium text-foreground">Glissez-déposez ici</span> des fichiers ou un dossier
                complet (jusqu’à {KNOWLEDGE_MAX_BATCH_FILES} documents par import).
              </p>
            </>
          )}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-10"
            placeholder="Rechercher dans la base documentaire..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              {filtered.length} document{filtered.length > 1 ? "s" : ""} indexé{filtered.length > 1 ? "s" : ""}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-8">
                Aucun document trouvé. Uploadez des fichiers pour enrichir l&apos;assistant.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Titre</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((doc) => {
                    const pathOrTitle = doc.file_path || doc.title;
                    const kind = doc.file_path ? getKnowledgeFileKind(pathOrTitle) : null;
                    const RowIcon = kind ? knowledgeFileLucideIcon(kind) : FileText;
                    return (
                    <TableRow
                      key={doc.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => openDocument(doc)}
                    >
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {isDownloading === doc.id ? (
                            <Loader2 className="h-4 w-4 animate-spin text-destructive shrink-0" />
                          ) : (
                            <RowIcon className="h-4 w-4 text-destructive shrink-0" />
                          )}
                          {doc.title}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={doc.file_path ? "secondary" : "outline"} className="text-[10px]">
                          {doc.file_path && kind ? knowledgeFileKindLabel(kind) : "Texte"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(doc.created_at).toLocaleDateString("fr-FR")}
                      </TableCell>
                      <TableCell>
                        {doc.user_id === user?.id && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(ev) => deleteDocument(doc.id, ev)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={!!openDoc}
        onOpenChange={(open) => {
          if (!open) {
            if (openDoc?.fileBlobUrl) URL.revokeObjectURL(openDoc.fileBlobUrl);
            setOpenDoc(null);
          }
        }}
      >
        <DialogContent className="max-w-5xl max-h-[95vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {(() => {
                const p = openDoc?.storagePath || openDoc?.title || "";
                const Icon = openDoc?.fileBlob
                  ? knowledgeFileLucideIcon(getKnowledgeFileKind(p))
                  : FileText;
                return <Icon className="h-5 w-5 text-destructive" />;
              })()}
              {openDoc?.title}
            </DialogTitle>
            <DialogDescription className="flex items-center justify-between">
              <span>
                {openDoc?.fileBlobUrl ? "Aperçu du document" : "Contenu du document (texte ou markdown)"}
              </span>
              {openDoc?.fileBlobUrl && (
                <a
                  href={openDoc.fileBlobUrl}
                  download={suggestedDownloadFilename(openDoc.title, openDoc.storagePath)}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <Download className="h-3 w-3" />
                  Télécharger
                </a>
              )}
            </DialogDescription>
          </DialogHeader>
          {openDoc?.fileBlobUrl && openDoc.fileBlob ? (
            <KnowledgeFilePreview
              blob={openDoc.fileBlob}
              blobUrl={openDoc.fileBlobUrl}
              downloadFileName={suggestedDownloadFilename(openDoc.title, openDoc.storagePath)}
            />
          ) : (
            <div className="prose prose-sm max-w-none dark:prose-invert overflow-y-auto max-h-[70vh] p-4">
              <ReactMarkdown>{openDoc?.content ?? ""}</ReactMarkdown>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
