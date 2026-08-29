# セットアップ手順(初めての方向け)

このアプリを実際に使えるようにするには、あと2つだけ準備が必要です。
「Supabase(データの保存先)」と「GitHub Pages(アプリの公開場所)」です。
どちらも無料で作れます。

## 1. テーブルを作る(Supabaseは受発注システムと共用)

Supabase無料プランは1アカウントにつきアクティブなプロジェクトを2つまでしか作れず、
既に受発注システム用・タスクカレンダー用の2つで埋まっているため、**新規プロジェクトは
作らず、受発注システムと同じSupabaseプロジェクト(「カタクチ ジュチュウ sys」)を共用**
することにした。テーブル名は`pizza_orders`等と重複しないため、データが混ざる心配はない。

1. https://supabase.com にログインし、「カタクチ ジュチュウ sys」プロジェクトを開く
2. 左メニューの **SQL Editor** を開き、このフォルダの `supabase.sql` の中身を貼り付けて実行(テーブル・アクセス制御・卸出荷先の初期データができます)
3. `storage.js` の `SUPABASE_URL` / `SUPABASE_ANON_KEY` は受発注システムと同じ値を設定済みなので、変更不要

## 2. GitHubで公開する

1. GitHubで新しいリポジトリを作成
2. この `katakuchi-stock` フォルダの中身をそのリポジトリにpush
3. リポジトリの **Settings > Pages** で、公開元を「main ブランチ / ルート」に設定
4. 数分待つと `https://ユーザー名.github.io/リポジトリ名/` でアプリが開けるようになります

## 3. 商品を登録する

公開したURLを開き、「商品マスタ管理」から商品を登録してください。カテゴリ(ピザ/チーズ/新みちのくクリスピー/新みちのくナポリ/爆盛チーズピザ)を選び、スプレッドシートの商品名を1行ずつ貼り付けて「まとめて追加する」を押すと、まとめて登録できます。

卸出荷先は`supabase.sql`実行時に13件の初期データが入っていますが、名称が不確かなものがあるため、「卸出荷先マスタ管理」で内容を確認し、間違っていれば修正してください。

## 4. 使い方

- **製造入力**: 日付を選び、その日に製造した個数を商品ごとに入力します。0のまま保存すると記録は残りません。
- **卸出荷入力**: 日付と卸出荷先を選び、出荷した個数を商品ごとに入力します。同じ日付・卸出荷先を選び直すと、入力済みの内容が読み込まれるので修正もできます。
- **EC出荷入力**: 日付とモール(Yahoo!/Amazon/楽天/Shopify)を選び、出荷した個数を商品ごとに入力します。現状は4モールとも手入力です。
- **在庫一覧**: カテゴリと月を選ぶと、日ごとの製造・EC出荷・卸出荷・在庫(自動計算)が一覧表示されます。在庫は「それまでの製造合計 − それまでの出荷合計」で都度計算しており、保存はしていません。

## 5. 運用上の注意

- ログイン機能はありません。**URLを知っている人は誰でも閲覧・入力できます。** 社内関係者以外にURLを共有しないでください。
- 商品や卸出荷先を「非表示」にしても過去の記録は消えません(在庫計算にも影響しません)。表示上隠れるだけです。
- カテゴリを増やしたい場合は、`app.js` 先頭の `CATEGORIES` 配列を編集してください。
- ECモールを増やしたい場合は、`app.js` 先頭の `MALLS` 配列と、`supabase.sql` の `ec_shipments` テーブルの `check (mall in (...))` 制約の両方を編集してください。

## 6. 既存のSupabaseにテーブル更新を反映する場合

機能追加のたびに、Supabase側で追加のSQL実行が必要になることがあります。
既にテーブルを作成済みの場合は、**SQL Editor** で以下を追加実行してください
(初めて作る場合は `supabase.sql` に全部含まれているので不要です)。

**2026-08-17: 卸出荷先に「在庫一覧で独立列として表示する」設定を追加**

```sql
alter table wholesale_destinations
  add column if not exists show_as_stock_column boolean not null default false;

update wholesale_destinations set show_as_stock_column = true where name = 'FBA';

insert into wholesale_destinations (name, sort_order, show_as_stock_column) values
  ('爆盛り', 14, true),
  ('みち', 15, true),
  ('ワンピース', 16, true),
  ('盛り付け', 17, true),
  ('細谷さん', 18, true);
```

**2026-08-17: 商品ごとに「出荷のまとめ方」「独立列にする卸出荷先」「製造列の有無」を設定できるように**

```sql
alter table products
  add column if not exists shipment_mode text not null default 'split' check (shipment_mode in ('split', 'combined'));
alter table products
  add column if not exists show_production boolean not null default true;

create table if not exists product_stock_columns (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  destination_id uuid not null references wholesale_destinations(id),
  sort_order int not null default 0,
  unique (product_id, destination_id)
);
alter table product_stock_columns enable row level security;
create policy "product_stock_columns anon select" on product_stock_columns for select using (true);
create policy "product_stock_columns anon insert" on product_stock_columns for insert with check (true);
create policy "product_stock_columns anon update" on product_stock_columns for update using (true);
create policy "product_stock_columns anon delete" on product_stock_columns for delete using (true);
```

**2026-08-22: カテゴリ名「ピザ」→「ピザ生地」に変更**

既存の商品データのカテゴリ名も更新しないと、カテゴリ選択で見えなくなってしまいます。

```sql
update products set category = 'ピザ生地' where category = 'ピザ';
```

**2026-08-29: EC出荷入力をモール別からモール横断の合計入力に変更、助ネコCSV取込を追加**

```sql
alter table ec_shipments drop constraint if exists ec_shipments_mall_check;
alter table ec_shipments add constraint ec_shipments_mall_check check (mall in ('yahoo','amazon','rakuten','shopify','all'));

create table if not exists ec_import_product_mappings (
  id uuid primary key default gen_random_uuid(),
  source_text text not null unique,
  product_id uuid references products(id),
  created_at timestamptz not null default now()
);
alter table ec_import_product_mappings enable row level security;
create policy "ec_import_product_mappings anon select" on ec_import_product_mappings for select using (true);
create policy "ec_import_product_mappings anon insert" on ec_import_product_mappings for insert with check (true);
create policy "ec_import_product_mappings anon update" on ec_import_product_mappings for update using (true);
create policy "ec_import_product_mappings anon delete" on ec_import_product_mappings for delete using (true);
```

## 困ったときは

- 保存や読み込みに失敗する: 画面のエラーメッセージを確認し、通信状況を確認して再度お試しください。
  それでも直らない場合は `storage.js` の `SUPABASE_URL` / `SUPABASE_ANON_KEY` が正しいか確認してください。
