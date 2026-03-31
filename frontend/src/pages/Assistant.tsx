import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

import {
  Send,
  Loader2,
  Plus,
  MessageSquare,
  Trash2,
  Bot,
  Sparkles,
  BookOpen,
  FileText,
  Check,
  ChevronsUpDown,
} from "lucide-react";

import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import DocumentMention, { type Doc } from "@/components/assistant/DocumentMention";
import MentionedDocBadge from "@/components/assistant/MentionedDocBadge";
import { extractPdfText, isPdfPlaceholderContent } from "@/lib/pdf-text";
import { getApiBaseUrl } from "@/lib/api";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

interface MessageMeta {
  provider: string;
  model: string;
  timing?: {
    response_time_ms?: number;
    first_token_ms?: number;
    retrieval_ms?: number;
  };
  usage?: {
    llm?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
    embeddings?: {
      prompt_tokens?: number;
      total_tokens?: number;
    };
    cost?: {
      llm_usd?: number;
      embeddings_usd?: number;
      total_usd?: number;
    };
    // Pour compat : usage brut renvoyé par OpenRouter (prompt_tokens, completion_tokens, total_tokens, cost, etc.)
    raw?: unknown;
  };
}

interface Conversation {
  id: string;
  title: string;
  updated_at: string;
}

interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  context_length: number;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
}

const getChatUrl = () => `${getApiBaseUrl()}/chat`;

const SUGGESTED_PROMPTS = [
  { icon: "📋", text: "Quelle est la procédure d'installation fibre optique ?" },
  { icon: "💰", text: "Quels sont nos tarifs entreprises 2025 ?" },
  { icon: "🔧", text: "Comment dépanner un problème réseau courant ?" },
  { icon: "🔒", text: "Résume notre politique de sécurité informatique" },
  { icon: "👋", text: "Quel est le process d'onboarding d'un nouvel employé ?" },
];

export default function Assistant() {
  const { user, profile, role } = useAuth();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [selectedModel, setSelectedModel] = useState<string>("openrouter/auto");
  const [modelPopoverOpen, setModelPopoverOpen] = useState(false);
  const [availableModels, setAvailableModels] = useState<OpenRouterModel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionedDocs, setMentionedDocs] = useState<Doc[]>([]);
  const [docCount, setDocCount] = useState(0);
  const [ratings, setRatings] = useState<Record<number, number>>({});
  const [ratingsSent, setRatingsSent] = useState<Record<number, boolean>>({});
  const [responseTimeMs, setResponseTimeMs] = useState<number>(0);
  const [sendTime, setSendTime] = useState<number>(0);
  const [messageMetas, setMessageMetas] = useState<Record<number, MessageMeta | undefined>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Fetch des modèles OpenRouter disponibles au montage
  useEffect(() => {
    fetch(`${getApiBaseUrl()}/api/llm/openrouter/models`)
      .then((r) => r.json())
      .then((data: { default_model?: string; models?: OpenRouterModel[] }) => {
        if (Array.isArray(data.models)) {
          setAvailableModels(data.models);
        }
        if (data.default_model) {
          setSelectedModel(data.default_model);
        }
      })
      .catch(() => {
        // En cas d'erreur on garde le modèle par défaut "openrouter/auto"
      });
  }, []);

  const openDocById = async (docId: string) => {
    const { data } = await supabase
      .from("knowledge_documents")
      .select("title, file_path")
      .eq("id", docId)
      .single();
    if (!data?.file_path) return;

    const { data: blob, error } = await supabase.storage
      .from("knowledge-files")
      .download(data.file_path);
    if (error || !blob) {
      toast({ title: "Erreur", description: "Impossible de prévisualiser ce PDF.", variant: "destructive" });
      return;
    }

    const blobUrl = URL.createObjectURL(blob);
    // Ouverture en prévisualisation dans un nouvel onglet (sans téléchargement forcé)
    window.open(blobUrl, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  };

  

  // Fetch doc count for display
  useEffect(() => {
    supabase.from("knowledge_documents").select("id", { count: "exact", head: true }).then(({ count }) => {
      setDocCount(count ?? 0);
    });
  }, []);

  const loadMessages = useCallback(async (convId: string) => {
    const { data } = await supabase
      .from("chat_messages")
      .select("role, content")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });
    setMessages((data as Msg[]) ?? []);
  }, []);

  const loadConversations = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("conversations")
      .select("id, title, updated_at")
      .order("updated_at", { ascending: false });
    setConversations(data ?? []);
  }, [user]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Au montage, on restaure la dernière conversation active si elle existe
  useEffect(() => {
    const savedId = window.localStorage.getItem("telko_active_conversation_id");
    if (savedId) {
      setActiveConvId(savedId);
      loadMessages(savedId);
    }
  }, [loadMessages]);

  // Persistance locale des métadonnées de messages et des notations par conversation
  useEffect(() => {
    if (!activeConvId) return;
    const metasRaw = window.localStorage.getItem(`telko_message_metas_${activeConvId}`);
    const ratingsRaw = window.localStorage.getItem(`telko_ratings_${activeConvId}`);
    const ratingsSentRaw = window.localStorage.getItem(`telko_ratings_sent_${activeConvId}`);
    if (metasRaw) {
      try {
        setMessageMetas(JSON.parse(metasRaw));
      } catch {
        // ignore JSON invalide
      }
    } else {
      setMessageMetas({});
    }
    if (ratingsRaw) {
      try {
        setRatings(JSON.parse(ratingsRaw));
      } catch {
        setRatings({});
      }
    } else {
      setRatings({});
    }
    if (ratingsSentRaw) {
      try {
        setRatingsSent(JSON.parse(ratingsSentRaw));
      } catch {
        setRatingsSent({});
      }
    } else {
      setRatingsSent({});
    }
  }, [activeConvId]);

  useEffect(() => {
    if (!activeConvId) return;
    window.localStorage.setItem(
      `telko_message_metas_${activeConvId}`,
      JSON.stringify(messageMetas),
    );
  }, [activeConvId, messageMetas]);

  useEffect(() => {
    if (!activeConvId) return;
    window.localStorage.setItem(`telko_ratings_${activeConvId}`, JSON.stringify(ratings));
  }, [activeConvId, ratings]);

  useEffect(() => {
    if (!activeConvId) return;
    window.localStorage.setItem(
      `telko_ratings_sent_${activeConvId}`,
      JSON.stringify(ratingsSent),
    );
  }, [activeConvId, ratingsSent]);

  const selectConversation = (convId: string) => {
    setActiveConvId(convId);
    window.localStorage.setItem("telko_active_conversation_id", convId);
    loadMessages(convId);
  };

  const startNewConversation = () => {
    if (activeConvId) {
      window.localStorage.removeItem(`telko_message_metas_${activeConvId}`);
      window.localStorage.removeItem(`telko_ratings_${activeConvId}`);
      window.localStorage.removeItem(`telko_ratings_sent_${activeConvId}`);
    }
    setActiveConvId(null);
    window.localStorage.removeItem("telko_active_conversation_id");
    setMessages([]);
    setMentionedDocs([]);
    setMessageMetas({});
    setRatings({});
    setRatingsSent({});
  };

  const deleteConversation = async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await supabase.from("conversations").delete().eq("id", convId);
    if (activeConvId === convId) {
      window.localStorage.removeItem(`telko_message_metas_${convId}`);
      window.localStorage.removeItem(`telko_ratings_${convId}`);
      window.localStorage.removeItem(`telko_ratings_sent_${convId}`);
      setActiveConvId(null);
      setMessages([]);
      setMessageMetas({});
      setRatings({});
      setRatingsSent({});
    }
    loadConversations();
  };

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInput(val);
    const atMatch = val.match(/@(\S*)$/);
    if (atMatch) {
      setMentionOpen(true);
      setMentionQuery(atMatch[1]);
    } else {
      setMentionOpen(false);
      setMentionQuery("");
    }
  };

  const handleDocSelect = (doc: Doc) => {
    const newInput = input.replace(/@\S*$/, "").trim();
    setInput(newInput);
    setMentionOpen(false);
    setMentionQuery("");
    if (!mentionedDocs.find((d) => d.id === doc.id)) {
      setMentionedDocs((prev) => [...prev, doc]);
    }
    inputRef.current?.focus();
  };

  const removeMentionedDoc = (docId: string) => {
    setMentionedDocs((prev) => prev.filter((d) => d.id !== docId));
  };

  const saveMessage = async (convId: string, msg: Msg) => {
    await supabase.from("chat_messages").insert({
      conversation_id: convId,
      role: msg.role,
      content: msg.content,
    });
  };

  const handleSend = async (overrideText?: string) => {
    const text = (overrideText || input).trim();
    if (!text || isLoading || !user) return;

    setIsLoading(true);

    let hydratedMentionedDocs = mentionedDocs;

    if (mentionedDocs.length > 0) {
      hydratedMentionedDocs = await Promise.all(
        mentionedDocs.map(async (doc) => {
          if (!isPdfPlaceholderContent(doc.content) || !doc.file_path) return doc;

          try {
            const { data: blob, error } = await supabase.storage
              .from("knowledge-files")
              .download(doc.file_path);

            if (error || !blob) return doc;

            const extractedContent = await extractPdfText(blob);
            if (!extractedContent.trim()) return doc;

            return { ...doc, content: extractedContent };
          } catch {
            return doc;
          }
        }),
      );

      const unresolvedDocs = hydratedMentionedDocs.filter((doc) =>
        isPdfPlaceholderContent(doc.content),
      );

      if (unresolvedDocs.length > 0) {
        toast({
          title: "Extraction PDF incomplète",
          description:
            "Impossible de lire le texte du PDF mentionné. Réuploadez le fichier depuis la Base documentaire pour l’indexer correctement.",
          variant: "destructive",
        });
        setIsLoading(false);
        return;
      }
    }

    let docContext = "";
    if (hydratedMentionedDocs.length > 0) {
      docContext = hydratedMentionedDocs
        .map((d) => `[Document: ${d.title}]\n${d.content}`)
        .join("\n\n");
    }

    const userMsg: Msg = { role: "user", content: text };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput("");
    setMentionedDocs([]);

    let convId = activeConvId;

    if (!convId) {
      const title = text.length > 50 ? text.slice(0, 50) + "…" : text;
      const { data } = await supabase
        .from("conversations")
        .insert({ user_id: user.id, title })
        .select("id")
        .single();
      if (!data) {
        toast({ title: "Erreur", description: "Impossible de créer la conversation", variant: "destructive" });
        setIsLoading(false);
        return;
      }
      convId = data.id;
      setActiveConvId(convId);
      window.localStorage.setItem("telko_active_conversation_id", convId);
      loadConversations();
    } else {
      await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);
    }

    await saveMessage(convId, userMsg);

    let assistantSoFar = "";

    const apiMessages = updatedMessages.map((m) => ({ role: m.role, content: m.content }));
    if (docContext) {
      const lastIdx = apiMessages.length - 1;
      apiMessages[lastIdx] = {
        ...apiMessages[lastIdx],
        content: `[Documents référencés]\n${docContext}\n\n[Question]\n${apiMessages[lastIdx].content}`,
      };
    }

    setSendTime(Date.now());

    try {
      const resp = await fetch(getChatUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: apiMessages,
          role_name: role?.role_name,
          department: profile?.department,
          provider: "openrouter",
          model: selectedModel,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Erreur réseau" }));
        toast({ title: "Erreur", description: err.error, variant: "destructive" });
        setIsLoading(false);
        return;
      }

      if (!resp.body) throw new Error("No response body");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";
      let streamDone = false;

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") {
            setResponseTimeMs(Date.now() - sendTime);
            streamDone = true;
            break;
          }

          try {
            const parsed = JSON.parse(jsonStr);
            // Event "meta" envoyé en fin de stream avec les stats détaillées
            if (parsed.meta) {
              setResponseTimeMs(parsed.meta?.timing?.response_time_ms ?? Date.now() - sendTime);
              // On attache toujours les métadonnées au DERNIER message de la liste,
              // qui est l'assistant en cours de génération.
              setMessages((prev) => {
                const lastIndex = Math.max(0, prev.length - 1);
                setMessageMetas((prevMeta) => ({
                  ...prevMeta,
                  [lastIndex]: parsed.meta as MessageMeta,
                }));
                return prev;
              });
              continue;
            }

            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) {
              assistantSoFar += content;
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") {
                  return prev.map((m, i) =>
                    i === prev.length - 1 ? { ...m, content: assistantSoFar } : m,
                  );
                }
                return [...prev, { role: "assistant", content: assistantSoFar }];
              });
            }
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }

      if (assistantSoFar && convId) {
        await saveMessage(convId, { role: "assistant", content: assistantSoFar });
      }
    } catch (e) {
      console.error(e);
      toast({ title: "Erreur", description: "Impossible de contacter l'assistant.", variant: "destructive" });
    }

    setIsLoading(false);
    loadConversations();
  };

  const handleRating = async (messageIndex: number, rating: number, response: string) => {
    setRatings((prev) => ({ ...prev, [messageIndex]: rating }));

    const userMessage = messages[messageIndex - 1]?.content ?? "";

    try {
      await fetch(`${getApiBaseUrl()}/api/feedback/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "openrouter",
          model: selectedModel,
          prompt: userMessage,
          response,
          rating,
          response_time_ms: responseTimeMs,
          conversation_id: activeConvId ?? undefined,
        }),
      });
      setRatingsSent((prev) => ({ ...prev, [messageIndex]: true }));
    } catch (err) {
      console.error("Erreur envoi feedback:", err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mentionOpen) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const selectedModelLabel =
    availableModels.find((m) => m.id === selectedModel)?.name ?? selectedModel ?? "Choisir un modèle";

  const formatModelLabel = (modelIdOrName: string | undefined) => {
    if (!modelIdOrName) return "Modèle OpenRouter";
    const fromList = availableModels.find((m) => m.id === modelIdOrName || m.name === modelIdOrName);
    if (fromList?.name) return fromList.name;
    if (modelIdOrName.startsWith("openrouter/")) {
      const raw = modelIdOrName.replace("openrouter/", "");
      return raw
        .split(/[-_]/)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
    }
    return modelIdOrName;
  };

  return (
    <AppLayout>
      <div className="flex gap-4 h-[calc(100vh-7rem)]">
        {/* Conversations sidebar */}
        <div className="w-56 shrink-0 hidden md:flex flex-col gap-2">
          <Button size="sm" variant="outline" className="w-full" onClick={startNewConversation}>
            <Plus className="mr-2 h-4 w-4" /> Nouvelle conversation
          </Button>
          <div className="flex-1 overflow-y-auto space-y-1">
            {conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => selectConversation(conv.id)}
                className={`w-full text-left text-xs p-2 rounded-md flex items-center gap-2 group ${
                  activeConvId === conv.id ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:bg-muted/50"
                }`}
              >
                <MessageSquare className="h-3 w-3 shrink-0" />
                <span className="truncate flex-1">{conv.title}</span>
                <Trash2
                  className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100 hover:text-destructive"
                  onClick={(e) => deleteConversation(conv.id, e)}
                />
              </button>
            ))}
          </div>
        </div>

        {/* Chat area */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Bot className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">Assistant IA Interne</h1>
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <span className="flex items-center gap-1">
                    <BookOpen className="h-3 w-3" /> {docCount} documents indexés
                  </span>
                </p>
                <Badge variant="secondary" className="text-[11px] px-2 py-0.5 flex items-center gap-1">
                  <Sparkles className="h-3 w-3" />
                  <span className="font-medium">
                    {formatModelLabel(
                      availableModels.find((m) => m.id === selectedModel)?.name ?? selectedModel,
                    )}
                  </span>
                </Badge>
              </div>
            </div>
          </div>

          <div className="flex gap-2 mb-3 flex-wrap">
            <Badge variant="outline" className="text-xs">{role?.role_name ?? "Non assigné"}</Badge>
            <Badge variant="outline" className="text-xs">{profile?.department ?? "Non assigné"}</Badge>
          </div>

          <Card className="flex-1 flex flex-col min-h-0">
            <CardContent ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full gap-6">
                  <div className="text-center space-y-2">
                    <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                      <Sparkles className="h-8 w-8 text-primary" />
                    </div>
                    <h2 className="text-lg font-medium text-foreground">Comment puis-je vous aider ?</h2>
                    <p className="text-sm text-muted-foreground max-w-md">
                      Je connais l'intégralité de votre base documentaire. Posez-moi une question ou utilisez <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">@</kbd> pour cibler un document précis.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
                    {SUGGESTED_PROMPTS.map((prompt, i) => (
                      <button
                        key={i}
                        onClick={() => handleSend(prompt.text)}
                        className="text-left p-3 rounded-lg border border-border hover:bg-muted/50 hover:border-primary/30 transition-colors text-sm"
                      >
                        <span className="mr-2">{prompt.icon}</span>
                        <span className="text-muted-foreground">{prompt.text}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((msg, i) => (
                <div key={i} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
                  <div
                    className={`rounded-lg px-3 py-2 max-w-[75%] text-sm ${
                      msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                    }`}
                  >
                    {msg.role === "assistant" ? (
                      <div className="prose prose-sm max-w-none dark:prose-invert [&_a]:text-primary [&_a]:underline [&_a]:cursor-pointer">
                        <ReactMarkdown
                          components={{
                            a: ({ href, children, ...props }) => {
                              const docMatch = href?.match(/\/knowledge-base\?doc=([a-f0-9-]+)/);
                              if (docMatch) {
                                return (
                                  <a
                                    {...props}
                                    href="#"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      openDocById(docMatch[1]);
                                    }}
                                    className="inline-flex items-center gap-1 text-primary underline hover:text-primary/80 cursor-pointer"
                                  >
                                    <FileText className="h-3 w-3 inline" />
                                    {children}
                                  </a>
                                );
                              }
                              return (
                                <a {...props} href={href} target="_blank" rel="noopener noreferrer">
                                  {children}
                                </a>
                              );
                            },
                          }}
                        >
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      msg.content
                    )}
                  </div>
                  {msg.role === "assistant" && (
                    <div className="flex flex-col items-start gap-1 mt-1 text-xs">
                      {(() => {
                        const meta = messageMetas[i];
                        if (!meta) return null;
                        const t = meta.timing;
                        const u = meta.usage as any | undefined;
                        const llmTokensTotal =
                          u?.llm?.total_tokens != null
                            ? u.llm.total_tokens
                            : u?.raw?.total_tokens;
                        const embedTokensTotal =
                          u?.embeddings?.total_tokens != null
                            ? u.embeddings.total_tokens
                            : undefined;
                        const totalCostUsd =
                          u?.cost?.total_usd != null
                            ? u.cost.total_usd
                            : u?.raw?.cost;
                        return (
                          <div className="flex flex-col gap-1 px-3 py-2 rounded-lg bg-muted/70 text-muted-foreground border border-border/60 max-w-[420px]">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-foreground text-[11px] uppercase tracking-wide">
                                Statistiques de cette réponse
                              </span>
                              <span className="text-[11px] text-muted-foreground/90">
                                {formatModelLabel(meta.model || selectedModel)}
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                              <div>
                                <div className="text-muted-foreground/80">Temps 1er token</div>
                                <div className="font-mono">
                                  {t?.first_token_ms != null
                                    ? `${t.first_token_ms.toLocaleString("fr-FR")} ms`
                                    : "—"}
                                </div>
                              </div>
                              <div>
                                <div className="text-muted-foreground/80">Temps total</div>
                                <div className="font-mono">
                                  {(t?.response_time_ms ?? responseTimeMs) > 0
                                    ? `~${(t?.response_time_ms ?? responseTimeMs).toLocaleString("fr-FR")} ms`
                                    : "—"}
                                </div>
                              </div>
                              <div>
                                <div className="text-muted-foreground/80">Tokens LLM</div>
                                <div className="font-mono">
                                  {llmTokensTotal != null
                                    ? llmTokensTotal.toLocaleString("fr-FR")
                                    : "—"}
                                </div>
                              </div>
                              <div>
                                <div className="text-muted-foreground/80">Tokens embeddings</div>
                                <div className="font-mono">
                                  {embedTokensTotal != null
                                    ? embedTokensTotal.toLocaleString("fr-FR")
                                    : "—"}
                                </div>
                              </div>
                              <div>
                                <div className="text-muted-foreground/80">Coût total</div>
                                <div className="font-mono">
                                  {totalCostUsd != null
                                    ? `$${totalCostUsd.toFixed(6)}`
                                    : "—"}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                      {messageMetas[i] && (
                        <div className="inline-flex items-center gap-2 px-2 py-0.5 rounded-full bg-primary/5 border border-primary/40 text-[11px]">
                        {ratingsSent[i] ? (
                          <span className="text-[11px] text-green-600">Merci pour votre retour ✓</span>
                        ) : (
                          <>
                            <span className="font-medium text-foreground/90">Votre avis sur cette réponse :</span>
                            <div className="flex items-center gap-0.5">
                              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((star) => (
                                <button
                                  key={star}
                                  onClick={() => handleRating(i, star, msg.content)}
                                  className={`text-sm leading-none px-0.5 transition-colors ${
                                    (ratings[i] ?? 0) >= star
                                      ? "text-yellow-400"
                                      : "text-gray-300 hover:text-yellow-300"
                                  }`}
                                  aria-label={`Note ${star} sur 10`}
                                >
                                  ★
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-lg px-3 py-2 text-sm flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-xs text-muted-foreground">Recherche dans la base documentaire...</span>
                  </div>
                </div>
              )}
            </CardContent>

            <div className="border-t border-border p-4 space-y-2">
              {/* Sélecteur de modèle OpenRouter (combobox avec recherche intégrée) */}
              {availableModels.length > 0 && (
                <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                  <span className="shrink-0">Modèle OpenRouter :</span>
                  <Popover open={modelPopoverOpen} onOpenChange={setModelPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={modelPopoverOpen}
                        className="h-8 max-w-xs justify-between text-xs"
                      >
                        <span className="truncate mr-2">{selectedModelLabel}</span>
                        <ChevronsUpDown className="h-3 w-3 opacity-60" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[320px] p-0">
                      <Command>
                        <CommandInput placeholder="Rechercher un modèle…" className="h-8 text-xs" />
                        <CommandList>
                          <CommandEmpty className="text-[11px] text-muted-foreground px-2 py-2">
                            Aucun modèle ne correspond à la recherche.
                          </CommandEmpty>
                          <CommandGroup>
                            {availableModels.map((m) => (
                              <CommandItem
                                key={m.id}
                                value={`${m.name ?? m.id} ${m.id}`}
                                onSelect={() => {
                                  setSelectedModel(m.id);
                                  setModelPopoverOpen(false);
                                }}
                                className="text-xs"
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-3.5 w-3.5",
                                    selectedModel === m.id ? "opacity-100" : "opacity-0",
                                  )}
                                />
                                <div className="flex flex-col items-start">
                                  <span className="truncate max-w-[220px]">
                                    {m.name ?? m.id}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground truncate max-w-[220px]">
                                    {m.id}
                                  </span>
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
              )}

              {mentionedDocs.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {mentionedDocs.map((doc) => (
                    <MentionedDocBadge key={doc.id} title={doc.title} content={doc.content} onRemove={() => removeMentionedDoc(doc.id)} />
                  ))}
                </div>
              )}

              <div className="relative flex gap-2">
                <DocumentMention
                  isOpen={mentionOpen}
                  query={mentionQuery}
                  onSelect={handleDocSelect}
                  onClose={() => setMentionOpen(false)}
                />
                <Input
                  ref={inputRef}
                  placeholder="Posez votre question... (@ pour cibler un document)"
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  disabled={isLoading}
                />
                <Button onClick={() => handleSend()} size="icon" disabled={isLoading}>
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </Card>
        </div>



      </div>

    </AppLayout>
  );
}
