-- Bases où llm_runs existait déjà sans conversation_id (erreur PGRST204 côté API).
alter table public.llm_runs add column if not exists conversation_id text;
