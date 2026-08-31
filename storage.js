// Supabaseの無料プランは1プロジェクトまでのため、受発注システム(order-system)と
// 同じSupabaseプロジェクト(「カタクチ ジュチュウ sys」)を共用している。テーブル名は
// 全て異なるため(products/wholesale_destinations/production_records/wholesale_shipments/
// ec_shipments)、データが混ざる心配はない。anon keyは公開されても問題ない設計で、
// アクセス制御はURLを知っている人だけに限定する運用で行っている。
const SUPABASE_URL = 'https://krdwyfemepbbyrteyoeb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_ouoTLzgoCxmyMf7D_kWdzQ_YTEXc2tk';

let sb = null;
try {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (e) {
  console.error('Supabase client init failed', e);
}

function assertClient() {
  if (!sb) throw new Error('Supabase未設定です。storage.js の SUPABASE_URL / SUPABASE_ANON_KEY を設定してください。');
}

// ---- 商品マスタ ----

async function fetchProducts({ activeOnly = true } = {}) {
  assertClient();
  let q = sb.from('products').select('*').order('category').order('sort_order').order('name');
  if (activeOnly) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function createProduct({ category, name, sortOrder }) {
  assertClient();
  const { error } = await sb.from('products').insert({
    category,
    name,
    sort_order: sortOrder || 0,
  });
  if (error) throw error;
}

async function createProductsBulk(rows) {
  assertClient();
  if (!rows.length) return;
  const { error } = await sb.from('products').insert(rows);
  if (error) throw error;
}

async function updateProduct(id, { category, name, sortOrder, active, shipmentMode, showProduction }) {
  assertClient();
  const { data, error } = await sb
    .from('products')
    .update({
      category,
      name,
      sort_order: sortOrder,
      active,
      shipment_mode: shipmentMode,
      show_production: showProduction,
    })
    .eq('id', id)
    .select();
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('更新できませんでした(権限設定が反映されていない可能性があります)');
}

// ---- 商品ごとの在庫一覧・独立列設定 ----

async function fetchProductStockColumns(productId) {
  assertClient();
  const { data, error } = await sb
    .from('product_stock_columns')
    .select('*')
    .eq('product_id', productId)
    .order('sort_order');
  if (error) throw error;
  return data || [];
}

async function fetchAllProductStockColumns() {
  assertClient();
  const { data, error } = await sb.from('product_stock_columns').select('*');
  if (error) throw error;
  return data || [];
}

// destinationIds全体で置き換える(全削除→再挿入)。
async function setProductStockColumns(productId, destinationIds) {
  assertClient();
  const { error: delError } = await sb.from('product_stock_columns').delete().eq('product_id', productId);
  if (delError) throw delError;
  if (destinationIds.length) {
    const rows = destinationIds.map((destinationId, i) => ({
      product_id: productId,
      destination_id: destinationId,
      sort_order: i,
    }));
    const { error: insError } = await sb.from('product_stock_columns').insert(rows);
    if (insError) throw insError;
  }
}

// ---- 卸出荷先マスタ ----

async function fetchDestinations({ activeOnly = true } = {}) {
  assertClient();
  let q = sb.from('wholesale_destinations').select('*').order('sort_order').order('name');
  if (activeOnly) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function createDestination({ name, sortOrder }) {
  assertClient();
  const { error } = await sb.from('wholesale_destinations').insert({
    name,
    sort_order: sortOrder || 0,
  });
  if (error) throw error;
}

async function updateDestination(id, { name, sortOrder, active, showAsStockColumn }) {
  assertClient();
  const { data, error } = await sb
    .from('wholesale_destinations')
    .update({ name, sort_order: sortOrder, active, show_as_stock_column: showAsStockColumn })
    .eq('id', id)
    .select();
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('更新できませんでした(権限設定が反映されていない可能性があります)');
}

// ---- 製造記録 ----

async function fetchProductionForDate(date) {
  assertClient();
  const { data, error } = await sb.from('production_records').select('*').eq('record_date', date);
  if (error) throw error;
  return data || [];
}

async function fetchProductionRange(from, to) {
  assertClient();
  const { data, error } = await sb.from('production_records').select('*').gte('record_date', from).lte('record_date', to);
  if (error) throw error;
  return data || [];
}

// entries: [{ productId, qty }]。qty>0はupsert、qty<=0で既存行がある場合は削除する。
async function saveProductionBatch(date, entries) {
  assertClient();
  const upserts = entries.filter((e) => e.qty > 0).map((e) => ({
    record_date: date,
    product_id: e.productId,
    qty: e.qty,
    updated_at: new Date().toISOString(),
  }));
  const zeroProductIds = entries.filter((e) => !(e.qty > 0)).map((e) => e.productId);
  if (upserts.length) {
    const { error } = await sb.from('production_records').upsert(upserts, { onConflict: 'record_date,product_id' });
    if (error) throw error;
  }
  if (zeroProductIds.length) {
    const { error } = await sb
      .from('production_records')
      .delete()
      .eq('record_date', date)
      .in('product_id', zeroProductIds);
    if (error) throw error;
  }
}

// ---- 卸出荷記録 ----

async function fetchWholesaleForDateDestination(date, destinationId) {
  assertClient();
  const { data, error } = await sb
    .from('wholesale_shipments')
    .select('*')
    .eq('ship_date', date)
    .eq('destination_id', destinationId);
  if (error) throw error;
  return data || [];
}

async function fetchWholesaleRange(from, to) {
  assertClient();
  const { data, error } = await sb.from('wholesale_shipments').select('*').gte('ship_date', from).lte('ship_date', to);
  if (error) throw error;
  return data || [];
}

async function saveWholesaleBatch(date, destinationId, entries) {
  assertClient();
  const upserts = entries.filter((e) => e.qty > 0).map((e) => ({
    ship_date: date,
    destination_id: destinationId,
    product_id: e.productId,
    qty: e.qty,
    updated_at: new Date().toISOString(),
  }));
  const zeroProductIds = entries.filter((e) => !(e.qty > 0)).map((e) => e.productId);
  if (upserts.length) {
    const { error } = await sb
      .from('wholesale_shipments')
      .upsert(upserts, { onConflict: 'ship_date,destination_id,product_id' });
    if (error) throw error;
  }
  if (zeroProductIds.length) {
    const { error } = await sb
      .from('wholesale_shipments')
      .delete()
      .eq('ship_date', date)
      .eq('destination_id', destinationId)
      .in('product_id', zeroProductIds);
    if (error) throw error;
  }
}

// ---- EC出荷記録 ----

async function fetchEcForDateMall(date, mall) {
  assertClient();
  const { data, error } = await sb.from('ec_shipments').select('*').eq('ship_date', date).eq('mall', mall);
  if (error) throw error;
  return data || [];
}

async function fetchEcRange(from, to) {
  assertClient();
  const { data, error } = await sb.from('ec_shipments').select('*').gte('ship_date', from).lte('ship_date', to);
  if (error) throw error;
  return data || [];
}

async function saveEcBatch(date, mall, entries) {
  assertClient();
  const upserts = entries.filter((e) => e.qty > 0).map((e) => ({
    ship_date: date,
    mall,
    product_id: e.productId,
    qty: e.qty,
    updated_at: new Date().toISOString(),
  }));
  const zeroProductIds = entries.filter((e) => !(e.qty > 0)).map((e) => e.productId);
  if (upserts.length) {
    const { error } = await sb.from('ec_shipments').upsert(upserts, { onConflict: 'ship_date,mall,product_id' });
    if (error) throw error;
  }
  if (zeroProductIds.length) {
    const { error } = await sb.from('ec_shipments').delete().eq('ship_date', date).eq('mall', mall).in('product_id', zeroProductIds);
    if (error) throw error;
  }
}

// ---- 助ネコCSV取込: 商品名 → 自社商品 の対応表 ----

async function fetchAllEcImportMappings() {
  assertClient();
  const { data, error } = await sb.from('ec_import_product_mappings').select('*');
  if (error) throw error;
  return data || [];
}

// sourceTextの対応を保存する。itemsは{productId, qty}の配列。
// 空配列なら「在庫管理外(取り込まない)」の意味でproduct_id=nullの1件を保存する。
// 2件以上渡すと、セット商品などで1つの商品名が複数商品の詰め合わせであることを表し、
// 同じsource_textで複数行保存する。qtyは「注文1件あたりのこの商品の数量」
// (例:「アラビアータピザ3枚セット」ならqty:3)。
// 選び直しに対応するため、保存前に同じsource_textの既存行を全て削除してから入れ直す。
async function saveEcImportMappings(sourceText, items) {
  assertClient();
  const { error: delError } = await sb.from('ec_import_product_mappings').delete().eq('source_text', sourceText);
  if (delError) throw delError;
  const rows = items.length
    ? items.map((it) => ({ source_text: sourceText, product_id: it.productId, qty_per_unit: it.qty || 1 }))
    : [{ source_text: sourceText, product_id: null, qty_per_unit: 1 }];
  const { error } = await sb.from('ec_import_product_mappings').insert(rows);
  if (error) throw error;
}
