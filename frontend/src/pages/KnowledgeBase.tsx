import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, Upload, Trash2, Loader2, Search, BookOpen, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";
import jsPDF from "jspdf";
import { getApiBaseUrl } from "@/lib/api";
import { extractPdfText } from "@/lib/pdf-text";

interface KnowledgeDoc {
  id: string;
  title: string;
  content: string;
  source_type: string;
  file_path: string | null;
  created_at: string;
  user_id: string;
}

export default function KnowledgeBase() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [documents, setDocuments] = useState<KnowledgeDoc[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [openDoc, setOpenDoc] = useState<{ title: string; content: string; pdfUrl: string | null } | null>(null);
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

  const openDocument = async (doc: KnowledgeDoc) => {
    if (doc.file_path) {
      setIsDownloading(doc.id);
      const { data, error } = await supabase.storage
        .from("knowledge-files")
        .download(doc.file_path);
      setIsDownloading(null);

      if (error || !data) {
        toast({ title: "Erreur", description: "Impossible de prévisualiser ce PDF.", variant: "destructive" });
        return;
      }

      const blobUrl = URL.createObjectURL(data);
      // Ouvre le PDF dans la modale de prévisualisation, sans téléchargement automatique
      setOpenDoc({ title: doc.title, content: "", pdfUrl: blobUrl });
      return;
    }

    setOpenDoc({ title: doc.title, content: doc.content, pdfUrl: null });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (file.type !== "application/pdf" && !file.name.endsWith(".pdf")) {
      toast({ title: "Format non supporté", description: "Seuls les fichiers PDF sont acceptés.", variant: "destructive" });
      return;
    }

    setIsUploading(true);
    try {
      const extractedContent = await extractPdfText(file);
      if (!extractedContent.trim()) {
        throw new Error("Aucun texte exploitable détecté dans ce PDF.");
      }

      const filePath = `${user.id}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("knowledge-files")
        .upload(filePath, file);
      if (uploadError) throw uploadError;

      const title = file.name.replace(/\.[^.]+$/, "");

      const apiBase = getApiBaseUrl();
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Session requise pour indexer un document.");

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

      toast({ title: "PDF ajouté", description: `${file.name} a été indexé avec son contenu texte.` });
      loadDocuments();
    } catch (e) {
      console.error(e);
      toast({
        title: "Erreur",
        description: e instanceof Error ? e.message : "Impossible d'uploader le fichier.",
        variant: "destructive",
      });
    }
    setIsUploading(false);
    e.target.value = "";
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
              Uploadez vos PDF pour enrichir les réponses de l'assistant IA.
            </p>
          </div>
          <div className="flex gap-2">
            <label>
              <input type="file" className="hidden" accept=".pdf" onChange={handleFileUpload} disabled={isUploading} />
              <Button asChild disabled={isUploading}>
                <span className="cursor-pointer">
                  {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                  Uploader un PDF
                </span>
              </Button>
            </label>
          </div>
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
                Aucun document trouvé. Uploadez des PDF pour enrichir l'assistant.
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
                  {filtered.map((doc) => (
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
                            <FileText className="h-4 w-4 text-destructive shrink-0" />
                          )}
                          {doc.title}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={doc.file_path ? "secondary" : "outline"} className="text-[10px]">
                          {doc.file_path ? "PDF" : "Texte"}
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
                  ))}
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
            if (openDoc?.pdfUrl) URL.revokeObjectURL(openDoc.pdfUrl);
            setOpenDoc(null);
          }
        }}
      >
        <DialogContent className="max-w-5xl max-h-[95vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-destructive" />
              {openDoc?.title}
            </DialogTitle>
            <DialogDescription className="flex items-center justify-between">
              <span>{openDoc?.pdfUrl ? "Aperçu du document PDF" : "Contenu du document"}</span>
              {openDoc?.pdfUrl && (
                <a
                  href={openDoc.pdfUrl}
                  download={`${openDoc.title}.pdf`}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <Download className="h-3 w-3" />
                  Télécharger
                </a>
              )}
            </DialogDescription>
          </DialogHeader>
          {openDoc?.pdfUrl ? (
            <object
              data={openDoc.pdfUrl}
              type="application/pdf"
              className="w-full flex-1 min-h-[70vh] rounded border"
            >
              <div className="flex flex-col items-center justify-center gap-4 py-12">
                <FileText className="h-16 w-16 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Votre navigateur ne peut pas afficher ce PDF.</p>
                <Button asChild>
                  <a href={openDoc.pdfUrl} download={`${openDoc.title}.pdf`}>
                    <Download className="mr-2 h-4 w-4" />
                    Télécharger le PDF
                  </a>
                </Button>
              </div>
            </object>
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
