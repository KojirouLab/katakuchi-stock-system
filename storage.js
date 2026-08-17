// ここに Supabase の Project URL と anon key を貼り付けてください。
// (Supabase ダッシュボード > Project Settings > API で確認できます。anon key は
// 公開されても問題ない設計です。アクセス制御はURLを知っている人だけに限定する運用で行っています。)
const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';

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

async function updateProduct(id, { category, name, sortOrder, active }) {
  assertClient();
  const { data, error } = await sb
    .from('products')
    .update({ category, name, sort_order: sortOrder, active })
    .eq('id', id)
    .select();
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('更新できませんでした(権限設定が反映されていない可能性があります)');
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

async function updateDestination(id, { name, sortOrder, active }) {
  assertClient();
  const { data, error } = await sb
    .from('wholesale_destinations')
    .update({ name, sort_order: sortOrder, active })
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
