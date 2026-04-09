-- Mentions de documents sous les messages utilisateur (Assistant)
alter table public.chat_messages
  add column if not exists metadata jsonb not null default '{}'::jsonb;
