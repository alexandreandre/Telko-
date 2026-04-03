import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ClipboardList, Loader2, Plus, Save, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import {
  fetchAssistantGameQuestions,
  saveAssistantGameQuestions,
  type AssistantGameQuestion,
} from "@/lib/assistantGameQuestions";

function emptyRow(): AssistantGameQuestion {
  return { icon: "💬", text: "" };
}

export default function QuestionGame() {
  const { toast } = useToast();
  const [items, setItems] = useState<AssistantGameQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchAssistantGameQuestions();
      setItems(list.length > 0 ? list : [emptyRow()]);
    } catch (e) {
      console.error(e);
      toast({
        title: "Impossible de charger les questions",
        description: e instanceof Error ? e.message : "Erreur réseau",
        variant: "destructive",
      });
      setItems([emptyRow()]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const move = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= items.length) return;
    setItems((prev) => {
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  };

  const handleSave = async () => {
    const cleaned = items
      .map((q) => ({
        icon: (q.icon || "💬").trim() || "💬",
        text: q.text.trim(),
      }))
      .filter((q) => q.text.length > 0);

    setSaving(true);
    try {
      const saved = await saveAssistantGameQuestions(cleaned);
      setItems(saved.length > 0 ? saved : [emptyRow()]);
      toast({ title: "Enregistré", description: "La liste est à jour pour tout le monde." });
    } catch (e) {
      console.error(e);
      toast({
        title: "Échec de l'enregistrement",
        description: e instanceof Error ? e.message : "Erreur réseau",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <ClipboardList className="h-7 w-7 text-primary" />
            Jeu de questions
          </h1>
          <p className="text-sm text-muted-foreground">
            Liste partagée : ces suggestions apparaissent sur l’
            <Link to="/assistant" className="text-primary underline underline-offset-2 hover:text-primary/80">
              Assistant
            </Link>{" "}
            (nouvelle conversation et fil de discussion). Tout utilisateur connecté peut modifier cette liste.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Questions suggérées</CardTitle>
            <CardDescription>
              Icône (emoji optionnel) et texte. Les lignes sans texte sont ignorées à l’enregistrement.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" />
                Chargement…
              </div>
            ) : items.length === 0 ? (
              <div className="py-6 text-center space-y-3">
                <p className="text-sm text-muted-foreground">Aucune ligne. Ajoutez une question pour commencer.</p>
                <Button type="button" variant="outline" size="sm" onClick={() => setItems([emptyRow()])}>
                  <Plus className="h-4 w-4 mr-1" />
                  Ajouter une ligne
                </Button>
              </div>
            ) : (
              <>
                <ul className="space-y-3">
                  {items.map((row, i) => (
                    <li
                      key={i}
                      className="flex flex-col sm:flex-row gap-2 sm:items-start p-3 rounded-lg border border-border bg-muted/20"
                    >
                      <Input
                        className="w-full sm:w-14 text-center font-medium shrink-0"
                        placeholder="💬"
                        maxLength={32}
                        value={row.icon}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((p, j) => (j === i ? { ...p, icon: e.target.value } : p)),
                          )
                        }
                        aria-label={`Emoji ligne ${i + 1}`}
                      />
                      <Textarea
                        className="min-h-[72px] flex-1 text-sm resize-y"
                        placeholder="Texte de la question…"
                        maxLength={2000}
                        value={row.text}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((p, j) => (j === i ? { ...p, text: e.target.value } : p)),
                          )
                        }
                        aria-label={`Question ${i + 1}`}
                      />
                      <div className="flex sm:flex-col gap-1 shrink-0">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          disabled={i === 0}
                          onClick={() => move(i, -1)}
                          aria-label="Monter"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          disabled={i === items.length - 1}
                          onClick={() => move(i, 1)}
                          aria-label="Descendre"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))}
                          aria-label="Supprimer"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setItems((p) => [...p, emptyRow()])}>
                    <Plus className="h-4 w-4 mr-1" />
                    Ajouter une ligne
                  </Button>
                  <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                    Enregistrer
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
