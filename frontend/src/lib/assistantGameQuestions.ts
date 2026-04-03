import { getApiBaseUrl } from "@/lib/api";

export interface AssistantGameQuestion {
  icon: string;
  text: string;
}

export async function fetchAssistantGameQuestions(): Promise<AssistantGameQuestion[]> {
  const r = await fetch(`${getApiBaseUrl()}/api/assistant-game-questions/`);
  if (!r.ok) throw new Error(`Erreur ${r.status}`);
  const data = (await r.json()) as { items?: unknown };
  if (!Array.isArray(data.items)) return [];
  return data.items
    .filter(
      (it): it is { icon?: unknown; text?: unknown } =>
        it != null && typeof it === "object",
    )
    .map((it) => ({
      icon: typeof it.icon === "string" && it.icon.trim() ? it.icon.trim() : "💬",
      text: typeof it.text === "string" ? it.text : "",
    }))
    .filter((it) => it.text.trim().length > 0);
}

export async function saveAssistantGameQuestions(
  items: AssistantGameQuestion[],
): Promise<AssistantGameQuestion[]> {
  const r = await fetch(`${getApiBaseUrl()}/api/assistant-game-questions/`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: items.map((q) => ({
        icon: q.icon.trim() || "💬",
        text: q.text.trim(),
      })),
    }),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(err || `Erreur ${r.status}`);
  }
  return fetchAssistantGameQuestions();
}
