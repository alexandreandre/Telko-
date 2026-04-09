-- Reconstruit public.llm_runs au schéma attendu par l'API Telko (uuid, usage jsonb,
-- coûts LLM/embed séparés, notation, ts = epoch float).
--
-- À exécuter si la table a été créée à la main (ex. id bigserial, sans cost_embed_usd).
-- Les lignes existantes sont recopiées avec un nouvel id UUID ; ts timestamptz -> epoch.

drop table if exists public.llm_runs_new;

create table public.llm_runs_new (
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
  user_prompt_excerpt text,
  assistant_response_excerpt text,
  constraint llm_runs_rating_check check (rating is null or rating in (1, 2))
);

insert into public.llm_runs_new (
  id,
  provider,
  model,
  conversation_id,
  response_time_ms,
  first_token_ms,
  llm_prompt_tokens,
  llm_completion_tokens,
  llm_total_tokens,
  embed_prompt_tokens,
  embed_total_tokens,
  total_tokens,
  cost_llm_usd,
  cost_embed_usd,
  cost_total_usd,
  usage,
  ts,
  rating,
  rated_at,
  user_prompt_excerpt,
  assistant_response_excerpt
)
select
  gen_random_uuid(),
  provider,
  model,
  conversation_id,
  response_time_ms,
  first_token_ms,
  null,
  null,
  null,
  null,
  null,
  total_tokens,
  null,
  null,
  cost_total_usd,
  '{}'::jsonb,
  extract(epoch from ts)::double precision,
  null,
  null,
  user_prompt_excerpt,
  assistant_response_excerpt
from public.llm_runs;

drop table public.llm_runs;

alter table public.llm_runs_new rename to llm_runs;

create index if not exists llm_runs_model_ts_idx on public.llm_runs (model, ts desc);
create index if not exists llm_runs_rated_idx on public.llm_runs (model) where rating is not null;

alter table public.llm_runs enable row level security;
