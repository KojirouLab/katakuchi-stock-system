-- 受発注システム(order-system)と同じSupabaseプロジェクト(「カタクチ ジュチュウ sys」)の
-- SQL Editor にこの内容を貼り付けて実行してください。テーブル名は既存の
-- pizza_orders / oyster_orders 等と重複しないため、安全に追加できます。

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  name text not null,
  sort_order int not null default 0,
  active boolean not null default true,
  -- 'split': 在庫一覧でEC出荷と卸出荷を分けて表示(通常)。'combined': 分けずに「出荷」1本にまとめる
  shipment_mode text not null default 'split' check (shipment_mode in ('split', 'combined')),
  -- 在庫一覧に製造列を表示するか(通常true。仕入れ品など製造しない商品ではfalseにする)
  show_production boolean not null default true
);

-- 商品ごとに「在庫一覧で独立列として表示する卸出荷先」を個別に選べるようにする
-- (例: 130玉だけFBAを分けたい、8ナポリだけ「爆盛り」「みち」を分けたい、等)
create table if not exists product_stock_columns (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  destination_id uuid not null references wholesale_destinations(id),
  sort_order int not null default 0,
  unique (product_id, destination_id)
);

create table if not exists wholesale_destinations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order int not null default 0,
  active boolean not null default true,
  -- trueの卸出荷先は、商品マスタ管理で「この商品の独立列にする」候補として選べるようになる
  -- (実際にどの商品で独立列にするかはproduct_stock_columnsで商品ごとに決める)
  show_as_stock_column boolean not null default false
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

-- mallは当初モール別(yahoo/amazon/rakuten/shopify)に分けていたが、モール横断で合計数量だけ
-- 管理する運用に変更したため、常に'all'を使う(列・制約は将来モール別集計が必要になった時のため残す)。
create table if not exists ec_shipments (
  id uuid primary key default gen_random_uuid(),
  ship_date date not null,
  mall text not null check (mall in ('yahoo','amazon','rakuten','shopify','all')),
  product_id uuid not null references products(id),
  qty numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique (ship_date, mall, product_id)
);

-- 助ネコ(受注管理システム)のCSV取込で、商品名(または福袋の中の1フレーバー名)を
-- 一度手動でどの商品に対応するか選ぶと、次回以降は自動でマッチングされる。
create table if not exists ec_import_product_mappings (
  id uuid primary key default gen_random_uuid(),
  source_text text not null unique,
  product_id uuid references products(id), -- nullは「この商品名は無視する(取り込まない)」の意味
  created_at timestamptz not null default now()
);

alter table products enable row level security;
alter table product_stock_columns enable row level security;
alter table wholesale_destinations enable row level security;
alter table production_records enable row level security;
alter table wholesale_shipments enable row level security;
alter table ec_shipments enable row level security;
alter table ec_import_product_mappings enable row level security;

-- このアプリはログイン機能を持たず、URLを知っている社内関係者だけが
-- アクセスできる運用を前提としています。そのため anon キーからの読み書きを
-- そのまま許可しています。URLは社内関係者だけに共有してください。

create policy "products anon select" on products for select using (true);
create policy "products anon insert" on products for insert with check (true);
create policy "products anon update" on products for update using (true);
create policy "products anon delete" on products for delete using (true);

create policy "product_stock_columns anon select" on product_stock_columns for select using (true);
create policy "product_stock_columns anon insert" on product_stock_columns for insert with check (true);
create policy "product_stock_columns anon update" on product_stock_columns for update using (true);
create policy "product_stock_columns anon delete" on product_stock_columns for delete using (true);

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

create policy "ec_import_product_mappings anon select" on ec_import_product_mappings for select using (true);
create policy "ec_import_product_mappings anon insert" on ec_import_product_mappings for insert with check (true);
create policy "ec_import_product_mappings anon update" on ec_import_product_mappings for update using (true);
create policy "ec_import_product_mappings anon delete" on ec_import_product_mappings for delete using (true);

-- 卸出荷先の初期データ(名称が不確かなものもあるため、間違っていたら卸先マスタ管理画面で修正してください)
-- 一度だけ実行する想定です(name列にunique制約がないため、再実行すると重複登録されます)。
insert into wholesale_destinations (name, sort_order, show_as_stock_column) values
  ('ashimoka(Five country wine)', 1, false),
  ('韓国', 2, false),
  ('松永さん(asteria32)', 3, false),
  ('日本酒とワインの倉庫', 4, false),
  ('遠藤(ドラゴ)', 5, false),
  ('SDMA', 6, false),
  ('Acecafe', 7, false),
  ('東海', 8, false),
  ('In the soup', 9, false),
  ('愛と美レジャー(3クリスピー)', 10, false),
  ('伊豆諸島', 11, false),
  ('FBA', 12, true),
  ('その他', 13, false),
  ('爆盛り', 14, true),
  ('みち', 15, true),
  ('ワンピース', 16, true),
  ('盛り付け', 17, true),
  ('細谷さん', 18, true);
