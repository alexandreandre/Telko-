import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getKnowledgeFileKind, knowledgeFileLucideIcon } from "@/lib/knowledge-files";

interface Doc {
  id: string;
  title: string;
  content: string;
  file_path: string | null;
}

interface DocumentMentionProps {
  isOpen: boolean;
  query: string;
  onSelect: (doc: Doc) => void;
  onClose: () => void;
}

export default function DocumentMention({ isOpen, query, onSelect, onClose }: DocumentMentionProps) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    const fetchDocs = async () => {
      let q = supabase
        .from("knowledge_documents")
        .select("id, title, content, file_path")
        .order("updated_at", { ascending: false })
        .limit(8);

      if (query) {
        q = q.ilike("title", `%${query}%`);
      }

      const { data } = await q;
      setDocs(data ?? []);
      setSelectedIndex(0);
      setLoading(false);
    };
    fetchDocs();
  }, [isOpen, query]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!isOpen || docs.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, docs.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        onSelect(docs[selectedIndex]);
      } else if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, docs, selectedIndex, onSelect, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 mb-2 w-full max-w-md bg-popover border border-border rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto"
    >
      <div className="p-2 text-xs text-muted-foreground border-b border-border font-medium">
        📄 Documents disponibles
      </div>
      {loading && (
        <div className="p-3 text-xs text-muted-foreground">Recherche...</div>
      )}
      {!loading && docs.length === 0 && (
        <div className="p-3 text-xs text-muted-foreground">Aucun document trouvé</div>
      )}
      {docs.map((doc, i) => {
        const pathOrTitle = doc.file_path || doc.title;
        const Icon = doc.file_path
          ? knowledgeFileLucideIcon(getKnowledgeFileKind(pathOrTitle))
          : knowledgeFileLucideIcon("unknown");
        return (
        <button
          key={doc.id}
          className={`w-full text-left px-3 py-2 flex items-center gap-2 text-sm transition-colors ${
            i === selectedIndex ? "bg-accent text-accent-foreground" : "hover:bg-muted"
          }`}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(doc);
          }}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          <Icon className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate">{doc.title}</span>
        </button>
        );
      })}
    </div>
  );
}

export type { Doc };
