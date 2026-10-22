create table if not exists settings (
  id int primary key default 1 check (id = 1),
  auto_trade boolean not null default true,
  risk_pct numeric not null default 1,
  max_daily_loss_pct numeric not null default 3,
  max_positions int not null default 3,
  min_rr numeric not null default 2,
  min_score int not null default 70,
  exit_score int not null default 40,
  dte_min int not null default 3,
  dte_max int not null default 10,
  max_premium_pct numeric not null default 25,
  close_eod boolean not null default true,
  include_movers boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists accounts (
  id serial primary key,
  start_balance numeric not null,
  started_at timestamptz not null default now(),
  active boolean not null default true
);

create table if not exists trades (
  id serial primary key,
  account_id int not null references accounts(id),
  source text not null,
  symbol text not null,
  direction text not null,
  option_symbol text not null,
  option_type text not null,
  strike numeric not null,
  expiration date not null,
  qty int not null,
  status text not null,
  entry_order_id text,
  exit_order_id text,
  entry_limit numeric,
  entry_price numeric,
  exit_price numeric,
  created_at timestamptz not null default now(),
  opened_at timestamptz,
  closed_at timestamptz,
  underlying_entry numeric not null,
  underlying_stop numeric not null,
  underlying_target numeric not null,
  option_stop numeric not null,
  planned_risk numeric not null,
  planned_reward numeric not null,
  planned_rr numeric not null,
  score int not null,
  reason text not null,
  exit_reason text,
  fees numeric not null default 0,
  realized_pnl numeric,
  mark numeric,
  mark_at timestamptz,
  delta numeric
);
create index if not exists trades_account_status on trades (account_id, status);

create table if not exists scans (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  trigger text not null,
  market_open boolean not null,
  data_as_of timestamptz,
  status text not null,
  message text
);
create index if not exists scans_created on scans (created_at desc);

create table if not exists signals (
  id bigserial primary key,
  scan_id bigint not null references scans(id) on delete cascade,
  symbol text not null,
  is_core boolean not null,
  action text not null,
  direction text,
  score int not null,
  price numeric,
  change_pct numeric,
  entry numeric,
  stop numeric,
  target numeric,
  rr numeric,
  reason text not null,
  components jsonb,
  option jsonb
);
create index if not exists signals_scan on signals (scan_id);

create table if not exists equity_snapshots (
  id bigserial primary key,
  account_id int not null references accounts(id),
  taken_at timestamptz not null default now(),
  equity numeric not null,
  cash numeric not null
);
create index if not exists equity_account_time on equity_snapshots (account_id, taken_at);

create table if not exists bot_state (
  id int primary key default 1 check (id = 1),
  lock_until timestamptz,
  last_tick_at timestamptz,
  last_status text,
  last_message text,
  halted_date date
);

create table if not exists bot_log (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  kind text not null,
  message text not null
);
create index if not exists bot_log_created on bot_log (created_at desc);

create table if not exists backtests (
  id serial primary key,
  created_at timestamptz not null default now(),
  params jsonb not null,
  summary jsonb not null,
  equity jsonb not null,
  trades jsonb not null
);


alter table settings add column if not exists hold_style text not null default 'day';
alter table trades add column if not exists hold_style text not null default 'day';

insert into settings (id) values (1) on conflict do nothing;
insert into bot_state (id) values (1) on conflict do nothing;
insert into accounts (start_balance) select 5000 where not exists (select 1 from accounts);
