create table if not exists public.editions (
  edition_date date primary key,
  status text not null check (status in ('generating', 'published', 'failed')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  published_at timestamptz
);

alter table public.editions enable row level security;

create policy "published editions are publicly readable"
  on public.editions
  for select
  using (status = 'published');
