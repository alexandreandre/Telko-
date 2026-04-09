-- Journal des exécutions LLM (stats + notation optionnelle) pour le comparateur cumulatif
create table if not exists public.llm_runs (
  id uuid primary key,
  provider text not null,
  model text not null,
  conversation_id text,
  response_time_ms integer not null default 0,
  first_token_ms integer not null default 0,
  llm_prompt_tokens integer,
  llm_completion_tokens integer,
  llm_total_tokens integer,
  embed_prompt_tokens integer,
  embed_total_tokens integer,
  total_tokens integer,
  cost_llm_usd double precision,
  cost_embed_usd double precision,
  cost_total_usd double precision,
  usage jsonb not null default '{}'::jsonb,
  ts double precision not null,
  rating smallint,
  rated_at timestamptz,
  constraint llm_runs_rating_check check (rating is null or rating in (1, 2))
);

create index if not exists llm_runs_model_ts_idx on public.llm_runs (model, ts desc);
create index if not exists llm_runs_rated_idx on public.llm_runs (model) where rating is not null;

alter table public.llm_runs enable row level security;
