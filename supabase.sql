-- Supabase の SQL Editor にこの内容を貼り付けて実行してください。

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  name text not null,
  sort_order int not null default 0,
  active boolean not null default true
);

create table if not exists wholesale_destinations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order int not null default 0,
  active boolean not null default true
);

create table if not exists production_records (
  id uuid primary key default gen_random_uuid(),
  record_date date not null,
  product_id uuid not null references products(id),
  qty numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique (record_date, product_id)
);

create table if not exists wholesale_shipments (
  id uuid primary key default gen_random_uuid(),
  ship_date date not null,
  destination_id uuid not null references wholesale_destinations(id),
  product_id uuid not null references products(id),
  qty numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique (ship_date, destination_id, product_id)
);

create table if not exists ec_shipments (
  id uuid primary key default gen_random_uuid(),
  ship_date date not null,
  mall text not null check (mall in ('yahoo','amazon','rakuten','shopify')),
  product_id uuid not null references products(id),
  qty numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique (ship_date, mall, product_id)
);

alter table products enable row level security;
alter table wholesale_destinations enable row level security;
alter table production_records enable row level security;
alter table wholesale_shipments enable row level security;
alter table ec_shipments enable row level security;

-- このアプリはログイン機能を持たず、URLを知っている社内関係者だけが
-- アクセスできる運用を前提としています。そのため anon キーからの読み書きを
-- そのまま許可しています。URLは社内関係者だけに共有してください。

create policy "products anon select" on products for select using (true);
create policy "products anon insert" on products for insert with check (true);
create policy "products anon update" on products for update using (true);
create policy "products anon delete" on products for delete using (true);

create policy "wholesale_destinations anon select" on wholesale_destinations for select using (true);
create policy "wholesale_destinations anon insert" on wholesale_destinations for insert with check (true);
create policy "wholesale_destinations anon update" on wholesale_destinations for update using (true);
create policy "wholesale_destinations anon delete" on wholesale_destinations for delete using (true);

create policy "production_records anon select" on production_records for select using (true);
create policy "production_records anon insert" on production_records for insert with check (true);
create policy "production_records anon update" on production_records for update using (true);
create policy "production_records anon delete" on production_records for delete using (true);

create policy "wholesale_shipments anon select" on wholesale_shipments for select using (true);
create policy "wholesale_shipments anon insert" on wholesale_shipments for insert with check (true);
create policy "wholesale_shipments anon update" on wholesale_shipments for update using (true);
create policy "wholesale_shipments anon delete" on wholesale_shipments for delete using (true);

create policy "ec_shipments anon select" on ec_shipments for select using (true);
create policy "ec_shipments anon insert" on ec_shipments for insert with check (true);
create policy "ec_shipments anon update" on ec_shipments for update using (true);
create policy "ec_shipments anon delete" on ec_shipments for delete using (true);

-- 卸出荷先の初期データ(名称が不確かなものもあるため、間違っていたら卸先マスタ管理画面で修正してください)
-- 一度だけ実行する想定です(name列にunique制約がないため、再実行すると重複登録されます)。
insert into wholesale_destinations (name, sort_order) values
  ('ashimoka(Five country wine)', 1),
  ('韓国', 2),
  ('松永さん(asteria32)', 3),
  ('日本酒とワインの倉庫', 4),
  ('遠藤(ドラゴ)', 5),
  ('SDMA', 6),
  ('Acecafe', 7),
  ('東海', 8),
  ('In the soup', 9),
  ('愛と美レジャー(3クリスピー)', 10),
  ('伊豆諸島', 11),
  ('FBA', 12),
  ('その他', 13);
