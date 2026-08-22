// 商品カテゴリ(固定リスト)。カテゴリを増やしたい場合はここに追記する。
const CATEGORIES = ['ピザ生地', 'チーズ', '新みちのくクリスピー', '新みちのくナポリ', '爆盛チーズピザ'];

// ECモール(固定リスト)。現状は全モール手入力。将来Shopify等をAPI連携する場合は
// このmallスラッグ(ec_shipments.mall)をそのまま使えるようにしてある。
const MALLS = [
  { slug: 'yahoo', name: 'Yahoo!ショッピング' },
  { slug: 'amazon', name: 'Amazon' },
  { slug: 'rakuten', name: '楽天市場' },
  { slug: 'shopify', name: 'Shopify(自社EC)' },
];

// 在庫の累計計算をこの日以降のデータで行う(それより前のデータは無い前提の安全な下限)。
const FAR_PAST_DATE = '2020-01-01';

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function todayStr() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

function formatDateJp(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}(${w})`;
}

function currentMonthStr() {
  return todayStr().slice(0, 7);
}

function daysInMonth(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function nextDateStr(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

const app = document.getElementById('app');

function backLinkHtml() {
  return '<p class="admin-back-link"><a href="./">← ホームへ戻る</a></p>';
}

function categoryOptionsHtml() {
  return CATEGORIES.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
}

function route() {
  const params = new URLSearchParams(location.search);
  const view = params.get('view');
  if (view === 'production') return renderProductionPage();
  if (view === 'wholesale') return renderWholesalePage();
  if (view === 'ec') return renderEcPage();
  if (view === 'stock') return renderStockPage();
  if (view === 'products') return renderProductsAdminPage();
  if (view === 'destinations') return renderDestinationsAdminPage();
  renderHome();
}

function renderHome() {
  app.innerHTML = `
    <div class="page">
      <h1>カタクチ商店 在庫管理システム</h1>
      <p class="hint">このページのリンクは社内関係者だけに共有してください。URLを知っている人だけがアクセスできる運用です。</p>
      <div class="card">
        <h2>日々の入力</h2>
        <ul class="home-links">
          <li><a href="?view=production">製造入力</a></li>
          <li><a href="?view=wholesale">卸出荷入力</a></li>
          <li><a href="?view=ec">EC出荷入力(Yahoo!・Amazon・楽天・Shopify)</a></li>
        </ul>
      </div>
      <div class="card">
        <h2>在庫</h2>
        <ul class="home-links">
          <li><a href="?view=stock">在庫一覧</a></li>
        </ul>
      </div>
      <div class="card">
        <h2>マスタ管理</h2>
        <ul class="home-links">
          <li><a href="?view=products">商品マスタ管理</a></li>
          <li><a href="?view=destinations">卸出荷先マスタ管理</a></li>
        </ul>
      </div>
    </div>`;
}

function renderError(msg) {
  app.innerHTML = `<div class="page">${backLinkHtml()}<div class="card"><p class="msg-error">${escapeHtml(msg)}</p></div></div>`;
}

// ---- 数量入力フォーム(選択中カテゴリの商品ごとにqty入力欄を並べる)共通部品 ----

function renderQtyForm(products, byProductQty) {
  if (!products.length) {
    return '<div class="card"><p class="hint">このカテゴリには商品が登録されていません。<a href="?view=products">商品マスタ管理</a>から登録してください。</p></div>';
  }
  return `
    <div class="card">
      ${products
        .map(
          (p) => `
        <div class="qty-row">
          <span class="qty-name">${escapeHtml(p.name)}</span>
          <input type="text" inputmode="numeric" pattern="[0-9]*" class="qty-input" data-product-id="${p.id}" value="${
            byProductQty[p.id] || 0
          }" onfocus="this.select()">
        </div>`
        )
        .join('')}
    </div>`;
}

function collectQtyEntries(container, products) {
  return products.map((p) => {
    const el = container.querySelector(`.qty-input[data-product-id="${p.id}"]`);
    const qty = el ? Number(el.value) || 0 : 0;
    return { productId: p.id, qty };
  });
}

// 保存が終わった入力欄を0に戻す(次の日の入力にそのまま使えるように)。
function clearQtyInputs(container) {
  container.querySelectorAll('.qty-input').forEach((el) => {
    el.value = 0;
  });
}

// 数量入力欄でEnterを押すと次の商品の入力欄に移動する(最後の欄では保存ボタンにフォーカス)。
function enableQtyEnterNav(container, saveBtn) {
  const inputs = Array.from(container.querySelectorAll('.qty-input'));
  inputs.forEach((el, i) => {
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const next = inputs[i + 1];
      if (next) {
        // 次の欄に既存の数字が入っていても、Enterで移動したら必ず0にリセットしてから
        // フォーカスする(既存値の選択に頼らず、常にまっさらな状態で次を打てるようにする)。
        next.value = '0';
        next.focus();
      } else if (saveBtn) {
        saveBtn.focus();
      }
    });
  });
}

// ---- 製造入力 ----

async function renderProductionPage() {
  const date = todayStr();
  app.innerHTML = `
    <div class="page">
      ${backLinkHtml()}
      <h1>製造入力</h1>
      <p class="hint">その日に製造した個数を商品ごとに入力してください。0のまま保存すると記録は残りません。</p>
      <div class="card">
        <div class="field-row">
          <div class="field">
            <label for="prod-date">日付</label>
            <input type="date" id="prod-date" value="${date}">
          </div>
          <div class="field">
            <label for="prod-category">カテゴリ</label>
            <select id="prod-category">${categoryOptionsHtml()}</select>
          </div>
        </div>
      </div>
      <div id="prod-body"><p class="hint">読み込み中...</p></div>
      <button class="primary" id="prod-save" style="display:none">保存する</button>
      <div class="msg" id="prod-msg"></div>
    </div>`;
  const dateInput = document.getElementById('prod-date');
  const categorySelect = document.getElementById('prod-category');
  const reload = () => loadProductionBody(dateInput.value, categorySelect.value);
  dateInput.addEventListener('change', reload);
  categorySelect.addEventListener('change', reload);
  await reload();
}

async function loadProductionBody(date, category) {
  const body = document.getElementById('prod-body');
  const saveBtn = document.getElementById('prod-save');
  const msg = document.getElementById('prod-msg');
  msg.textContent = '';
  msg.className = 'msg';
  saveBtn.style.display = 'none';
  body.innerHTML = '<p class="hint">読み込み中...</p>';
  try {
    const [allProducts, records] = await Promise.all([fetchProducts(), fetchProductionForDate(date)]);
    const products = allProducts.filter((p) => p.category === category);
    const byProductQty = {};
    records.forEach((r) => {
      byProductQty[r.product_id] = r.qty;
    });
    body.innerHTML = renderQtyForm(products, byProductQty);
    if (products.length) {
      enableQtyEnterNav(body, saveBtn);
      saveBtn.style.display = '';
      saveBtn.onclick = async () => {
        saveBtn.disabled = true;
        try {
          const entries = collectQtyEntries(body, products);
          await saveProductionBatch(date, entries);
          clearQtyInputs(body);
          msg.textContent = '保存しました';
          msg.className = 'msg msg-success';
        } catch (e) {
          msg.textContent = '保存に失敗しました: ' + e.message;
          msg.className = 'msg msg-error';
        } finally {
          saveBtn.disabled = false;
        }
      };
    }
  } catch (e) {
    body.innerHTML = `<p class="msg-error">読み込みに失敗しました: ${escapeHtml(e.message)}</p>`;
  }
}

// ---- 卸出荷入力 ----

async function renderWholesalePage() {
  const date = todayStr();
  app.innerHTML = `
    <div class="page">
      ${backLinkHtml()}
      <h1>卸出荷入力</h1>
      <p class="hint">日付と卸出荷先を選び、出荷した個数を商品ごとに入力してください。同じ日付・卸出荷先を選び直すと、これまでの入力内容が読み込まれます。</p>
      <div class="card">
        <div class="field-row">
          <div class="field">
            <label for="ws-date">日付</label>
            <input type="date" id="ws-date" value="${date}">
          </div>
          <div class="field">
            <label for="ws-dest">卸出荷先</label>
            <select id="ws-dest"><option value="">読み込み中...</option></select>
          </div>
          <div class="field">
            <label for="ws-category">カテゴリ</label>
            <select id="ws-category">${categoryOptionsHtml()}</select>
          </div>
        </div>
      </div>
      <div id="ws-body"></div>
      <button class="primary" id="ws-save" style="display:none">保存する</button>
      <div class="msg" id="ws-msg"></div>
    </div>`;
  const dateInput = document.getElementById('ws-date');
  const destSelect = document.getElementById('ws-dest');
  const categorySelect = document.getElementById('ws-category');
  try {
    const destinations = await fetchDestinations();
    destSelect.innerHTML = destinations.map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
  } catch (e) {
    destSelect.innerHTML = '<option value="">読み込み失敗</option>';
    document.getElementById('ws-body').innerHTML = `<p class="msg-error">卸出荷先の読み込みに失敗しました: ${escapeHtml(
      e.message
    )}</p>`;
    return;
  }
  const reload = () => loadWholesaleBody(dateInput.value, destSelect.value, categorySelect.value);
  dateInput.addEventListener('change', reload);
  destSelect.addEventListener('change', reload);
  categorySelect.addEventListener('change', reload);
  await reload();
}

async function loadWholesaleBody(date, destinationId, category) {
  const body = document.getElementById('ws-body');
  const saveBtn = document.getElementById('ws-save');
  const msg = document.getElementById('ws-msg');
  msg.textContent = '';
  msg.className = 'msg';
  saveBtn.style.display = 'none';
  if (!destinationId) {
    body.innerHTML = '<p class="hint">卸出荷先を選択してください。</p>';
    return;
  }
  body.innerHTML = '<p class="hint">読み込み中...</p>';
  try {
    const [allProducts, records] = await Promise.all([fetchProducts(), fetchWholesaleForDateDestination(date, destinationId)]);
    const products = allProducts.filter((p) => p.category === category);
    const byProductQty = {};
    records.forEach((r) => {
      byProductQty[r.product_id] = r.qty;
    });
    body.innerHTML = renderQtyForm(products, byProductQty);
    if (products.length) {
      enableQtyEnterNav(body, saveBtn);
      saveBtn.style.display = '';
      saveBtn.onclick = async () => {
        saveBtn.disabled = true;
        try {
          const entries = collectQtyEntries(body, products);
          await saveWholesaleBatch(date, destinationId, entries);
          clearQtyInputs(body);
          msg.textContent = '保存しました';
          msg.className = 'msg msg-success';
        } catch (e) {
          msg.textContent = '保存に失敗しました: ' + e.message;
          msg.className = 'msg msg-error';
        } finally {
          saveBtn.disabled = false;
        }
      };
    }
  } catch (e) {
    body.innerHTML = `<p class="msg-error">読み込みに失敗しました: ${escapeHtml(e.message)}</p>`;
  }
}

// ---- EC出荷入力 ----

async function renderEcPage() {
  const date = todayStr();
  const mallOptions = MALLS.map((m) => `<option value="${m.slug}">${escapeHtml(m.name)}</option>`).join('');
  app.innerHTML = `
    <div class="page">
      ${backLinkHtml()}
      <h1>EC出荷入力</h1>
      <p class="hint">日付とモールを選び、出荷した個数を商品ごとに入力してください。同じ日付・モールを選び直すと、これまでの入力内容が読み込まれます。</p>
      <div class="card">
        <div class="field-row">
          <div class="field">
            <label for="ec-date">日付</label>
            <input type="date" id="ec-date" value="${date}">
          </div>
          <div class="field">
            <label for="ec-mall">モール</label>
            <select id="ec-mall">${mallOptions}</select>
          </div>
          <div class="field">
            <label for="ec-category">カテゴリ</label>
            <select id="ec-category">${categoryOptionsHtml()}</select>
          </div>
        </div>
      </div>
      <div id="ec-body"></div>
      <button class="primary" id="ec-save" style="display:none">保存する</button>
      <div class="msg" id="ec-msg"></div>
    </div>`;
  const dateInput = document.getElementById('ec-date');
  const mallSelect = document.getElementById('ec-mall');
  const categorySelect = document.getElementById('ec-category');
  const reload = () => loadEcBody(dateInput.value, mallSelect.value, categorySelect.value);
  dateInput.addEventListener('change', reload);
  mallSelect.addEventListener('change', reload);
  categorySelect.addEventListener('change', reload);
  await reload();
}

async function loadEcBody(date, mall, category) {
  const body = document.getElementById('ec-body');
  const saveBtn = document.getElementById('ec-save');
  const msg = document.getElementById('ec-msg');
  msg.textContent = '';
  msg.className = 'msg';
  saveBtn.style.display = 'none';
  body.innerHTML = '<p class="hint">読み込み中...</p>';
  try {
    const [allProducts, records] = await Promise.all([fetchProducts(), fetchEcForDateMall(date, mall)]);
    const products = allProducts.filter((p) => p.category === category);
    const byProductQty = {};
    records.forEach((r) => {
      byProductQty[r.product_id] = r.qty;
    });
    body.innerHTML = renderQtyForm(products, byProductQty);
    if (products.length) {
      enableQtyEnterNav(body, saveBtn);
      saveBtn.style.display = '';
      saveBtn.onclick = async () => {
        saveBtn.disabled = true;
        try {
          const entries = collectQtyEntries(body, products);
          await saveEcBatch(date, mall, entries);
          clearQtyInputs(body);
          msg.textContent = '保存しました';
          msg.className = 'msg msg-success';
        } catch (e) {
          msg.textContent = '保存に失敗しました: ' + e.message;
          msg.className = 'msg msg-error';
        } finally {
          saveBtn.disabled = false;
        }
      };
    }
  } catch (e) {
    body.innerHTML = `<p class="msg-error">読み込みに失敗しました: ${escapeHtml(e.message)}</p>`;
  }
}

// ---- 在庫一覧 ----

function sumByDateProduct(rows, dateField) {
  const m = {};
  rows.forEach((r) => {
    const key = `${r[dateField]}|${r.product_id}`;
    m[key] = (m[key] || 0) + Number(r.qty);
  });
  return m;
}

function sumBefore(rows, dateField, beforeDate) {
  const m = {};
  rows.forEach((r) => {
    if (r[dateField] < beforeDate) {
      m[r.product_id] = (m[r.product_id] || 0) + Number(r.qty);
    }
  });
  return m;
}

async function renderStockPage() {
  const categoryOptions = CATEGORIES.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  app.innerHTML = `
    <div class="page wide">
      ${backLinkHtml()}
      <h1>在庫一覧</h1>
      <p class="hint">製造・EC出荷・卸出荷の記録から、日ごとの在庫を自動計算して表示します。表の数字をクリックすると、その日・その商品の明細(EC出荷のモール別内訳、卸出荷の卸先別内訳)が見られます。</p>
      <div class="card">
        <div class="field-row">
          <div class="field">
            <label for="stock-category">カテゴリ</label>
            <select id="stock-category">${categoryOptions}</select>
          </div>
          <div class="field">
            <label for="stock-month">月</label>
            <input type="month" id="stock-month" value="${currentMonthStr()}">
          </div>
        </div>
      </div>
      <div id="stock-detail" class="card" style="display:none"></div>
      <div id="stock-body"><p class="hint">読み込み中...</p></div>
    </div>`;
  const categorySelect = document.getElementById('stock-category');
  const monthInput = document.getElementById('stock-month');
  const reload = () => loadStockBody(categorySelect.value, monthInput.value);
  categorySelect.addEventListener('change', reload);
  monthInput.addEventListener('change', reload);
  await reload();
}

// 商品ごとの在庫一覧の列構成を決める。
// - shipment_mode='combined'なら「出荷」1本、それ以外はEC出荷/卸出荷を分ける
// - 商品ごとに設定した独立列(destsForP)を間に挟む
// - 在庫は常に表示、製造はshow_production!==falseの時だけ末尾に表示
function buildColumnsSpec(product, destsForP) {
  const cols = [];
  if (product.shipment_mode === 'combined') {
    cols.push({ type: 'shipped', label: '出荷' });
  } else {
    cols.push({ type: 'ec', label: 'EC出荷' });
  }
  destsForP.forEach((d) => cols.push({ type: 'dest', label: d.name, destId: d.id }));
  if (product.shipment_mode !== 'combined') {
    cols.push({ type: 'wholesale_other', label: '卸出荷' });
  }
  cols.push({ type: 'stock', label: '在庫' });
  if (product.show_production !== false) {
    cols.push({ type: 'production', label: '製造' });
  }
  return cols;
}

function cellValueForColumn(col, cell) {
  switch (col.type) {
    case 'ec':
      return cell.ec;
    case 'shipped':
      return cell.ec + cell.wholesaleOther;
    case 'dest':
      return cell.destValues[col.destId] || 0;
    case 'wholesale_other':
      return cell.wholesaleOther;
    case 'stock':
      return cell.stock;
    case 'production':
      return cell.production;
    default:
      return 0;
  }
}

async function loadStockBody(category, monthStr) {
  const body = document.getElementById('stock-body');
  body.innerHTML = '<p class="hint">読み込み中...</p>';
  try {
    const [allProducts, allDestinations, allProductStockColumns] = await Promise.all([
      fetchProducts(),
      fetchDestinations({ activeOnly: false }),
      fetchAllProductStockColumns(),
    ]);
    const products = allProducts.filter((p) => p.category === category);
    if (!products.length) {
      body.innerHTML = '<div class="card"><p class="hint">このカテゴリには商品が登録されていません。</p></div>';
      return;
    }
    const destById = {};
    allDestinations.forEach((d) => {
      destById[d.id] = d;
    });
    // 商品ごとに「独立列にする卸出荷先」のリストを作る(product_stock_columnsのsort_order順)
    const destsByProduct = {};
    allProductStockColumns
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .forEach((row) => {
        const dest = destById[row.destination_id];
        if (!dest) return;
        (destsByProduct[row.product_id] = destsByProduct[row.product_id] || []).push(dest);
      });
    const columnsSpecByProduct = {};
    products.forEach((p) => {
      columnsSpecByProduct[p.id] = buildColumnsSpec(p, destsByProduct[p.id] || []);
    });

    const monthStart = `${monthStr}-01`;
    const monthEnd = `${monthStr}-${String(daysInMonth(monthStr)).padStart(2, '0')}`;
    const productIds = new Set(products.map((p) => p.id));
    const [productionRowsAll, wholesaleRowsAll, ecRowsAll] = await Promise.all([
      fetchProductionRange(FAR_PAST_DATE, monthEnd),
      fetchWholesaleRange(FAR_PAST_DATE, monthEnd),
      fetchEcRange(FAR_PAST_DATE, monthEnd),
    ]);
    const productionRows = productionRowsAll.filter((r) => productIds.has(r.product_id));
    const wholesaleRows = wholesaleRowsAll.filter((r) => productIds.has(r.product_id));
    const ecRows = ecRowsAll.filter((r) => productIds.has(r.product_id));

    const openingProd = sumBefore(productionRows, 'record_date', monthStart);
    const openingWs = sumBefore(wholesaleRows, 'ship_date', monthStart);
    const openingEc = sumBefore(ecRows, 'ship_date', monthStart);
    const balance = {};
    products.forEach((p) => {
      balance[p.id] = (openingProd[p.id] || 0) - (openingWs[p.id] || 0) - (openingEc[p.id] || 0);
    });

    const dailyProd = sumByDateProduct(productionRows, 'record_date');
    const dailyWs = sumByDateProduct(wholesaleRows, 'ship_date'); // 卸出荷の合計(全卸出荷先)
    const dailyEc = sumByDateProduct(ecRows, 'ship_date');
    // 卸出荷先ごとの日別内訳(destination_idもキーに含める)
    const dailyWsByDest = {};
    wholesaleRows.forEach((r) => {
      const k = `${r.ship_date}|${r.product_id}|${r.destination_id}`;
      dailyWsByDest[k] = (dailyWsByDest[k] || 0) + Number(r.qty);
    });

    const rows = [];
    let d = monthStart;
    while (d <= monthEnd) {
      const cells = products.map((p) => {
        const key = `${d}|${p.id}`;
        const dp = dailyProd[key] || 0;
        const dwTotal = dailyWs[key] || 0;
        const de = dailyEc[key] || 0;
        const destsForP = destsByProduct[p.id] || [];
        const destValues = {};
        let flaggedSum = 0;
        destsForP.forEach((dest) => {
          const v = dailyWsByDest[`${d}|${p.id}|${dest.id}`] || 0;
          destValues[dest.id] = v;
          flaggedSum += v;
        });
        const wholesaleOther = dwTotal - flaggedSum;
        balance[p.id] = (balance[p.id] || 0) + dp - dwTotal - de;
        return { production: dp, ec: de, destValues, wholesaleOther, stock: balance[p.id] };
      });
      rows.push({ date: d, cells });
      d = nextDateStr(d);
    }

    const headerRow1 =
      '<tr><th rowspan="2">日付</th>' +
      products.map((p) => `<th colspan="${columnsSpecByProduct[p.id].length}">${escapeHtml(p.name)}</th>`).join('') +
      '</tr>';
    const headerRow2 =
      '<tr>' +
      products.map((p) => columnsSpecByProduct[p.id].map((col) => `<th>${escapeHtml(col.label)}</th>`).join('')).join('') +
      '</tr>';
    const bodyRows = rows
      .map((r) => {
        const cellsHtml = r.cells
          .map((c, pi) => {
            const p = products[pi];
            const cols = columnsSpecByProduct[p.id];
            return cols
              .map((col) => {
                const val = cellValueForColumn(col, c);
                const displayVal = col.type === 'stock' ? val : val || '';
                const emptyCls = col.type !== 'stock' && !val ? ' cell-empty' : '';
                return `<td class="stock-cell${emptyCls}" data-date="${r.date}" data-product-id="${p.id}">${displayVal}</td>`;
              })
              .join('');
          })
          .join('');
        const todayCls = r.date === todayStr() ? ' class="cal-list-today"' : '';
        return `<tr${todayCls}><td class="row-label">${formatDateJp(r.date)}</td>${cellsHtml}</tr>`;
      })
      .join('');

    body.innerHTML = `
      <div class="table-scroll">
        <table class="agg-table">
          <thead>${headerRow1}${headerRow2}</thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>`;

    const table = body.querySelector('.agg-table');
    table.addEventListener('click', (e) => {
      const td = e.target.closest('td.stock-cell');
      if (!td) return;
      showStockDetail(td.dataset.date, td.dataset.productId, { products, rows, wholesaleRows, ecRows, allDestinations });
    });
  } catch (e) {
    body.innerHTML = `<p class="msg-error">読み込みに失敗しました: ${escapeHtml(e.message)}</p>`;
  }
}

function showStockDetail(date, productId, { products, rows, wholesaleRows, ecRows, allDestinations }) {
  const detailEl = document.getElementById('stock-detail');
  const product = products.find((p) => p.id === productId);
  const productIdx = products.findIndex((p) => p.id === productId);
  const row = rows.find((r) => r.date === date);
  if (!detailEl || !product || !row) return;
  const cell = row.cells[productIdx];

  const ecByMall = {};
  ecRows.forEach((r) => {
    if (r.ship_date === date && r.product_id === productId) {
      ecByMall[r.mall] = (ecByMall[r.mall] || 0) + Number(r.qty);
    }
  });
  const ecRowsHtml = MALLS.map(
    (m) => `<div class="qty-row"><span class="qty-name">${escapeHtml(m.name)}</span><span>${ecByMall[m.slug] || 0}</span></div>`
  ).join('');

  const wsByDest = {};
  wholesaleRows.forEach((r) => {
    if (r.ship_date === date && r.product_id === productId) {
      wsByDest[r.destination_id] = (wsByDest[r.destination_id] || 0) + Number(r.qty);
    }
  });
  const wsDestIds = Object.keys(wsByDest).filter((id) => wsByDest[id] > 0);
  const wsRowsHtml = wsDestIds.length
    ? wsDestIds
        .map((id) => {
          const dest = allDestinations.find((d) => d.id === id);
          return `<div class="qty-row"><span class="qty-name">${escapeHtml(dest ? dest.name : '(不明な卸出荷先)')}</span><span>${
            wsByDest[id]
          }</span></div>`;
        })
        .join('')
    : '<p class="hint">この日の卸出荷記録はありません。</p>';

  detailEl.innerHTML = `
    <div class="field-row" style="align-items:center; justify-content:space-between; flex-wrap:nowrap;">
      <h2 style="margin:0">${formatDateJp(date)} ${escapeHtml(product.name)} の明細</h2>
      <button class="btn-plain" id="stock-detail-close">閉じる</button>
    </div>
    <p class="hint">製造: ${cell.production} / 在庫(この日時点): ${cell.stock}</p>
    <h2 class="section-title">EC出荷内訳</h2>
    ${ecRowsHtml}
    <h2 class="section-title">卸出荷内訳</h2>
    ${wsRowsHtml}`;
  detailEl.style.display = '';
  detailEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.getElementById('stock-detail-close').addEventListener('click', () => {
    detailEl.style.display = 'none';
  });
}

// ---- 商品マスタ管理 ----

async function renderProductsAdminPage() {
  app.innerHTML = `
    <div class="page">
      ${backLinkHtml()}
      <h1>商品マスタ管理</h1>
      <div class="card">
        <h2>商品をまとめて追加</h2>
        <p class="hint">スプレッドシートの商品名を1行ずつ貼り付けてください。</p>
        <div class="field">
          <label for="bulk-category">カテゴリ</label>
          <select id="bulk-category">${CATEGORIES.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join(
            ''
          )}</select>
        </div>
        <div class="field">
          <label for="bulk-names">商品名(1行に1つ)</label>
          <textarea id="bulk-names" rows="6" placeholder="例) 6ナポリ&#10;8ナポリ&#10;10ナポリ"></textarea>
        </div>
        <button class="primary" id="bulk-add-btn">まとめて追加する</button>
        <div class="msg" id="bulk-msg"></div>
      </div>
      <div id="products-list"><p class="hint">読み込み中...</p></div>
    </div>`;

  document.getElementById('bulk-add-btn').addEventListener('click', async () => {
    const category = document.getElementById('bulk-category').value;
    const names = document
      .getElementById('bulk-names')
      .value.split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const msg = document.getElementById('bulk-msg');
    if (!names.length) {
      msg.textContent = '商品名を入力してください';
      msg.className = 'msg msg-error';
      return;
    }
    try {
      const existing = await fetchProducts({ activeOnly: false });
      let sortOrder = existing.filter((p) => p.category === category).length;
      const rows = names.map((name) => ({ category, name, sort_order: sortOrder++ }));
      await createProductsBulk(rows);
      document.getElementById('bulk-names').value = '';
      msg.textContent = `${names.length}件追加しました`;
      msg.className = 'msg msg-success';
      await loadProductsList();
    } catch (e) {
      msg.textContent = '追加に失敗しました: ' + e.message;
      msg.className = 'msg msg-error';
    }
  });

  await loadProductsList();
}

async function loadProductsList() {
  const listEl = document.getElementById('products-list');
  listEl.innerHTML = '<p class="hint">読み込み中...</p>';
  try {
    const [products, allDestinations] = await Promise.all([
      fetchProducts({ activeOnly: false }),
      fetchDestinations({ activeOnly: false }),
    ]);
    const candidateDests = allDestinations.filter((d) => d.show_as_stock_column);
    const byCategory = {};
    products.forEach((p) => {
      (byCategory[p.category] = byCategory[p.category] || []).push(p);
    });
    listEl.innerHTML = Object.keys(byCategory)
      .map(
        (cat) => `
      <h2 class="section-title">${escapeHtml(cat)}</h2>
      <div class="card">
        ${byCategory[cat]
          .map(
            (p) => `
          <div class="qty-row master-row" data-id="${p.id}">
            <span class="qty-name${p.active ? '' : ' inactive'}">${escapeHtml(p.name)}${p.active ? '' : '(非表示)'}</span>
            <button class="btn-plain master-edit-btn" data-id="${p.id}">編集</button>
          </div>
          <div class="master-edit-form" id="edit-product-${p.id}" style="display:none"></div>`
          )
          .join('')}
      </div>`
      )
      .join('');
    listEl.querySelectorAll('.master-edit-btn').forEach((btn) => {
      btn.addEventListener('click', () => toggleProductEditForm(btn.dataset.id, products, candidateDests));
    });
  } catch (e) {
    listEl.innerHTML = `<p class="msg-error">読み込みに失敗しました: ${escapeHtml(e.message)}</p>`;
  }
}

async function toggleProductEditForm(id, products, candidateDests) {
  const el = document.getElementById(`edit-product-${id}`);
  if (el.style.display !== 'none') {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  const p = products.find((x) => x.id === id);
  el.style.display = '';
  el.innerHTML = '<div class="card"><p class="hint">読み込み中...</p></div>';
  const currentCols = await fetchProductStockColumns(id);
  const currentDestIds = new Set(currentCols.map((c) => c.destination_id));
  const destCheckboxesHtml = candidateDests.length
    ? candidateDests
        .map(
          (d) => `
        <label class="checkbox-label">
          <input type="checkbox" class="edit-stockcol-${id}" value="${d.id}" ${currentDestIds.has(d.id) ? 'checked' : ''}>
          ${escapeHtml(d.name)}
        </label>`
        )
        .join('')
    : '<p class="hint">独立列にできる卸出荷先がありません。卸出荷先マスタ管理で「在庫一覧で独立列として表示する」をオンにした卸出荷先が、ここに候補として出ます。</p>';
  el.innerHTML = `
    <div class="card">
      <div class="field">
        <label>商品名</label>
        <input type="text" id="edit-name-${id}" value="${escapeHtml(p.name)}">
      </div>
      <div class="field">
        <label>カテゴリ</label>
        <select id="edit-category-${id}">${CATEGORIES.map(
    (c) => `<option value="${escapeHtml(c)}" ${c === p.category ? 'selected' : ''}>${escapeHtml(c)}</option>`
  ).join('')}</select>
      </div>
      <div class="field">
        <label>並び順(小さいほど先に表示)</label>
        <input type="number" id="edit-sort-${id}" value="${p.sort_order}">
      </div>
      <label class="checkbox-label">
        <input type="checkbox" id="edit-active-${id}" ${p.active ? 'checked' : ''}>
        表示する(オフにすると入力画面・在庫一覧から隠れます)
      </label>
      <label class="checkbox-label">
        <input type="checkbox" id="edit-showprod-${id}" ${p.show_production !== false ? 'checked' : ''}>
        在庫一覧に製造列を表示する(仕入れ品など製造しない商品はオフ)
      </label>
      <div class="field">
        <label>在庫一覧での出荷の表示</label>
        <select id="edit-shipmode-${id}">
          <option value="split" ${p.shipment_mode !== 'combined' ? 'selected' : ''}>EC出荷と卸出荷を分けて表示(通常)</option>
          <option value="combined" ${p.shipment_mode === 'combined' ? 'selected' : ''}>分けずに「出荷」1本にまとめる</option>
        </select>
      </div>
      <div class="field">
        <label>在庫一覧でこの商品だけ独立列にする卸出荷先</label>
        ${destCheckboxesHtml}
      </div>
      <button class="primary" id="edit-save-${id}">保存する</button>
      <div class="msg" id="edit-msg-${id}"></div>
    </div>`;
  document.getElementById(`edit-save-${id}`).addEventListener('click', async () => {
    const msg = document.getElementById(`edit-msg-${id}`);
    try {
      const selectedDestIds = [...el.querySelectorAll(`.edit-stockcol-${id}:checked`)].map((cb) => cb.value);
      await updateProduct(id, {
        name: document.getElementById(`edit-name-${id}`).value.trim(),
        category: document.getElementById(`edit-category-${id}`).value,
        sortOrder: Number(document.getElementById(`edit-sort-${id}`).value) || 0,
        active: document.getElementById(`edit-active-${id}`).checked,
        showProduction: document.getElementById(`edit-showprod-${id}`).checked,
        shipmentMode: document.getElementById(`edit-shipmode-${id}`).value,
      });
      await setProductStockColumns(id, selectedDestIds);
      msg.textContent = '保存しました';
      msg.className = 'msg msg-success';
      await loadProductsList();
    } catch (e) {
      msg.textContent = '保存に失敗しました: ' + e.message;
      msg.className = 'msg msg-error';
    }
  });
}

// ---- 卸出荷先マスタ管理 ----

async function renderDestinationsAdminPage() {
  app.innerHTML = `
    <div class="page">
      ${backLinkHtml()}
      <h1>卸出荷先マスタ管理</h1>
      <div class="card">
        <h2>卸出荷先を追加</h2>
        <div class="field">
          <label for="dest-name">名称</label>
          <input type="text" id="dest-name" placeholder="例) ○○商店">
        </div>
        <button class="primary" id="dest-add-btn">追加する</button>
        <div class="msg" id="dest-add-msg"></div>
      </div>
      <div id="dest-list"><p class="hint">読み込み中...</p></div>
    </div>`;

  document.getElementById('dest-add-btn').addEventListener('click', async () => {
    const nameInput = document.getElementById('dest-name');
    const name = nameInput.value.trim();
    const msg = document.getElementById('dest-add-msg');
    if (!name) {
      msg.textContent = '名称を入力してください';
      msg.className = 'msg msg-error';
      return;
    }
    try {
      const existing = await fetchDestinations({ activeOnly: false });
      await createDestination({ name, sortOrder: existing.length });
      nameInput.value = '';
      msg.textContent = '追加しました';
      msg.className = 'msg msg-success';
      await loadDestinationsList();
    } catch (e) {
      msg.textContent = '追加に失敗しました: ' + e.message;
      msg.className = 'msg msg-error';
    }
  });

  await loadDestinationsList();
}

async function loadDestinationsList() {
  const listEl = document.getElementById('dest-list');
  listEl.innerHTML = '<p class="hint">読み込み中...</p>';
  try {
    const destinations = await fetchDestinations({ activeOnly: false });
    listEl.innerHTML = `
      <div class="card">
        ${destinations
          .map(
            (d) => `
          <div class="qty-row master-row">
            <span class="qty-name${d.active ? '' : ' inactive'}">${escapeHtml(d.name)}${d.active ? '' : '(非表示)'}${
              d.show_as_stock_column ? '(在庫一覧に列表示)' : ''
            }</span>
            <button class="btn-plain master-edit-btn" data-id="${d.id}">編集</button>
          </div>
          <div class="master-edit-form" id="edit-dest-${d.id}" style="display:none"></div>`
          )
          .join('')}
      </div>`;
    listEl.querySelectorAll('.master-edit-btn').forEach((btn) => {
      btn.addEventListener('click', () => toggleDestinationEditForm(btn.dataset.id, destinations));
    });
  } catch (e) {
    listEl.innerHTML = `<p class="msg-error">読み込みに失敗しました: ${escapeHtml(e.message)}</p>`;
  }
}

function toggleDestinationEditForm(id, destinations) {
  const el = document.getElementById(`edit-dest-${id}`);
  if (el.style.display !== 'none') {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  const d = destinations.find((x) => x.id === id);
  el.style.display = '';
  el.innerHTML = `
    <div class="card">
      <div class="field">
        <label>名称</label>
        <input type="text" id="edit-dest-name-${id}" value="${escapeHtml(d.name)}">
      </div>
      <div class="field">
        <label>並び順(小さいほど先に表示)</label>
        <input type="number" id="edit-dest-sort-${id}" value="${d.sort_order}">
      </div>
      <label class="checkbox-label">
        <input type="checkbox" id="edit-dest-active-${id}" ${d.active ? 'checked' : ''}>
        表示する(オフにすると卸出荷入力画面から隠れます)
      </label>
      <label class="checkbox-label">
        <input type="checkbox" id="edit-dest-stockcol-${id}" ${d.show_as_stock_column ? 'checked' : ''}>
        在庫一覧の表で、この卸出荷先だけ独立した列として表示する(オフの卸出荷先は「卸出荷」欄にまとめて合計されます)
      </label>
      <button class="primary" id="edit-dest-save-${id}">保存する</button>
      <div class="msg" id="edit-dest-msg-${id}"></div>
    </div>`;
  document.getElementById(`edit-dest-save-${id}`).addEventListener('click', async () => {
    const msg = document.getElementById(`edit-dest-msg-${id}`);
    try {
      await updateDestination(id, {
        name: document.getElementById(`edit-dest-name-${id}`).value.trim(),
        sortOrder: Number(document.getElementById(`edit-dest-sort-${id}`).value) || 0,
        active: document.getElementById(`edit-dest-active-${id}`).checked,
        showAsStockColumn: document.getElementById(`edit-dest-stockcol-${id}`).checked,
      });
      msg.textContent = '保存しました';
      msg.className = 'msg msg-success';
      await loadDestinationsList();
    } catch (e) {
      msg.textContent = '保存に失敗しました: ' + e.message;
      msg.className = 'msg msg-error';
    }
  });
}

route();
