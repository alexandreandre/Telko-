import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { getApiBaseUrl } from "@/lib/api";
import {
  RELEVANT_MODEL_GUIDE,
  findCatalogMatchForRelevantGuide,
  type RelevantModelGuideRow,
} from "@/lib/relevantModels";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface PricingBlock {
  prompt_per_1m_usd?: number | null;
  completion_per_1m_usd?: number | null;
  input_per_1m_usd?: number | null;
  output_per_1m_usd?: number | null;
}

/** OpenRouter peut renvoyer un entier ou un objet { context_length, max_completion_tokens, is_moderated }. */
type ContextLengthField =
  | number
  | null
  | undefined
  | {
      context_length?: number | null;
      max_completion_tokens?: number | null;
      is_moderated?: boolean | null;
    };

/** Heuristique backend : poids plutôt ouverts vs surtout API fermée ; « unknown » = non classé. */
type OpenWeightsCategory = "open" | "closed" | "unknown";

interface CatalogModel {
  id: string;
  name: string;
  open_weights_category?: OpenWeightsCategory;
  context_length?: ContextLengthField;
  /** Renseigné par le backend après normalisation (méta hors fenêtre principale). */
  context_meta?: {
    max_completion_tokens?: number | null;
    is_moderated?: boolean | null;
  } | null;
  pricing?: PricingBlock;
  local_hardware_hint?: Record<string, unknown> | null;
}

interface FeedbackStat {
  provider: string;
  model: string;
  count: number;
  avg_response_time_ms: number;
  total_cost_usd: number;
  /** Pourcentage de pouces haut parmi les retours. */
  satisfaction_rate: number;
}

interface UsageRow {
  model: string;
  run_count: number;
  avg_response_time_ms: number | null;
  avg_retrieval_ms: number | null;
  avg_first_token_ms: number | null;
  total_cost_usd: number;
  avg_cost_per_run_usd: number | null;
  avg_total_tokens: number | null;
  rated_run_count: number;
  satisfaction_from_runs_pct: number | null;
  catalog: CatalogModel | null;
  local_hardware_hint: Record<string, unknown> | null;
  feedback: FeedbackStat | null;
}

interface ComparatorPayload {
  usage_rows: UsageRow[];
  model_catalog: CatalogModel[];
  feedback_stats: FeedbackStat[];
  global: {
    total_generation_runs: number;
    total_cost_usd_observed: number;
    distinct_models_used: number;
  };
  local_hardware_documentation: { title: string; url: string }[];
}

type CatalogSortKey = "name" | "context" | "input" | "output" | "local_vram";

/** Nombre d’utilisateurs simultanés pour l’ordre de grandeur « pic » (colonne inférence locale). */
const LOCAL_INFERENCE_PEAK_USERS = 30;
/** Marge mémoire par requête active au-delà de la première (KV / contextes), en fraction de la VRAM « une instance ». */
const LOCAL_INFERENCE_OVERHEAD_PER_ACTIVE_USER = 0.09;

type CatalogSortState = { key: CatalogSortKey; dir: "asc" | "desc" };

const CATALOG_SORT_DEFAULT: CatalogSortState = { key: "name", dir: "asc" };

/** Colonnes du tableau « Activité et retours par modèle ». */
type UsageSortKey =
  | "model"
  | "run_count"
  | "avg_response_time_ms"
  | "avg_first_token_ms"
  | "total_cost_usd"
  | "avg_cost_per_run_usd"
  | "avg_total_tokens"
  | "satisfaction"
  | "local_vram";

type UsageSortState = { key: UsageSortKey; dir: "asc" | "desc" };

/** Tri initial : activité (runs) décroissante. */
const USAGE_SORT_DEFAULT: UsageSortState = { key: "run_count", dir: "desc" };

function defaultCatalogSortDir(key: CatalogSortKey): "asc" | "desc" {
  if (key === "input" || key === "output") return "asc";
  if (key === "context" || key === "local_vram") return "desc";
  return "asc";
}

function toggleCatalogSort(prev: CatalogSortState, key: CatalogSortKey): CatalogSortState {
  if (prev.key === key) return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
  return { key, dir: defaultCatalogSortDir(key) };
}

function defaultUsageSortDir(key: UsageSortKey): "asc" | "desc" {
  switch (key) {
    case "model":
      return "asc";
    case "run_count":
    case "avg_total_tokens":
    case "satisfaction":
      return "desc";
    case "avg_response_time_ms":
    case "avg_first_token_ms":
    case "total_cost_usd":
    case "avg_cost_per_run_usd":
      return "asc";
    case "local_vram":
      return "desc";
    default:
      return "desc";
  }
}

function toggleUsageSort(prev: UsageSortState, key: UsageSortKey): UsageSortState {
  if (prev.key === key) return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
  return { key, dir: defaultUsageSortDir(key) };
}

/** Fenêtre contexte (tokens) pour tri / affichage — même logique que la cellule catalogue. */
function getCatalogContextWindowTokens(m: CatalogModel): number | null {
  const raw = m.context_length;
  if (typeof raw === "number" && !Number.isNaN(raw)) return raw;
  if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
    const inner = raw.context_length;
    if (typeof inner === "number" && !Number.isNaN(inner)) return inner;
  }
  return null;
}

function getHardwareVramForSort(h: Record<string, unknown> | null | undefined): number | null {
  if (!h || typeof h !== "object") return null;
  const q = h.vram_gb_q4_k_m_typical;
  const f = h.vram_gb_fp16_typical;
  if (typeof q === "number" && Number.isFinite(q)) return q;
  if (typeof f === "number" && Number.isFinite(f)) return f;
  return null;
}

function cmpNullableNumber(a: number | null, b: number | null, dir: "asc" | "desc"): number {
  const na = a == null || Number.isNaN(a);
  const nb = b == null || Number.isNaN(b);
  if (na && nb) return 0;
  if (na) return 1;
  if (nb) return -1;
  const diff = (a as number) - (b as number);
  return dir === "asc" ? diff : -diff;
}

function cmpLocaleStr(a: string, b: string, dir: "asc" | "desc"): number {
  const c = a.localeCompare(b, "fr", { sensitivity: "base" });
  return dir === "asc" ? c : -c;
}

function fmtUsd(n: number | null | undefined, digits = 6) {
  if (n == null || Number.isNaN(n)) return "—";
  if (Math.abs(n) < 1e-5) return n.toExponential(2);
  return n.toFixed(digits);
}

function fmtNum(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  return Math.round(n).toLocaleString("fr-FR");
}

function fmtUsdLocaleShort(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return null;
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function readCatalogPricingUsdPer1m(m: CatalogModel | undefined): {
  input: number | null;
  output: number | null;
} {
  if (!m?.pricing) return { input: null, output: null };
  const inp = m.pricing.input_per_1m_usd ?? m.pricing.prompt_per_1m_usd ?? null;
  const out = m.pricing.output_per_1m_usd ?? m.pricing.completion_per_1m_usd ?? null;
  return { input: inp, output: out };
}

function RelevantGuideBulletList({ items }: { items: string[] }) {
  return (
    <ul className="text-xs text-muted-foreground list-disc pl-3.5 space-y-0.5 min-w-[200px] max-w-[320px]">
      {items.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
  );
}

function RelevantGuidePriceCell({
  row,
  live,
  hasLivePricing,
}: {
  row: RelevantModelGuideRow;
  live: { input: number | null; output: number | null };
  hasLivePricing: boolean;
}) {
  if (row.hideApiPricing) {
    return (
      <div className="text-xs text-right space-y-0.5">
        <div className="text-muted-foreground">—</div>
        <div className="text-[10px] text-muted-foreground/85 leading-snug">
          Cible inférence locale ; tarif API éventuel dans le catalogue ci‑dessous
        </div>
      </div>
    );
  }
  const approxDoc = row.pricingApprox && !hasLivePricing;
  const pfx = approxDoc ? "~" : "";
  if (hasLivePricing) {
    const a = fmtUsdLocaleShort(live.input);
    const b = fmtUsdLocaleShort(live.output);
    return (
      <div className="text-xs text-right space-y-0.5">
        <div className="font-mono">
          {pfx}
          {a ?? "—"} $ / {b ?? "—"} $
        </div>
        <div className="text-[10px] text-muted-foreground">Entrée · sortie · 1M tok. (OpenRouter)</div>
      </div>
    );
  }
  const s = row.staticPricingUsdPer1m;
  if (!s) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div className="text-xs text-right space-y-0.5">
      <div className="font-mono">
        {pfx}
        {fmtUsdLocaleShort(s.input)} $ / {fmtUsdLocaleShort(s.output)} $
      </div>
      <div className="text-[10px] text-muted-foreground">Indicatif (hors sync catalogue)</div>
    </div>
  );
}

/** Catégorie open‑source / API propriétaire, avec heuristique si le catalogue ne classe pas le modèle. */
function getModelOpenCategory(m: CatalogModel): OpenWeightsCategory {
  const explicit = m.open_weights_category;
  if (explicit === "open" || explicit === "closed") return explicit;

  const id = m.id.toLowerCase();

  const closedPrefixes = [
    "openai/",
    "anthropic/",
    "google/",
    "x-ai/",
    "cohere/",
    "databricks/",
    "mistral/large",
  ];
  if (closedPrefixes.some((p) => id.startsWith(p))) return "closed";

  return "unknown";
}

/** OpenRouter : top_provider est parfois une chaîne, parfois un objet (p. ex. limites, pas un nom affichable). */
function formatTopProviderLabel(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") {
    const s = v.trim();
    return s || "—";
  }
  if (typeof v !== "object" || Array.isArray(v)) return "—";
  const o = v as Record<string, unknown>;
  if (typeof o.name === "string" && o.name.trim()) return o.name.trim();
  if (typeof o.slug === "string" && o.slug.trim()) return o.slug.trim();
  if (typeof o.id === "string" && o.id.trim()) return o.id.trim();
  return "—";
}

function compareCatalogModels(a: CatalogModel, b: CatalogModel, sort: CatalogSortState): number {
  const { key, dir } = sort;
  let primary = 0;
  switch (key) {
    case "name":
      primary = cmpLocaleStr(a.name, b.name, dir);
      break;
    case "context":
      primary = cmpNullableNumber(getCatalogContextWindowTokens(a), getCatalogContextWindowTokens(b), dir);
      break;
    case "input":
      primary = cmpNullableNumber(a.pricing?.input_per_1m_usd ?? null, b.pricing?.input_per_1m_usd ?? null, dir);
      break;
    case "output":
      primary = cmpNullableNumber(
        a.pricing?.output_per_1m_usd ?? null,
        b.pricing?.output_per_1m_usd ?? null,
        dir,
      );
      break;
    case "local_vram":
      primary = cmpNullableNumber(
        getHardwareVramForSort(a.local_hardware_hint),
        getHardwareVramForSort(b.local_hardware_hint),
        dir,
      );
      break;
    default:
      primary = 0;
  }
  if (primary !== 0) return primary;
  return cmpLocaleStr(a.id, b.id, "asc");
}

function compareUsageRows(a: UsageRow, b: UsageRow, sort: UsageSortState): number {
  const { key, dir } = sort;
  let primary = 0;
  switch (key) {
    case "model": {
      const na = a.catalog?.name ?? a.model;
      const nb = b.catalog?.name ?? b.model;
      primary = cmpLocaleStr(na, nb, dir);
      if (primary === 0) primary = cmpLocaleStr(a.model, b.model, dir);
      break;
    }
    case "run_count":
      primary = (a.run_count - b.run_count) * (dir === "asc" ? 1 : -1);
      break;
    case "avg_response_time_ms":
      primary = cmpNullableNumber(a.avg_response_time_ms, b.avg_response_time_ms, dir);
      break;
    case "avg_first_token_ms":
      primary = cmpNullableNumber(a.avg_first_token_ms, b.avg_first_token_ms, dir);
      break;
    case "total_cost_usd":
      primary = cmpNullableNumber(a.total_cost_usd, b.total_cost_usd, dir);
      break;
    case "avg_cost_per_run_usd":
      primary = cmpNullableNumber(a.avg_cost_per_run_usd, b.avg_cost_per_run_usd, dir);
      break;
    case "avg_total_tokens":
      primary = cmpNullableNumber(a.avg_total_tokens, b.avg_total_tokens, dir);
      break;
    case "satisfaction":
      primary = cmpNullableNumber(
        a.feedback?.satisfaction_rate ?? null,
        b.feedback?.satisfaction_rate ?? null,
        dir,
      );
      break;
    case "local_vram":
      primary = cmpNullableNumber(
        getHardwareVramForSort(a.local_hardware_hint),
        getHardwareVramForSort(b.local_hardware_hint),
        dir,
      );
      break;
    default:
      primary = 0;
  }
  if (primary !== 0) return primary;
  return cmpLocaleStr(a.model, b.model, "asc");
}

function CatalogContextCell({ m }: { m: CatalogModel }) {
  let windowTokens: number | null = null;
  let maxOut: number | null = null;
  let moderated: boolean | undefined;

  windowTokens = getCatalogContextWindowTokens(m);
  const raw = m.context_length;
  if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
    if (typeof raw.max_completion_tokens === "number") maxOut = raw.max_completion_tokens;
    if (typeof raw.is_moderated === "boolean") moderated = raw.is_moderated;
  }

  const meta = m.context_meta;
  if (meta) {
    if (maxOut == null && typeof meta.max_completion_tokens === "number") maxOut = meta.max_completion_tokens;
    if (moderated === undefined && typeof meta.is_moderated === "boolean") moderated = meta.is_moderated;
  }

  const lines: string[] = [];
  if (maxOut != null) lines.push(`max sortie ${fmtNum(maxOut)} tok.`);
  if (moderated === true) lines.push("modéré");

  return (
    <div className="text-right">
      <div>{windowTokens != null ? fmtNum(windowTokens) : "—"}</div>
      {lines.length > 0 && (
        <div className="text-[11px] text-muted-foreground whitespace-normal max-w-[200px] ml-auto">
          {lines.join(" · ")}
        </div>
      )}
    </div>
  );
}

function HardwareHint({ h }: { h: Record<string, unknown> | null | undefined }) {
  if (!h || typeof h !== "object") return <span className="text-muted-foreground">—</span>;
  const vram = h.vram_gb_q4_k_m_typical ?? h.vram_gb_fp16_typical;
  const matchedRaw = h.matched_id;
  const matched = typeof matchedRaw === "string" ? matchedRaw : undefined;

  const hasVram = typeof vram === "number" && Number.isFinite(vram);
  let vramPeak: number | null = null;

  if (hasVram) {
    const extraUsers = Math.max(0, LOCAL_INFERENCE_PEAK_USERS - 1);
    const factor = 1 + extraUsers * LOCAL_INFERENCE_OVERHEAD_PER_ACTIVE_USER;
    vramPeak = Math.round(vram * factor * 10) / 10;
  }

  return (
    <div className="text-xs space-y-0.5 max-w-[260px]">
      {matched ? (
        <div className="text-muted-foreground truncate" title={matched}>
          {matched}
        </div>
      ) : null}
      {hasVram && (
        <div>
          <div>
            Carte graphique conseillée&nbsp;:{" "}
            {vramPeak != null
              ? `≈ ${vramPeak} Go pour ~${LOCAL_INFERENCE_PEAK_USERS} utilisateurs en pic`
              : "—"}
          </div>
          <div className="text-muted-foreground">
            Base pour un utilisateur&nbsp;: ~{vram} Go (ordre de grandeur)
          </div>
        </div>
      )}
      {typeof h.gpu_notes === "string" && <div className="text-muted-foreground">{h.gpu_notes}</div>}
    </div>
  );
}

function CatalogHardwareCell({ m }: { m: CatalogModel }) {
  const category = getModelOpenCategory(m);
  const h = m.local_hardware_hint;

  if (!h || typeof h !== "object") {
    if (category === "open") {
      return (
        <span className="text-xs text-muted-foreground">
          Ressources locales non documentées pour ce modèle open‑source (à dimensionner selon votre infra GPU).
        </span>
      );
    }
    return <span className="text-xs text-muted-foreground">Plutôt usage via API distante.</span>;
  }

  const vram = (h as any).vram_gb_q4_k_m_typical ?? (h as any).vram_gb_fp16_typical;

  const hasVram = typeof vram === "number" && Number.isFinite(vram);
  let vramPeak: number | null = null;

  if (hasVram) {
    const extraUsers = Math.max(0, LOCAL_INFERENCE_PEAK_USERS - 1);
    const factor = 1 + extraUsers * LOCAL_INFERENCE_OVERHEAD_PER_ACTIVE_USER;
    vramPeak = Math.round(vram * factor * 10) / 10;
  }

  if (category !== "open") {
    // Modèle principalement consommé via API : on reste très indicatif.
    return (
      <div className="text-xs space-y-0.5 max-w-[260px]">
        {hasVram && (
          <div className="text-muted-foreground">
            Repère GPU indicatif ~{vram} Go (profil interne).
          </div>
        )}
      </div>
    );
  }

  // Cas open‑source : on explicite clairement la ressource locale pour ~30 personnes.
  const rtxSuggestion = (() => {
    if (!vramPeak) return null;
    if (vramPeak <= 24) return "≈1× RTX 4090 / RTX 6000 24 Go";
    if (vramPeak <= 48) return "≈1× RTX 6000 48 Go ou 2× cartes 24 Go";
    if (vramPeak <= 80) return "≈1× A100/H100 80 Go ou 2× cartes 48 Go";
    if (vramPeak <= 160) return "≈2–4× RTX 6000 48 Go ou 2× A100 80 Go";
    return "cluster multi-GPU dédié (≥4 cartes 48–80 Go)";
  })();

  return (
    <div className="text-xs space-y-0.5 max-w-[260px]">
      {hasVram ? (
        <>
          <div>
            Ressources locales conseillées&nbsp;:{" "}
            {vramPeak != null
              ? `≈ ${vramPeak} Go de VRAM pour ~${LOCAL_INFERENCE_PEAK_USERS} personnes en même temps`
              : "—"}
          </div>
          <div className="text-muted-foreground">
            Ordre de grandeur par utilisateur&nbsp;: ~{vram} Go de VRAM.
          </div>
          {rtxSuggestion && <div className="text-muted-foreground">Exemple de parc&nbsp;: {rtxSuggestion}.</div>}
        </>
      ) : (
        <div className="text-muted-foreground">
          Modèle open‑source sans fiche GPU fiable — à compléter selon vos contraintes.
        </div>
      )}
    </div>
  );
}

function CatalogSortableHead({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: CatalogSortKey;
  sort: CatalogSortState;
  onSort: (k: CatalogSortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === sortKey;
  return (
    <TableHead
      className={cn(align === "right" && "text-right")}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title={
          active
            ? sort.dir === "asc"
              ? "Tri croissant — cliquer pour inverser"
              : "Tri décroissant — cliquer pour inverser"
            : "Trier cette colonne"
        }
        className={cn(
          "-mx-1 -my-0.5 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background",
          align === "right" && "ml-auto flex-row-reverse",
        )}
      >
        <span>{label}</span>
        <span className="inline-flex shrink-0 opacity-80" aria-hidden>
          {active ? (
            sort.dir === "asc" ? (
              <ArrowUp className="h-3.5 w-3.5" />
            ) : (
              <ArrowDown className="h-3.5 w-3.5" />
            )
          ) : (
            <ArrowUpDown className="h-3.5 w-3.5 opacity-45" />
          )}
        </span>
      </button>
    </TableHead>
  );
}

function UsageSortableHead({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: UsageSortKey;
  sort: UsageSortState;
  onSort: (k: UsageSortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === sortKey;
  return (
    <TableHead
      className={cn(align === "right" && "text-right")}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title={
          active
            ? sort.dir === "asc"
              ? "Tri croissant — cliquer pour inverser"
              : "Tri décroissant — cliquer pour inverser"
            : "Trier cette colonne"
        }
        className={cn(
          "-mx-1 -my-0.5 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background",
          align === "right" && "ml-auto flex-row-reverse",
        )}
      >
        <span>{label}</span>
        <span className="inline-flex shrink-0 opacity-80" aria-hidden>
          {active ? (
            sort.dir === "asc" ? (
              <ArrowUp className="h-3.5 w-3.5" />
            ) : (
              <ArrowDown className="h-3.5 w-3.5" />
            )
          ) : (
            <ArrowUpDown className="h-3.5 w-3.5 opacity-45" />
          )}
        </span>
      </button>
    </TableHead>
  );
}

export default function LLMComparator() {
  const [data, setData] = useState<ComparatorPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [catalogFilter, setCatalogFilter] = useState("");
  const [catalogOpenFilter, setCatalogOpenFilter] = useState<"all" | OpenWeightsCategory>("all");
  const [catalogSort, setCatalogSort] = useState<CatalogSortState>(CATALOG_SORT_DEFAULT);
  const [usageSort, setUsageSort] = useState<UsageSortState>(USAGE_SORT_DEFAULT);

  useEffect(() => {
    fetch(`${getApiBaseUrl()}/api/llm/comparator`)
      .then((r) => r.json())
      .then((j) => setData(j as ComparatorPayload))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  const usageRows = useMemo((): UsageRow[] => data?.usage_rows ?? [], [data]);

  // Debug simple : comptage des catégories côté front au chargement.
  useEffect(() => {
    if (!data?.model_catalog) return;
    const counts: Record<"open" | "closed" | "unknown", number> = { open: 0, closed: 0, unknown: 0 };
    for (const m of data.model_catalog) {
      const c = getModelOpenCategory(m);
      counts[c] += 1;
    }
    // eslint-disable-next-line no-console
    console.log("[LLMComparator] Répartition open/closed/unknown calculée côté front :", counts);
  }, [data]);

  const sortedUsageRows = useMemo(() => {
    const rows = [...usageRows];
    rows.sort((a, b) => compareUsageRows(a, b, usageSort));
    return rows;
  }, [usageRows, usageSort]);

  const filteredCatalog = useMemo(() => {
    if (!data?.model_catalog) return [];
    const q = catalogFilter.trim().toLowerCase();

    const res = data.model_catalog.filter((m) => {
      if (catalogOpenFilter !== "all") {
        const cat = getModelOpenCategory(m);
        if (cat !== catalogOpenFilter) return false;
      }
      if (!q) return true;
      return m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q);
    });
    // Debug ciblé sur le filtre actuellement sélectionné.
    // eslint-disable-next-line no-console
    console.log(
      "[LLMComparator] Filtre catalogue",
      { texte: q, openFilter: catalogOpenFilter },
      "→",
      res.length,
      "modèles",
    );
    return res;
  }, [data, catalogFilter, catalogOpenFilter]);

  const sortedFilteredCatalog = useMemo(() => {
    const rows = [...filteredCatalog];
    rows.sort((a, b) => compareCatalogModels(a, b, catalogSort));
    return rows;
  }, [filteredCatalog, catalogSort]);

  const relevantGuideEnriched = useMemo(() => {
    const cat = data?.model_catalog;
    return [...RELEVANT_MODEL_GUIDE]
      .sort((a, b) => a.order - b.order)
      .map((row) => {
        const matched = findCatalogMatchForRelevantGuide(cat, row.matchPrefixes);
        const live = readCatalogPricingUsdPer1m(matched);
        const hasLivePricing = live.input != null || live.output != null;
        return { row, matched, live, hasLivePricing };
      });
  }, [data?.model_catalog]);

  const onCatalogSortKey = (key: CatalogSortKey) => {
    setCatalogSort((s) => toggleCatalogSort(s, key));
  };

  const onUsageSortKey = (key: UsageSortKey) => {
    setUsageSort((s) => toggleUsageSort(s, key));
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="max-w-6xl mx-auto px-4 py-8 text-sm text-muted-foreground">Chargement…</div>
      </AppLayout>
    );
  }

  if (!data) {
    return (
      <AppLayout>
        <div className="max-w-6xl mx-auto px-4 py-8 text-destructive text-sm">
          Impossible de charger le comparateur (API indisponible).
        </div>
      </AppLayout>
    );
  }

  const { global, local_hardware_documentation } = data;

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-10">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Comparateur de modèles</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Tarifs OpenRouter (API), coûts et latences observés sur vos requêtes RAG, retours pouce haut / bas
            par message, et repères matériel pour un déploiement local (estimations — voir sources
            citées).
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Requêtes enregistrées</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold">{fmtNum(global.total_generation_runs)}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Coût API cumulé (estim.)</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold">${fmtUsd(global.total_cost_usd_observed, 4)}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Modèles utilisés</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold">{global.distinct_models_used}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Modèles au catalogue</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold">{data.model_catalog.length}</CardContent>
          </Card>
        </div>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Activité et retours par modèle</h2>
          <p className="text-xs text-muted-foreground">
            Cliquez sur un en-tête pour trier. Même colonne : sens inversé. Au premier clic : modèle A→Z ;
            runs, tokens et satisfaction (% de pouces haut) du plus élevé au plus bas ; latences et coûts du plus
            bas au plus haut ; VRAM locale du plus grand au plus petit. Les valeurs manquantes sont en bas.
          </p>
          {sortedUsageRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucune génération enregistrée pour l’instant. Utilisez l’assistant : chaque réponse alimente
              cette section. Les pouces sous les réponses de l’assistant alimentent la colonne « Satisfaction ».
            </p>
          ) : (
            <div className="rounded-xl border border-border overflow-x-auto shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow>
                    <UsageSortableHead
                      label="Modèle"
                      sortKey="model"
                      sort={usageSort}
                      onSort={onUsageSortKey}
                    />
                    <UsageSortableHead
                      label="Runs"
                      sortKey="run_count"
                      sort={usageSort}
                      onSort={onUsageSortKey}
                      align="right"
                    />
                    <UsageSortableHead
                      label="Temps moy. (ms)"
                      sortKey="avg_response_time_ms"
                      sort={usageSort}
                      onSort={onUsageSortKey}
                      align="right"
                    />
                    <UsageSortableHead
                      label="1er token (ms)"
                      sortKey="avg_first_token_ms"
                      sort={usageSort}
                      onSort={onUsageSortKey}
                      align="right"
                    />
                    <UsageSortableHead
                      label="Coût cumulé ($)"
                      sortKey="total_cost_usd"
                      sort={usageSort}
                      onSort={onUsageSortKey}
                      align="right"
                    />
                    <UsageSortableHead
                      label="Coût moyen par message ($)"
                      sortKey="avg_cost_per_run_usd"
                      sort={usageSort}
                      onSort={onUsageSortKey}
                      align="right"
                    />
                    <UsageSortableHead
                      label="Tokens"
                      sortKey="avg_total_tokens"
                      sort={usageSort}
                      onSort={onUsageSortKey}
                      align="right"
                    />
                    <UsageSortableHead
                      label="Satisfaction"
                      sortKey="satisfaction"
                      sort={usageSort}
                      onSort={onUsageSortKey}
                      align="right"
                    />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedUsageRows.map((u) => (
                    <TableRow key={u.model}>
                      <TableCell className="font-medium max-w-[200px]">
                        <div className="truncate" title={u.catalog?.name ?? u.model}>
                          {u.catalog?.name ?? u.model}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{u.run_count}</TableCell>
                      <TableCell className="text-right">{fmtNum(u.avg_response_time_ms)}</TableCell>
                      <TableCell className="text-right">{fmtNum(u.avg_first_token_ms)}</TableCell>
                      <TableCell className="text-right">{fmtUsd(u.total_cost_usd, 4)}</TableCell>
                      <TableCell className="text-right">{fmtUsd(u.avg_cost_per_run_usd, 4)}</TableCell>
                      <TableCell className="text-right">{fmtNum(u.avg_total_tokens)}</TableCell>
                      <TableCell className="text-right">
                        {u.feedback?.satisfaction_rate != null
                          ? `${u.feedback.satisfaction_rate.toFixed(1)} %${
                              u.feedback.count != null ? ` (${u.feedback.count} avis)` : ""
                            }`
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Modèles pertinents pour notre usage (RAG interne)</h2>
          <p className="text-xs text-muted-foreground max-w-3xl">
            Sélection méthodologique : API propriétaires d’abord (usage cloud), puis familles open‑source (souvent
            auto‑hébergées). Lorsqu’un ID OpenRouter correspond, les tarifs de la colonne prix sont repris du catalogue
            temps réel ; sinon ce sont des ordres de grandeur documentaires (les montants ~ sont estimés).
          </p>
          <div className="rounded-xl border border-border overflow-x-auto shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[160px]">Modèle</TableHead>
                  <TableHead className="min-w-[100px]">Type</TableHead>
                  <TableHead className="text-right min-w-[150px]">Prix API ($ / 1M tokens)</TableHead>
                  <TableHead className="min-w-[220px]">Points forts</TableHead>
                  <TableHead className="min-w-[220px]">Points faibles</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {relevantGuideEnriched.map(({ row, matched, live, hasLivePricing }) => (
                  <TableRow key={`${row.order}-${row.label}`}>
                    <TableCell className="align-top">
                      <div className="font-medium leading-snug">{row.label}</div>
                      <div className="text-[11px] text-muted-foreground">{row.vendor}</div>
                      {matched?.id ? (
                        <div className="text-[10px] font-mono text-muted-foreground/90 truncate max-w-[240px] mt-1" title={matched.id}>
                          {matched.id}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="align-top text-xs">
                      {row.kind === "proprietary_api" ? (
                        <span className="inline-flex rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[11px]">
                          API propriétaire
                        </span>
                      ) : (
                        <span className="inline-flex rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[11px]">
                          Open‑source
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      <RelevantGuidePriceCell row={row} live={live} hasLivePricing={hasLivePricing} />
                    </TableCell>
                    <TableCell className="align-top">
                      <RelevantGuideBulletList items={row.strengths} />
                    </TableCell>
                    <TableCell className="align-top">
                      <RelevantGuideBulletList items={row.weaknesses} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Catalogue OpenRouter complet</h2>
          <p className="text-xs text-muted-foreground">
            Liste exhaustive des modèles exposés par l’API (hors routeurs internes et offres gratuites filtrées côté
            serveur). Prix par million de tokens : colonnes « input / output » normalisées depuis OpenRouter. Cliquez
            sur un en-tête pour trier : même colonne = sens inversé ; prix du moins cher d’abord ; contexte et VRAM
            locale du plus grand d’abord. Les valeurs manquantes sont en bas. Le filtre permet de limiter aux modèles
            open‑source ou API propriétaire.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
            <Input
              placeholder="Filtrer par nom ou id…"
              value={catalogFilter}
              onChange={(e) => setCatalogFilter(e.target.value)}
              className="sm:max-w-md"
            />
            <Select
              value={catalogOpenFilter}
              onValueChange={(v) => setCatalogOpenFilter(v as "all" | OpenWeightsCategory)}
            >
              <SelectTrigger className="w-full sm:w-60">
                <SelectValue placeholder="Tous les modèles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les modèles</SelectItem>
                <SelectItem value="open">Open-source (poids ouverts)</SelectItem>
                <SelectItem value="closed">API propriétaire</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-xl border border-border overflow-x-auto max-h-[480px] overflow-y-auto shadow-sm">
              <Table>
              <TableHeader>
                <TableRow>
                  <CatalogSortableHead
                    label="Modèle"
                    sortKey="name"
                    sort={catalogSort}
                    onSort={onCatalogSortKey}
                  />
                  <CatalogSortableHead
                    label="$ / 1M token input"
                    sortKey="input"
                    sort={catalogSort}
                    onSort={onCatalogSortKey}
                    align="right"
                  />
                  <CatalogSortableHead
                    label="$ / 1M token output"
                    sortKey="output"
                    sort={catalogSort}
                    onSort={onCatalogSortKey}
                    align="right"
                  />
                  <CatalogSortableHead
                    label="Contexte max. (en token)"
                    sortKey="context"
                    sort={catalogSort}
                    onSort={onCatalogSortKey}
                    align="right"
                  />
                  <CatalogSortableHead
                    label="Ressources locales (≈30 pers.)"
                    sortKey="local_vram"
                    sort={catalogSort}
                    onSort={onCatalogSortKey}
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedFilteredCatalog.slice(0, 400).map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="max-w-[220px]">
                      <div className="font-medium truncate" title={m.name}>
                        {m.name}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {fmtUsd(m.pricing?.input_per_1m_usd ?? null, 4)}
                    </TableCell>
                    <TableCell className="text-right">
                      {fmtUsd(m.pricing?.output_per_1m_usd ?? null, 4)}
                    </TableCell>
                    <TableCell className="text-right align-top">
                      <CatalogContextCell m={m} />
                    </TableCell>
                    <TableCell>
                      <CatalogHardwareCell m={m} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {sortedFilteredCatalog.length > 400 && (
            <p className="text-xs text-muted-foreground">
              Affichage limité à 400 lignes — affinez le filtre ({sortedFilteredCatalog.length} correspondances).
            </p>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Ressources pour déploiement local</h2>
          <p className="text-sm text-muted-foreground">
            OpenRouter ne publie pas de fiche « RAM/GPU » par modèle. Les colonnes « Local » ci-dessus
            s’appuient sur un jeu de correspondances maintenu dans le dépôt ; complétez avec ces références :
          </p>
          <ul className="list-disc pl-5 text-sm space-y-1">
            {local_hardware_documentation.map((d) => (
              <li key={d.url}>
                <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                  {d.title}
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AppLayout>
  );
}
