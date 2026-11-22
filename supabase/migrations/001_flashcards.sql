create table public.vocabulary_source (
  source_row_id bigint generated always as identity primary key,
  source_name text not null,
  source_url text not null,
  source_version text,
  source_fields jsonb not null,
  imported_at timestamptz not null default now()
);

create table public.cards (
  card_id integer primary key,
  topik_level smallint not null
    check (topik_level between 1 and 6),
  hangul text not null,
  hanja text,
  part_of_speech text not null,
  ipa text,
  definitions_en jsonb not null default '[]'::jsonb,
  example_ko text not null,
  example_en text not null,
  created_at timestamptz not null default now()
);

create table public.content_sources (
  content_source_id bigint generated always as identity primary key,
  card_id integer not null references public.cards(card_id)
    on delete cascade,
  source_name text not null,
  source_url text,
  source_version text,
  license_code text,
  attribution_text text,
  modifications text
);

create table public.card_audio (
  audio_id bigint generated always as identity primary key,
  card_id integer not null references public.cards(card_id)
    on delete cascade,
  target_segment text not null
    check (target_segment in ('headword', 'example')),
  source_type text not null,
  voice_label text not null,
  storage_key text not null,
  license_code text,
  attribution_text text,
  duration_ms integer,
  unique (card_id, target_segment, source_type, voice_label)
);

create table public.user_card_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id integer not null references public.cards(card_id)
    on delete cascade,
  due_at timestamptz not null default now(),
  interval_days integer not null default 0,
  ease_factor real not null default 2.5,
  repetitions integer not null default 0,
  last_reviewed_at timestamptz,
  primary key (user_id, card_id)
);

alter table public.cards enable row level security;
alter table public.content_sources enable row level security;
alter table public.card_audio enable row level security;
alter table public.user_card_progress enable row level security;

create policy "Cards are readable"
  on public.cards for select using (true);

create policy "Content sources are readable"
  on public.content_sources for select using (true);

create policy "Audio metadata is readable"
  on public.card_audio for select using (true);

create policy "Users read their own progress"
  on public.user_card_progress for select
  using (auth.uid() = user_id);

create policy "Users add their own progress"
  on public.user_card_progress for insert
  with check (auth.uid() = user_id);

create policy "Users update their own progress"
  on public.user_card_progress for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users delete their own progress"
  on public.user_card_progress for delete
  using (auth.uid() = user_id);

create index user_progress_due_idx
  on public.user_card_progress (user_id, due_at);

create index card_audio_lookup_idx
  on public.card_audio (card_id, target_segment);

