// 商品カテゴリ(固定リスト)。カテゴリを増やしたい場合はここに追記する。
const CATEGORIES = ['ピザ', 'チーズ', '新みちのくクリスピー', '新みちのくナポリ', '爆盛チーズピザ'];

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
          <input type="number" inputmode="numeric" min="0" step="1" class="qty-input" data-product-id="${p.id}" value="${
            byProductQty[p.id] || 0
          }">
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
      saveBtn.style.display = '';
      saveBtn.onclick = async () => {
        saveBtn.disabled = true;
        try {
          const entries = collectQtyEntries(body, products);
          await saveProductionBatch(date, entries);
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
      saveBtn.style.display = '';
      saveBtn.onclick = async () => {
        saveBtn.disabled = true;
        try {
          const entries = collectQtyEntries(body, products);
          await saveWholesaleBatch(date, destinationId, entries);
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
      saveBtn.style.display = '';
      saveBtn.onclick = async () => {
        saveBtn.disabled = true;
        try {
          const entries = collectQtyEntries(body, products);
          await saveEcBatch(date, mall, entries);
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
      <p class="hint">製造・EC出荷・卸出荷の記録から、日ごとの在庫を自動計算して表示します。</p>
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
      <div id="stock-body"><p class="hint">読み込み中...</p></div>
    </div>`;
  const categorySelect = document.getElementById('stock-category');
  const monthInput = document.getElementById('stock-month');
  const reload = () => loadStockBody(categorySelect.value, monthInput.value);
  categorySelect.addEventListener('change', reload);
  monthInput.addEventListener('change', reload);
  await reload();
}

async function loadStockBody(category, monthStr) {
  const body = document.getElementById('stock-body');
  body.innerHTML = '<p class="hint">読み込み中...</p>';
  try {
    const allProducts = await fetchProducts();
    const products = allProducts.filter((p) => p.category === category);
    if (!products.length) {
      body.innerHTML = '<div class="card"><p class="hint">このカテゴリには商品が登録されていません。</p></div>';
      return;
    }
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
    const dailyWs = sumByDateProduct(wholesaleRows, 'ship_date');
    const dailyEc = sumByDateProduct(ecRows, 'ship_date');

    const rows = [];
    let d = monthStart;
    while (d <= monthEnd) {
      const cells = products.map((p) => {
        const key = `${d}|${p.id}`;
        const dp = dailyProd[key] || 0;
        const dw = dailyWs[key] || 0;
        const de = dailyEc[key] || 0;
        balance[p.id] = (balance[p.id] || 0) + dp - dw - de;
        return { production: dp, ec: de, wholesale: dw, stock: balance[p.id] };
      });
      rows.push({ date: d, cells });
      d = nextDateStr(d);
    }

    const headerRow1 =
      '<tr><th rowspan="2">日付</th>' +
      products.map((p) => `<th colspan="4">${escapeHtml(p.name)}</th>`).join('') +
      '</tr>';
    const headerRow2 =
      '<tr>' + products.map(() => '<th>製造</th><th>EC出荷</th><th>卸出荷</th><th>在庫</th>').join('') + '</tr>';
    const bodyRows = rows
      .map((r) => {
        const cellsHtml = r.cells
          .map(
            (c) =>
              `<td class="${c.production ? '' : 'cell-empty'}">${c.production || ''}</td>` +
              `<td class="${c.ec ? '' : 'cell-empty'}">${c.ec || ''}</td>` +
              `<td class="${c.wholesale ? '' : 'cell-empty'}">${c.wholesale || ''}</td>` +
              `<td>${c.stock}</td>`
          )
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
  } catch (e) {
    body.innerHTML = `<p class="msg-error">読み込みに失敗しました: ${escapeHtml(e.message)}</p>`;
  }
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
    const products = await fetchProducts({ activeOnly: false });
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
      btn.addEventListener('click', () => toggleProductEditForm(btn.dataset.id, products));
    });
  } catch (e) {
    listEl.innerHTML = `<p class="msg-error">読み込みに失敗しました: ${escapeHtml(e.message)}</p>`;
  }
}

function toggleProductEditForm(id, products) {
  const el = document.getElementById(`edit-product-${id}`);
  if (el.style.display !== 'none') {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  const p = products.find((x) => x.id === id);
  el.style.display = '';
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
      <button class="primary" id="edit-save-${id}">保存する</button>
      <div class="msg" id="edit-msg-${id}"></div>
    </div>`;
  document.getElementById(`edit-save-${id}`).addEventListener('click', async () => {
    const msg = document.getElementById(`edit-msg-${id}`);
    try {
      await updateProduct(id, {
        name: document.getElementById(`edit-name-${id}`).value.trim(),
        category: document.getElementById(`edit-category-${id}`).value,
        sortOrder: Number(document.getElementById(`edit-sort-${id}`).value) || 0,
        active: document.getElementById(`edit-active-${id}`).checked,
      });
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
            <span class="qty-name${d.active ? '' : ' inactive'}">${escapeHtml(d.name)}${d.active ? '' : '(非表示)'}</span>
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
