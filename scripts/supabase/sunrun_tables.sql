-- 阳光跑次数表（与补跑、自由跑分开）
create table if not exists public.sunrun_credits (
  user_id text primary key,
  credits integer not null default 0,
  updated_at timestamptz default now()
);

-- 阳光跑兑换码表（与补跑、自由跑分开）
create table if not exists public.sunrun_redeem_codes (
  code text primary key,
  amount integer not null default 1,
  is_used boolean not null default false,
  used_by text,
  used_at timestamptz,
  created_at timestamptz default now()
);

-- 常用查询辅助索引
create index if not exists idx_sunrun_redeem_codes_unused on public.sunrun_redeem_codes (is_used);
