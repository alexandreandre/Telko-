-- Extraits du message utilisateur / réponse assistant (traçabilité par run)
alter table public.llm_runs
  add column if not exists user_prompt_excerpt text,
  add column if not exists assistant_response_excerpt text;
