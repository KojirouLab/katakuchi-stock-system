// 商品カテゴリ(固定リスト)。カテゴリを増やしたい場合はここに追記する。
const CATEGORIES = ['ピザ生地', 'チーズ', 'ソース', '新みちのくクリスピー', '新みちのくナポリ', '爆盛チーズピザ', 'ろっこ', '牡蠣', 'ムール貝', 'その他'];

// EC出荷はYahoo!/Amazon/楽天/Shopifyなどモールを問わず合計数量だけを管理する
// (ec_shipments.mallは常にこの値を使う。将来モール別に分けたくなった場合のために列だけ残してある)。
const EC_MALL_ALL = 'all';

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
  if (view === 'ec-import') return renderEcImportPage();
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
          <li><a href="?view=ec-import">助ネコCSV取込(EC出荷をまとめて反映)</a></li>
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
          <input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" class="qty-input" data-product-id="${p.id}" value="${
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
        // フォーカス移動を1ティック遅らせ、直前のキー入力(スマホの予測変換確定など)が
        // 完全に片付いてから0にリセットする。
        setTimeout(() => {
          next.value = '0';
          next.focus();
        }, 0);
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
  app.innerHTML = `
    <div class="page">
      ${backLinkHtml()}
      <h1>EC出荷入力</h1>
      <p class="hint">日付を選び、Yahoo!・Amazon・楽天・Shopifyなどモールを問わず合計した出荷個数を商品ごとに入力してください。同じ日付を選び直すと、これまでの入力内容が読み込まれます。まとめて取り込みたい場合は<a href="?view=ec-import">助ネコCSV取込</a>も使えます。</p>
      <div class="card">
        <div class="field-row">
          <div class="field">
            <label for="ec-date">日付</label>
            <input type="date" id="ec-date" value="${date}">
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
  const categorySelect = document.getElementById('ec-category');
  const reload = () => loadEcBody(dateInput.value, EC_MALL_ALL, categorySelect.value);
  dateInput.addEventListener('change', reload);
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
// - 在庫はshow_stock!==falseの時だけ、製造はshow_production!==falseの時だけ末尾に表示
// (ムール貝のように製造も在庫管理もしない、入荷したらそのまま出荷する商品向け)
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
  if (product.show_stock !== false) {
    cols.push({ type: 'stock', label: '在庫' });
  }
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

function showStockDetail(date, productId, { products, rows, wholesaleRows, allDestinations }) {
  const detailEl = document.getElementById('stock-detail');
  const product = products.find((p) => p.id === productId);
  const productIdx = products.findIndex((p) => p.id === productId);
  const row = rows.find((r) => r.date === date);
  if (!detailEl || !product || !row) return;
  const cell = row.cells[productIdx];

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
    <p class="hint">製造: ${cell.production} / EC出荷(モール合計): ${cell.ec} / 在庫(この日時点): ${cell.stock}</p>
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
      <label class="checkbox-label">
        <input type="checkbox" id="edit-showstock-${id}" ${p.show_stock !== false ? 'checked' : ''}>
        在庫一覧に在庫列を表示する(在庫を持たず入荷したらそのまま出荷する商品はオフ)
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
        showStock: document.getElementById(`edit-showstock-${id}`).checked,
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

// ---- 助ネコCSV取込 ----

// 全角の数字だけでなく、全角の英字・記号(「１３０ｇ」の「ｇ」等)も半角に変換する。
// 数字だけを見ていた頃は「１３０ｇ」のような全角アルファベット混じりの表記で
// 「130g」を検出するパターンが一致せず、誤判定の原因になっていた。
function normalizeDigits(str) {
  return String(str ?? '').replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

// 簡易CSVパーサ("..."で囲まれたフィールド、""でのエスケープ、フィールド内改行に対応)
function parseCsvText(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ヘッダー行から列名→インデックスを引き、行オブジェクトの配列にする。列名は部分一致で探す。
function csvRowsToObjects(rows) {
  if (!rows.length) return [];
  const header = rows[0];
  const findCol = (needle) => header.findIndex((h) => h.includes(needle));
  const idx = {
    // 「商品コード(店舗)」列にも「商品」の文字が含まれるため、先に「商品名」で厳密に探す
    name: findCol('商品名') >= 0 ? findCol('商品名') : findCol('商品'),
    code: findCol('コード'),
    qty: findCol('個数') >= 0 ? findCol('個数') : findCol('数量'),
    // 「注文日」「処理済日」など「日」を含む列が複数あるため、まず「出荷予定日」を厳密に探し、
    // 無ければ「発送」を含む列、最後に「日」を含む列(最初に見つかったもの)を使う。
    // (以前は「発送」→「日」の順だけで探していたため、「出荷予定日」より先に「注文日」が
    // 見つかってしまい、出荷予定日ではなく注文日を取り込んでしまうバグがあった)
    date:
      findCol('出荷予定日') >= 0
        ? findCol('出荷予定日')
        : findCol('発送') >= 0
        ? findCol('発送')
        : findCol('日'),
    orderNo: findCol('受注番号') >= 0 ? findCol('受注番号') : findCol('注文'),
    recipientSei: findCol('お届け先名（姓）'),
    recipientMei: findCol('お届け先名（名）'),
  };
  return rows
    .slice(1)
    .filter((r) => r.some((v) => v !== ''))
    .map((r) => {
      const sei = idx.recipientSei >= 0 ? r[idx.recipientSei] || '' : '';
      const mei = idx.recipientMei >= 0 ? r[idx.recipientMei] || '' : '';
      return {
        name: idx.name >= 0 ? normalizeForMatch(r[idx.name] || '') : '',
        code: idx.code >= 0 ? normalizeForMatch((r[idx.code] || '').trim()) : '',
        qty: idx.qty >= 0 ? Number(r[idx.qty]) || 0 : 0,
        date: idx.date >= 0 ? (r[idx.date] || '').trim().replace(/\//g, '-') : '',
        orderNo: idx.orderNo >= 0 ? r[idx.orderNo] || '' : '',
        recipient: `${sei}${mei ? ' ' + mei : ''}`.trim(),
      };
    });
}

// 「(1枚目:1.マルゲリータ、2枚目:2.４種のチーズ…)」のような福袋商品のタイトルから、
// 各枚のフレーバー番号・フレーバー名を抜き出す。福袋でなければnullを返す。
function extractBundleFlavors(rawText) {
  // 全角数字混じりの表記(「７バジルソース…」のようにピリオド無しの場合もある)に対応するため正規化する。
  const text = normalizeDigits(rawText);
  const startIdx = text.search(/\d+枚目[:：]/);
  if (startIdx === -1) return null;
  // 括弧は（）だけでなく〈〉のような二重括弧で囲まれていることもあるため、
  // 末尾の余分な括弧はまとめて取り除く。
  const TRAILING_BRACKETS = /[）)〉》】」』]+$/;
  const inner = text.slice(startIdx).replace(TRAILING_BRACKETS, '');
  const segments = inner.split(/[、,]/);
  const flavors = [];
  segments.forEach((seg) => {
    // 「1.マルゲリータ」(ピリオドあり)と「７バジルソース…」(ピリオドなし)の両方に対応
    const m = seg.match(/\d+枚目[:：](\d+)[.．]?(.+)/);
    // 最後の項目は「（〈…〉）」のように外側の括弧が付いたまま残ることがあるので、
    // 項目ごとにも末尾の括弧を取り除く。
    if (m) flavors.push({ flavorNum: Number(m[1]), text: m[2].trim().replace(TRAILING_BRACKETS, '') });
  });
  return flavors.length ? flavors : null;
}

function detectBundleCategory(fullText) {
  if (fullText.includes('クリスピー')) return '新みちのくクリスピー';
  if (fullText.includes('ナポリ')) return '新みちのくナポリ';
  return null;
}

// 「10枚バラエティセット」「全10種類 おまかせ」のように、枚ごとのフレーバー指定(1枚目:…)が
// 無いまま「全種類を1個ずつ」詰め合わせる商品タイトルを検出する。該当すれば対象カテゴリを返す。
function detectFixedVarietySet(rawText) {
  if (extractBundleFlavors(rawText)) return null; // 枚ごとの選択がある場合はそちらを優先
  const text = normalizeDigits(rawText);
  const hasVarietyWord = /バラエティセット|全10種類|おまかせ/.test(text);
  const has10 = /10枚|10種類/.test(text);
  if (!hasVarietyWord || !has10) return null;
  if (text.includes('クリスピー')) return '新みちのくクリスピー';
  if (text.includes('ナポリ')) return '新みちのくナポリ';
  return null;
}

// 「5枚+シュレッドチーズ300gセット」のように、ピザ生地とシュレッドチーズ1袋がセットに
// なっている商品タイトルを検出する。ピザの枚数だけを倍率として返す(チーズは1袋固定)。
function detectPizzaPlusCheeseBundle(rawText) {
  const text = normalizeDigits(rawText);
  const m = text.match(/(\d+)\s*枚\s*\+\s*シュレッドチーズ\s*(\d+)\s*g\s*セット/);
  if (!m) return null;
  return { pizzaMultiplier: Number(m[1]), cheeseWeight: Number(m[2]) };
}

// 「モッツァレラチーズ/1kg ブラッツアーレ（4kg）」「モッツァレラ BRAZZALE 冷凍
// ブロック 1kg...（個数/kg数:1kg）」のように、1kgあたり1個の商品を検出する。
// カタカナ「ブラッツ」でも英語表記「BRAZZALE」でも検出し、末尾の「(Nkg)」や
// 「個数/kg数:Nkg」があればNを倍率とし、無ければ1個として扱う。
function detectCheeseKgBundle(rawText) {
  const text = normalizeDigits(rawText);
  if (!/ブラッツ/.test(text) && !/BRAZZALE/i.test(text)) return null;
  const m =
    text.match(/[（(]\s*(\d+)\s*kg\s*[）)]/) ||
    text.match(/個数\/?kg数[:：]\s*(\d+)\s*kg/i);
  return { category: 'チーズ', name: 'ブラッツァーレ', multiplier: m ? Number(m[1]) : 1 };
}

// 「シュレッドチーズ 300g シュレッドタイプ...」のような1袋のシュレッドチーズ商品は、
// 「/」区切りや末尾の「（300g×1袋）」の有無など表記にばらつきがあるため、
// 完全一致のキャッシュに頼らずキーワードで検出する。
function detectShreddedCheese(rawText) {
  if (!/シュレッド/.test(rawText) || !/チーズ/.test(rawText)) return null;
  return { category: 'チーズ', name: 'シュレッド' };
}

// 「ドライイースト サフ 500g 赤（個数:10個）」のように、個数がタイトル内の
// 「個数:」ラベルで明示されているイースト商品を検出する(色違いは現状「赤」のみ登録)。
function detectDryYeast(rawText) {
  const text = normalizeDigits(rawText);
  if (!/イースト/.test(text)) return null;
  const m = text.match(/個数[:：]\s*(\d+)\s*個/);
  const multiplier = m ? Number(m[1]) : 1;
  const name = text.includes('赤') ? '赤サフ（イースト）' : null;
  return { category: 'その他', name, multiplier };
}

// 「殻付き牡蠣...(サイズ:M、入り数:2kg、軍手ナイフセット:不要)」のように、牡蠣は
// サイズ(S/M)・入り数(kg)・軍手ナイフセットの要否がタイトル末尾のラベルで明示されている。
// 牡蠣本体はサイズ別に何kgかを、軍手ナイフセットは必要な注文だけ別商品として数える。
// 「軍手ナイフセット:要/必要」「軍手ナイフセット:不要」の他に、「オプション:軍手ナイフセット」
// のように選択肢名だけが書かれている(=選択されている)表記もあるため両方に対応する。
// 「殻付き生牡蠣...冷凍1kg 宮城県産」のようにサイズの明示が無い商品は、S/Mと区別せず
// 「無選別」というサイズ区分1個で管理する(本人確認済み、2026-09-09)。
function detectOysterBundle(rawText) {
  if (!/牡蠣|オイスター/.test(rawText)) return null;
  const text = normalizeDigits(rawText);
  const sizeMatch = text.match(/サイズ[:：]\s*([SM])/i);
  const kgMatch =
    text.match(/入り数[:：]\s*(\d+(?:\.\d+)?)\s*kg/i) || text.match(/(\d+(?:\.\d+)?)\s*kg/i);
  if (!sizeMatch && !kgMatch) return null;
  const glovesLabelMatch = text.match(/軍手ナイフセット[:：]\s*(要|不要|必要)/);
  const gloves = glovesLabelMatch
    ? glovesLabelMatch[1] !== '不要'
    : /オプション[:：]\s*軍手ナイフセット/.test(text);
  return {
    size: sizeMatch ? sizeMatch[1].toUpperCase() : '無選別',
    kg: kgMatch ? Number(kgMatch[1]) : 1,
    gloves,
  };
}

// 「活ムール貝 3kg 女川産」「活ムール貝 三陸産 冷蔵（入り数:2kg）」のように、サイズ違いは
// 無くkg数だけが商品ごとに異なる。「入り数:Nkg」の明示があればそちらを優先し、無ければ
// タイトル中の「Nkg」をそのまま読む。
function detectMusselBundle(rawText) {
  if (!/ムール貝/.test(rawText)) return null;
  const text = normalizeDigits(rawText);
  const m = text.match(/入り数[:：]\s*(\d+(?:\.\d+)?)\s*kg/i) || text.match(/(\d+(?:\.\d+)?)\s*kg/i);
  return { category: 'ムール貝', name: 'ムール貝', kg: m ? Number(m[1]) : 1 };
}

// 「MCC パスタソース 5種類 詰め合わせ...」は個々のソースの内訳を分けず、
// 詰め合わせ1箱をそのまま「その他」カテゴリの1商品として数える。
function detectMccPastaSauce(rawText) {
  if (!/MCC/.test(rawText) || !/パスタソース/.test(rawText)) return null;
  return { category: 'その他', name: 'パスタソース' };
}

// 「【業務用 テゾーロ ゴルゴンゾーラ チーズ クラッシュタイプ 1kg」は、既存の
// 「ゴルゴンゾーラ(発注は5袋)」と同じ商品として扱う(本人確認済み、2026-09-11)。
function detectTezoroGorgonzola(rawText) {
  if (!/テゾーロ/.test(rawText) || !/ゴルゴンゾーラ/.test(rawText)) return null;
  return { category: 'チーズ', name: 'ゴルゴンゾーラ(発注は5袋)' };
}

// 「訳あり/規格外品/業務用ピザ生地詰め合わせセット...」は、既存の「訳あり」と
// 同じ商品として扱う(本人確認済み、2026-09-11)。
function detectWakeariPizzaAssortment(rawText) {
  if (!/訳あり/.test(rawText) || !/規格外/.test(rawText) || !/ピザ生地/.test(rawText)) return null;
  return { category: 'ピザ生地', name: '訳あり' };
}

// 「みちのくバジルソースとシーフードのピザ（ナポリタイプ）」「みちのくピザ マルゲリータ
// （ナポリタイプ）」のように、フレーバー番号の指定なしに単品(1枚)で販売されている
// みちのくピザのタイトルを検出する。サイズの明示が無ければ8インチが標準(本人確認済み。
// マルゲリータのみサイズ違いの商品が複数あるので、サイズ表記(6/8/10インチ)があれば
// そちらを優先する)。
const MICHINOKU_FLAVOR_KEYWORDS = [
  ['マルゲリータ', 'マルゲ'],
  ['四種チーズ', '2四種チーズ'],
  ['アラビアータ', '3アラビアータ'],
  ['アンチョビ', '4アンチョビ'],
  ['コーン', '5コーンチキン'],
  ['シラス', '6シラス'],
  ['シーフード', '7魚介'],
  ['スモークチーズ', '8スモークチーズ'],
  ['たらこ', '9タラコ'],
  ['照り', '10照り焼き'],
];
function detectMichinokuSingleFlavor(rawText) {
  if (!/みちのく/.test(rawText) || !/ピザ/.test(rawText)) return null;
  const text = normalizeDigits(rawText);
  const typeMatch = text.match(/[（(](ナポリ|クリスピー)タイプ[）)]/);
  if (!typeMatch) return null;
  const category = typeMatch[1] === 'クリスピー' ? '新みちのくクリスピー' : '新みちのくナポリ';
  for (const [keyword, shortName] of MICHINOKU_FLAVOR_KEYWORDS) {
    if (!text.includes(keyword)) continue;
    if (shortName === 'マルゲ') {
      const sizeMatch = text.match(/(\d+)\s*インチ/);
      const size = sizeMatch ? sizeMatch[1] : '8';
      return { category, name: `マルゲ${size}インチ` };
    }
    return { category, name: shortName };
  }
  return null;
}

// 「生地:マルゲリータ・ナポリタイプ、サイズ:10インチ、数量:5枚セット」
// 「生地:マルゲリータ：ナポリタイプ、サイズ:8 インチ...」のように、フレーバー(マルゲリータ)・
// 生地タイプ・サイズが「生地:」ラベルで明示されている選べるセット商品を検出する。区切り文字は
// 「・」「･」「:」(全角コロンはnormalizeDigitsで半角化済み)など複数パターンがある。タイトル前半に
// 「クリスピータイプ選べる」等の選択肢一覧があっても、「生地:」欄の実際の指定を優先する
// (でないと最初に出てくるキーワードに引きずられて別の生地タイプに誤判定してしまう)。
function detectMargheritaSelectableBundle(rawText) {
  const text = normalizeDigits(rawText);
  const m = text.match(/生地[:：]\s*マルゲリータ\s*[・･:：]?\s*(ナポリ|クリスピー)タイプ.*?サイズ[:：]\s*(\d+)\s*インチ/);
  if (!m) return null;
  const category = m[1] === 'クリスピー' ? '新みちのくクリスピー' : '新みちのくナポリ';
  const { value: multiplier } = detectMultiplierInfo(rawText);
  return { category, name: `マルゲ${m[2]}インチ`, multiplier };
}

// 「入り数:5枚」「100個入り」「5枚セット」「50個セット」等、1回の注文(個数)で実際に
// 何枚/何個出庫されるかを表す倍率をタイトルから探す。見つからなければ1を返す。
// 入り数(倍率)と、それが「入り数:」等の明示表記から確実に読み取れたか(confident)を返す。
// 明示表記が無く1をデフォルトにした場合はconfident:falseになる(confidentは現状表示等では
// 使っていないが、将来の判定材料用に残してある)。
function detectMultiplierInfo(rawText) {
  const text = normalizeDigits(rawText);
  const m =
    text.match(/入り数[:：]\s*(\d+)\s*[枚個]/) ||
    text.match(/(\d+)\s*[枚個]入り/) ||
    text.match(/(\d+)\s*枚セット/) ||
    text.match(/(\d+)\s*個セット/) ||
    // 「玉生地 150g 10個」「玉生地 200g×60個」のように、重さの直後に区切り記号や空白を
    // 挟んで個数だけが続く(「入り」「セット」等の言葉が無い)業務用タイトル向け。
    text.match(/\d+\s*g\s*[×xX]?\s*(\d+)\s*個/) ||
    // 「（8インチ 50枚）」のように、インチの直後に区切り記号や空白を挟んで枚数だけが
    // 続く(「入り数:」「セット」等の言葉が無い)業務用タイトル向け。
    text.match(/インチ\s*(\d+)\s*枚/) ||
    // 「（10インチ100グラム 20枚）」のように、間に「グラム」等の他の数量表記を挟んで
    // 括弧の最後に枚数だけが書かれている業務用タイトル向け(最後の手がかりとして使う)。
    text.match(/(\d+)\s*枚\s*[）)]/);
  return { value: m ? Number(m[1]) : 1, confident: !!m };
}

// 「ナポリ/クリスピー ○インチ」「玉生地 ○g」のような単純な商品名から、ピザ生地カテゴリの
// 商品名(例: 6ナポリ、150玉)と、1個あたりの入り数(枚数/個数)を推測する。
// 商品コード(例: gyoumu_tama150g)は複数サイズで使い回されていることがあり、コード名を
// 鵜呑みにできないため、confidentMultiplier(入り数を明示表記から確実に読み取れたか)も
// 一緒に返す。商品コードがあってもconfidentMultiplierがtrueならタイトル解析を優先する。
// 判断できなければnullを返す。
function detectSimpleProductName(rawText) {
  const text = normalizeDigits(rawText);
  const { value: multiplier, confident: confidentMultiplier } = detectMultiplierInfo(rawText);
  // 「サイズ入り数:8インチ100枚」のように、「サイズ:」「入り数:」がラベルとして分かれずに
  // 連結された表記が稀にある。通常のサイズ/入り数の正規表現ではどちらも検出できず、
  // (デフォルトの倍率1のまま)誤って少ない数量で確定してしまう恐れがあるため、先に検出する。
  const fusedMatch = text.match(/サイズ入り数[:：]\s*(\d+)\s*インチ\s*(\d+)\s*枚/);
  if (fusedMatch) {
    const fusedSize = fusedMatch[1];
    const fusedMultiplier = Number(fusedMatch[2]);
    if (text.includes('クリスピー')) return { category: 'ピザ生地', name: `${fusedSize}クリスピー`, multiplier: fusedMultiplier, confidentMultiplier: true };
    if (text.includes('ナポリ')) return { category: 'ピザ生地', name: `${fusedSize}ナポリ`, multiplier: fusedMultiplier, confidentMultiplier: true };
  }
  if (text.includes('玉生地')) {
    // 「130 150 180 200g」のようなタイトル冒頭のサイズ一覧に引きずられないよう、
    // 「サイズ:150g」の明示指定があればそちらを優先する。
    let weightMatch = text.match(/サイズ[:：]\s*(\d+)\s*g/);
    if (!weightMatch) weightMatch = text.match(/(\d+)\s*g/);
    if (weightMatch) {
      return { category: 'ピザ生地', name: `${weightMatch[1]}玉`, multiplier, confidentMultiplier };
    }
  }
  // 「サイズ:厚め8インチ 130g」「クリスピータイプ クラスト 130g 8インチ」のように、
  // 通常の8インチクリスピーとは別に、厚み違いの130g品が独立した商品(130クリスピー)
  // としてマスタ登録されている。表記順(「厚め8インチ 130g」「130g 8インチ」等)に
  // 関わらず、タイトル中に130gの明示があればインチ数より優先する。
  if (text.includes('クリスピー') && /(?:^|[^0-9])130\s*g(?:[^0-9]|$)/.test(text)) {
    return { category: 'ピザ生地', name: '130クリスピー', multiplier, confidentMultiplier };
  }
  // 「6 8 10 12インチ」のようなタイトル冒頭のサイズ一覧に引きずられないよう、
  // 「サイズ:10インチ」の明示指定があればそちらを優先する。
  let sizeMatch = text.match(/サイズ[:：]\s*(\d+)\s*インチ/);
  if (!sizeMatch) sizeMatch = text.match(/(\d+)\s*インチ/);
  if (sizeMatch) {
    if (text.includes('クリスピー')) return { category: 'ピザ生地', name: `${sizeMatch[1]}クリスピー`, multiplier, confidentMultiplier };
    if (text.includes('ナポリ')) return { category: 'ピザ生地', name: `${sizeMatch[1]}ナポリ`, multiplier, confidentMultiplier };
  }
  return null;
}

// 商品名の中には「ピ」が合成済み文字と「ヒ」+濁点の分解形式で混在して登録されていることが
// あり、見た目が同じでも===比較では一致しない。NFC正規化してから比較することで防ぐ。
function normalizeForMatch(str) {
  return String(str ?? '').normalize('NFC');
}

function resolveProductByPrefix(products, category, prefix) {
  return products.find((p) => p.category === category && normalizeForMatch(p.name).startsWith(String(prefix)));
}

function resolveProductByCategoryName(products, category, name) {
  const target = normalizeForMatch(name);
  return products.find((p) => p.category === category && normalizeForMatch(p.name) === target);
}

// CSVの行オブジェクト配列から、取込候補のエントリ配列を作る。
// 個数が0以下の行(クーポン利用など)は取り込まない。
function buildEcImportEntries(csvRows, products, fallbackDate) {
  const entries = [];
  csvRows.forEach((r) => {
    if (r.qty <= 0) return;
    const date = r.date || fallbackDate;
    const rawName = r.name;
    const bundle = extractBundleFlavors(rawName);
    if (bundle) {
      const category = detectBundleCategory(rawName);
      bundle.forEach((f) => {
        if (category && f.flavorNum >= 2 && f.flavorNum <= 10) {
          const product = resolveProductByPrefix(products, category, f.flavorNum);
          entries.push({
            date,
            qty: r.qty,
            label: `${rawName.slice(0, 24)}…(${f.flavorNum}番目:${f.text})`,
            productId: product ? product.id : null,
            cacheKey: product ? null : `${category}::${f.flavorNum}`,
          });
        } else {
          const cacheKey = `${category || 'flavor'}::${f.text}`;
          entries.push({ date, qty: r.qty, label: f.text, productId: null, cacheKey });
        }
      });
    } else {
      const varietyCategory = detectFixedVarietySet(rawName);
      if (varietyCategory) {
        // 枚ごとの選択肢が無い「全種類1個ずつ」の詰め合わせ。番号1〜10の商品にそれぞれ
        // 1個ずつ割り振る(1番はマルゲリータで番号プレフィックスが無いためキャッシュ経由)。
        for (let flavorNum = 1; flavorNum <= 10; flavorNum += 1) {
          let product = null;
          let cacheKey;
          if (flavorNum === 1) {
            cacheKey = `${varietyCategory}::マルゲリータ`;
          } else {
            product = resolveProductByPrefix(products, varietyCategory, flavorNum);
            cacheKey = product ? null : `${varietyCategory}::${flavorNum}`;
          }
          entries.push({
            date,
            qty: r.qty,
            label: `${rawName.slice(0, 24)}…(${flavorNum}番目/全10種)`,
            productId: product ? product.id : null,
            cacheKey,
          });
        }
      } else if (detectPizzaPlusCheeseBundle(rawName)) {
        // ピザ生地とシュレッドチーズ1袋のセット商品。ピザ側とチーズ側、2つの商品として
        // それぞれ計上する(片方が見つからなくても、もう片方は解決できるように独立させる)。
        const cheeseBundle = detectPizzaPlusCheeseBundle(rawName);
        const simple = detectSimpleProductName(rawName);
        const pizzaProduct = simple ? resolveProductByCategoryName(products, simple.category, simple.name) : null;
        const cheeseProduct = products.find(
          (p) => p.category === 'チーズ' && normalizeForMatch(p.name) === normalizeForMatch('シュレッド')
        );
        entries.push({
          date,
          qty: r.qty * cheeseBundle.pizzaMultiplier,
          label: `${rawName}(ピザ${cheeseBundle.pizzaMultiplier}枚分)`,
          productId: pizzaProduct ? pizzaProduct.id : null,
          cacheKey: pizzaProduct ? null : `simple::${simple ? simple.category : 'ピザ生地'}::${simple ? simple.name : rawName}`,
        });
        entries.push({
          date,
          qty: r.qty,
          label: `${rawName}(シュレッドチーズ${cheeseBundle.cheeseWeight}g)`,
          productId: cheeseProduct ? cheeseProduct.id : null,
          cacheKey: cheeseProduct ? null : 'cheese::シュレッド',
        });
      } else if (detectCheeseKgBundle(rawName)) {
        const cheeseKg = detectCheeseKgBundle(rawName);
        const product = resolveProductByCategoryName(products, cheeseKg.category, cheeseKg.name);
        entries.push({
          date,
          qty: r.qty * cheeseKg.multiplier,
          label: `${rawName}(注文${r.qty}件 × ${cheeseKg.multiplier}kg = ${r.qty * cheeseKg.multiplier}個)`,
          productId: product ? product.id : null,
          cacheKey: product ? null : `simple::${cheeseKg.category}::${cheeseKg.name}`,
        });
      } else if (detectMargheritaSelectableBundle(rawName)) {
        const mb = detectMargheritaSelectableBundle(rawName);
        const product = resolveProductByCategoryName(products, mb.category, mb.name);
        const multiplier = mb.multiplier || 1;
        entries.push({
          date,
          qty: r.qty * multiplier,
          label: multiplier > 1 ? `${rawName}(注文${r.qty}件 × 入り${multiplier} = ${r.qty * multiplier})` : rawName,
          productId: product ? product.id : null,
          cacheKey: product ? null : `simple::${mb.category}::${mb.name}`,
        });
      } else if (detectShreddedCheese(rawName)) {
        const sc = detectShreddedCheese(rawName);
        const product = resolveProductByCategoryName(products, sc.category, sc.name);
        entries.push({
          date,
          qty: r.qty,
          label: rawName,
          productId: product ? product.id : null,
          cacheKey: product ? null : `simple::${sc.category}::${sc.name}`,
        });
      } else if (detectDryYeast(rawName)) {
        const dy = detectDryYeast(rawName);
        const product = dy.name ? resolveProductByCategoryName(products, dy.category, dy.name) : null;
        const multiplier = dy.multiplier || 1;
        entries.push({
          date,
          qty: r.qty * multiplier,
          label: multiplier > 1 ? `${rawName}(注文${r.qty}件 × 入り${multiplier} = ${r.qty * multiplier})` : rawName,
          productId: product ? product.id : null,
          cacheKey: product ? null : `simple::${dy.category}::イースト`,
        });
      } else if (detectOysterBundle(rawName)) {
        // 牡蠣本体(サイズ別kg)と、軍手ナイフセット(「要」の注文のみ)を別商品として計上する。
        const oyster = detectOysterBundle(rawName);
        const product = resolveProductByCategoryName(products, '牡蠣', oyster.size);
        entries.push({
          date,
          qty: r.qty * oyster.kg,
          label: `${rawName}(${oyster.size}サイズ ${oyster.kg}kg × 注文${r.qty}件 = ${r.qty * oyster.kg}kg)`,
          productId: product ? product.id : null,
          cacheKey: product ? null : `simple::牡蠣::${oyster.size}`,
        });
        if (oyster.gloves) {
          const gloveProduct = resolveProductByCategoryName(products, '牡蠣', '軍手ナイフセット');
          entries.push({
            date,
            qty: r.qty,
            label: `${rawName}(軍手ナイフセット)`,
            productId: gloveProduct ? gloveProduct.id : null,
            cacheKey: gloveProduct ? null : 'simple::牡蠣::軍手ナイフセット',
          });
        }
      } else if (detectMusselBundle(rawName)) {
        const mussel = detectMusselBundle(rawName);
        const product = resolveProductByCategoryName(products, mussel.category, mussel.name);
        entries.push({
          date,
          qty: r.qty * mussel.kg,
          label: `${rawName}(${mussel.kg}kg × 注文${r.qty}件 = ${r.qty * mussel.kg}kg)`,
          productId: product ? product.id : null,
          cacheKey: product ? null : `simple::${mussel.category}::${mussel.name}`,
        });
      } else if (detectMccPastaSauce(rawName)) {
        const ps = detectMccPastaSauce(rawName);
        const product = resolveProductByCategoryName(products, ps.category, ps.name);
        entries.push({
          date,
          qty: r.qty,
          label: rawName,
          productId: product ? product.id : null,
          cacheKey: product ? null : `simple::${ps.category}::${ps.name}`,
        });
      } else if (detectMichinokuSingleFlavor(rawName)) {
        const mf = detectMichinokuSingleFlavor(rawName);
        const product = resolveProductByCategoryName(products, mf.category, mf.name);
        entries.push({
          date,
          qty: r.qty,
          label: rawName,
          productId: product ? product.id : null,
          cacheKey: product ? null : `simple::${mf.category}::${mf.name}`,
        });
      } else if (detectTezoroGorgonzola(rawName)) {
        const tg = detectTezoroGorgonzola(rawName);
        const product = resolveProductByCategoryName(products, tg.category, tg.name);
        entries.push({
          date,
          qty: r.qty,
          label: rawName,
          productId: product ? product.id : null,
          cacheKey: product ? null : `simple::${tg.category}::${tg.name}`,
        });
      } else if (detectWakeariPizzaAssortment(rawName)) {
        const wa = detectWakeariPizzaAssortment(rawName);
        const product = resolveProductByCategoryName(products, wa.category, wa.name);
        entries.push({
          date,
          qty: r.qty,
          label: rawName,
          productId: product ? product.id : null,
          cacheKey: product ? null : `simple::${wa.category}::${wa.name}`,
        });
      } else {
        // 助ネコの商品コードは複数サイズ/複数商品で使い回されていることがあり、
        // コード名を信用できないと判断されたため、商品コードはマッチングには使わず、
        // タイトル解析(だめなら商品名そのものでユーザーに確認)だけに一本化する。
        const simple = detectSimpleProductName(rawName);
        if (simple) {
          const product = resolveProductByCategoryName(products, simple.category, simple.name);
          const multiplier = simple.multiplier || 1;
          entries.push({
            date,
            qty: r.qty * multiplier,
            label: multiplier > 1 ? `${rawName}(注文${r.qty}件 × 入り${multiplier} = ${r.qty * multiplier})` : rawName,
            productId: product ? product.id : null,
            cacheKey: product ? null : `simple::${simple.category}::${simple.name}`,
          });
        } else {
          entries.push({ date, qty: r.qty, label: rawName, productId: null, cacheKey: rawName });
        }
      }
    }
  });
  return entries;
}

// 1つのcacheKeyに対応付けられた内訳(items: {productId, qty}の配列)から、entryを複製して返す。
// セット商品など複数商品が対応付けられている場合は商品の数だけ複製し、qtyでその商品の
// 数量倍率(例:「3枚セット」ならqty:3)をかける。空配列(在庫管理外)ならproductId:nullで1件返す。
function expandEntryForMappingItems(en, items) {
  const valid = (items || []).filter((it) => it && it.productId);
  if (!valid.length) return [{ ...en, productId: null, resolved: true }];
  return valid.map((it, i) => {
    const mult = Number(it.qty) || 1;
    return {
      ...en,
      productId: it.productId,
      qty: en.qty * mult,
      resolved: true,
      label: valid.length > 1 || mult !== 1 ? `${en.label}(${i + 1}/${valid.length}種 × ${mult})` : en.label,
    };
  });
}

// 学習キャッシュ(cacheKey→内訳配列)をentries配列に適用する。
function applyEcImportMappings(entries, mappingsByKey) {
  const result = [];
  entries.forEach((en) => {
    if (en.productId || en.cacheKey == null || !mappingsByKey.has(en.cacheKey)) {
      result.push(en);
      return;
    }
    result.push(...expandEntryForMappingItems(en, mappingsByKey.get(en.cacheKey)));
  });
  return result;
}

// CSVの行(csvRows)を1行ずつbuildEcImportEntries+applyEcImportMappingsにかけ、
// 「本日の出荷処理」画面用に、元の行(受注番号・お届け先・出荷予定日)と対応付けたまま
// 商品への解決結果(entries)をまとめる。セット商品などで1行から複数商品に解決される
// 場合も、1つの行グループとして扱う(出荷するかどうかは行単位で判断するため)。
// 「在庫管理外」に解決された行や、個数が0以下(クーポン等)で何も解決されない行は含めない。
function buildEcImportRowGroups(csvRows, products, mappingsByKey, fallbackDate) {
  const groups = [];
  csvRows.forEach((r) => {
    let rowEntries = buildEcImportEntries([r], products, fallbackDate);
    if (!rowEntries.length) return;
    rowEntries = applyEcImportMappings(rowEntries, mappingsByKey);
    const resolved = rowEntries.filter((en) => en.productId);
    if (!resolved.length) return;
    groups.push({
      orderNo: r.orderNo,
      rawName: r.name,
      recipient: r.recipient || '',
      date: r.date || fallbackDate || '',
      entries: resolved,
    });
  });
  return groups;
}

async function renderEcImportPage() {
  app.innerHTML = `
    <div class="page wide">
      ${backLinkHtml()}
      <h1>助ネコCSV取込</h1>
      <p class="hint">助ネコの受注データ(商品名・個数・発送予定日を含むCSV)を取り込み、EC出荷入力にまとめて反映します。モールは区別せず、合計数量だけを取り込みます。「クーポン利用」など個数がマイナスの行は自動的に無視します。</p>
      <div class="card">
        <div class="field">
          <label for="ec-import-file">CSVファイル</label>
          <input type="file" id="ec-import-file" accept=".csv">
        </div>
        <p class="hint" id="ec-import-file-hint">文字コードはShift-JIS(またはUTF-8)を想定しています。</p>
      </div>
      <div id="ec-import-body"></div>
    </div>`;

  document.getElementById('ec-import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const bodyEl = document.getElementById('ec-import-body');
    bodyEl.innerHTML = '<p class="hint">読み込み中...</p>';
    try {
      const buf = await file.arrayBuffer();
      let text;
      try {
        text = new TextDecoder('shift-jis', { fatal: true }).decode(buf);
      } catch (e2) {
        text = new TextDecoder('utf-8').decode(buf);
      }
      const csvRows = csvRowsToObjects(parseCsvText(text));
      if (!csvRows.length) {
        bodyEl.innerHTML = '<div class="card"><p class="msg-error">CSVの中身を読み取れませんでした。列の形式を確認してください。</p></div>';
        return;
      }
      const [products, mappings, processedKeys] = await Promise.all([
        fetchProducts(),
        fetchAllEcImportMappings(),
        fetchProcessedOrderKeys(),
      ]);
      const mappingsByKey = new Map();
      mappings.forEach((m) => {
        const arr = mappingsByKey.get(m.source_text) || [];
        arr.push({ productId: m.product_id, qty: m.qty_per_unit || 1 });
        mappingsByKey.set(m.source_text, arr);
      });
      const hasDate = csvRows.some((r) => r.date);
      let fallbackDate = '';
      if (!hasDate) {
        fallbackDate = window.prompt('CSVに日付の列がありませんでした。このCSVを何日の出荷分として取り込みますか?(例: 2026-08-29)', todayStr()) || todayStr();
      }
      let entries = buildEcImportEntries(csvRows, products, fallbackDate);
      // キャッシュ済みの対応表を適用
      entries = applyEcImportMappings(entries, mappingsByKey);
      renderEcImportReview(bodyEl, entries, products, csvRows, mappingsByKey, fallbackDate, processedKeys);
    } catch (err) {
      bodyEl.innerHTML = `<p class="msg-error">読み込みに失敗しました: ${escapeHtml(err.message)}</p>`;
    }
  });
}

function renderEcImportReview(bodyEl, entries, products, csvRows, mappingsByKey, fallbackDate, processedKeys) {
  // 無視する(product_idがnullで解決済み)のものは除外
  const activeEntries = entries.filter((en) => !(en.resolved && !en.productId));
  const unresolvedKeys = [...new Set(activeEntries.filter((en) => !en.productId && en.cacheKey != null).map((en) => en.cacheKey))];
  const skippedCount = entries.length - activeEntries.length;

  const productOptionsHtml = (selectedId) =>
    '<option value="">選択してください</option>' +
    CATEGORIES.map(
      (cat) =>
        `<optgroup label="${escapeHtml(cat)}">${products
          .filter((p) => p.category === cat)
          .map((p) => `<option value="${p.id}" ${p.id === selectedId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`)
          .join('')}</optgroup>`
    ).join('');

  const unresolvedHtml = unresolvedKeys.length
    ? unresolvedKeys
        .map((key, idx) => {
          const rowsForKey = activeEntries.filter((en) => en.cacheKey === key);
          const totalQty = rowsForKey.reduce((s, en) => s + en.qty, 0);
          const sampleLabel = rowsForKey[0].label;
          return `
      <div class="ec-import-unresolved-item" data-idx="${idx}">
        <div class="qty-row master-row">
          <span class="qty-name">${escapeHtml(sampleLabel)}(合計${totalQty}個・${rowsForKey.length}行)</span>
        </div>
        <div class="field" style="margin: 0 0 8px;">
          <label>この商品名は何種類の商品ですか?(セット商品などで複数商品を1個ずつ計上したい場合は2種類以上を選んでください)</label>
          <select class="ec-import-count-select">
            <option value="">選択してください</option>
            <option value="0">在庫管理外(取り込まない)</option>
            <option value="1">1種類(通常の1商品)</option>
            <option value="2">2種類(1つずつ)</option>
            <option value="3">3種類(1つずつ)</option>
            <option value="4">4種類(1つずつ)</option>
          </select>
        </div>
        <div class="ec-import-product-slots"></div>
        <button class="btn-plain ec-import-resolve-confirm" type="button" style="display:none;margin-bottom:14px;">この内容で確定する</button>
      </div>`;
        })
        .join('')
    : '<p class="hint">対応が必要な商品名はありません。</p>';

  const resolvedGrouped = {};
  activeEntries
    .filter((en) => en.productId)
    .forEach((en) => {
      const k = `${en.date}|${en.productId}`;
      if (!resolvedGrouped[k]) resolvedGrouped[k] = { date: en.date, productId: en.productId, qty: 0 };
      resolvedGrouped[k].qty += en.qty;
    });
  const resolvedRows = Object.values(resolvedGrouped).sort((a, b) => a.date.localeCompare(b.date));
  const resolvedHtml = resolvedRows.length
    ? `<div class="table-scroll"><table class="agg-table"><thead><tr><th>日付</th><th>商品</th><th>数量</th></tr></thead><tbody>
        ${resolvedRows
          .map((r) => {
            const p = products.find((x) => x.id === r.productId);
            return `<tr><td>${escapeHtml(r.date)}</td><td class="row-label">${escapeHtml(
              p ? p.name : '(不明)'
            )}</td><td><input type="text" inputmode="numeric" pattern="[0-9]*" class="qty-input ec-import-qty-input" data-date="${escapeHtml(
              r.date
            )}" data-product-id="${r.productId}" value="${r.qty}" onfocus="this.select()"></td></tr>`;
          })
          .join('')}
      </tbody></table></div>`
    : '<p class="hint">まだ対応済みの商品がありません。</p>';

  // ---- 本日の出荷処理(今日/明日/明後日の出荷予定日ごとにチェックボックスで選べる一覧) ----
  const today = todayStr();
  const tomorrow = nextDateStr(today);
  const dayAfter = nextDateStr(tomorrow);
  let shipBuckets = null;
  const shipGroupsByIdx = [];
  if (unresolvedKeys.length === 0 && csvRows && mappingsByKey) {
    const rowGroups = buildEcImportRowGroups(csvRows, products, mappingsByKey, fallbackDate);
    const processedSet = new Set((processedKeys || []).map((k) => `${k.order_no}||${k.raw_name}`));
    shipBuckets = { overdue: [], unknown: [], today: [], tomorrow: [], dayAfter: [] };
    rowGroups.forEach((g) => {
      if (processedSet.has(`${g.orderNo}||${g.rawName}`)) return;
      if (!g.date) {
        shipBuckets.unknown.push(g);
      } else if (g.date < today) {
        shipBuckets.overdue.push(g);
      } else if (g.date === today) {
        shipBuckets.today.push(g);
      } else if (g.date === tomorrow) {
        shipBuckets.tomorrow.push(g);
      } else if (g.date === dayAfter) {
        shipBuckets.dayAfter.push(g);
      }
      // それより先の出荷予定日は今回の一覧には出さない
    });
  }

  const renderShipGroupRow = (g, disabled, defaultChecked) => {
    const idx = shipGroupsByIdx.length;
    shipGroupsByIdx.push(g);
    const itemsHtml = g.entries
      .map((en) => {
        const p = products.find((x) => x.id === en.productId);
        return `${escapeHtml(p ? p.name : '(不明)')}×${en.qty}`;
      })
      .join('、');
    return `
      <label class="checkbox-label" style="align-items:flex-start;">
        <input type="checkbox" class="ec-ship-row-checkbox" data-idx="${idx}" ${defaultChecked ? 'checked' : ''} ${
      disabled ? 'disabled' : ''
    }>
        <span>
          <strong>${escapeHtml(g.date || '(出荷予定日不明)')}</strong> ${escapeHtml(g.recipient)} <span class="hint">(${escapeHtml(
      g.orderNo
    )})</span><br>
          ${itemsHtml}
          <div class="hint">${escapeHtml(g.rawName.slice(0, 60))}${g.rawName.length > 60 ? '…' : ''}</div>
        </span>
      </label>`;
  };

  let shipSectionHtml = '';
  if (shipBuckets) {
    const buildSection = (title, arr, opts) => {
      if (!arr.length) return '';
      const rowsHtml = arr.map((g) => renderShipGroupRow(g, !!opts.disabled, !!opts.defaultChecked)).join('');
      return `<div style="margin-bottom:16px;"><h3 style="margin:0 0 6px;${
        opts.warn ? 'color:var(--danger);' : ''
      }">${opts.warn ? '⚠️ ' : ''}${title}(${arr.length}件)</h3>${rowsHtml}</div>`;
    };
    const sectionsHtml = [
      buildSection('出荷予定日を過ぎています', shipBuckets.overdue, { defaultChecked: true, warn: true }),
      buildSection('出荷予定日が不明です', shipBuckets.unknown, { defaultChecked: true, warn: true }),
      buildSection('本日出荷予定(自動的に含まれます)', shipBuckets.today, { defaultChecked: true, disabled: true }),
      buildSection(`明日(${tomorrow})出荷予定`, shipBuckets.tomorrow, { defaultChecked: false }),
      buildSection(`明後日(${dayAfter})出荷予定`, shipBuckets.dayAfter, { defaultChecked: false }),
    ].join('');
    const totalCount = shipGroupsByIdx.length;
    shipSectionHtml = `
    <div class="card">
      <h2>本日(${today})の出荷処理</h2>
      <p class="hint">出荷予定日が本日の分は自動的に本日の出荷として処理されます。明日・明後日出荷予定の分はチェックを入れると本日の出荷に前倒しできます。出荷予定日を過ぎている分・不明な分は見落とし防止のため警告表示し、デフォルトでチェック済みです(不要ならチェックを外してください)。一度確定した行は、同じ注文が翌日以降のCSVに再度含まれていても二重に処理されません。</p>
      ${totalCount ? sectionsHtml : '<p class="hint">対象の注文はありません。</p>'}
      ${
        totalCount
          ? '<button class="primary" id="ec-ship-confirm-btn">チェックした分を本日の出荷として確定する</button><div class="msg" id="ec-ship-msg"></div><div id="ec-ship-stock-result"></div>'
          : ''
      }
    </div>`;
  }

  bodyEl.innerHTML = `
    <div class="card">
      <h2>対応が必要な商品名(${unresolvedKeys.length}件)${skippedCount ? `・在庫管理外に設定済み${skippedCount}件` : ''}</h2>
      <p class="hint">助ネコの商品名に対応する在庫管理システムの商品を選んでください。セット商品などで1つの商品名が複数商品の詰め合わせになっている場合は種類数を2以上に、「3枚セット」のように同じ商品が複数個入っている場合は数量を書き換えてください。一度選ぶと、次回から自動で対応します。</p>
      ${unresolvedHtml}
    </div>
    ${shipSectionHtml}
    <div class="card">
      <h2>取り込み内容(日付・商品ごとの合計)</h2>
      <p class="hint">数量はこの場で書き換えられます。保存した後にもう一度直したい時は、数量を書き換えてもう一度「保存する」を押してください(何度でも押せます)。同じ日付・カテゴリは<a href="?view=ec">EC出荷入力</a>からもいつでも呼び出して直せます。</p>
      ${resolvedHtml}
      <button class="primary" id="ec-import-confirm-btn" ${unresolvedKeys.length ? 'disabled' : ''}>この内容をEC出荷入力に保存する</button>
      <p class="hint" id="ec-import-confirm-hint">${
        unresolvedKeys.length ? '上の「対応が必要な商品名」を全て解決すると保存できるようになります。' : ''
      }</p>
      <div class="msg" id="ec-import-msg"></div>
    </div>`;

  bodyEl.querySelectorAll('.ec-import-unresolved-item').forEach((item) => {
    const idx = Number(item.dataset.idx);
    const key = unresolvedKeys[idx];
    const countSel = item.querySelector('.ec-import-count-select');
    const slotsEl = item.querySelector('.ec-import-product-slots');
    const confirmBtn = item.querySelector('.ec-import-resolve-confirm');

    countSel.addEventListener('change', () => {
      const val = countSel.value;
      if (!val) {
        slotsEl.innerHTML = '';
        confirmBtn.style.display = 'none';
        return;
      }
      const n = Number(val);
      if (n === 0) {
        slotsEl.innerHTML = '<p class="hint">この商品名は在庫管理外として扱い、取り込みません。</p>';
      } else {
        slotsEl.innerHTML = Array.from(
          { length: n },
          (_, i) => `
          <div class="field-row" style="margin: 0 0 8px;">
            <div class="field" style="margin-bottom: 0;">
              <label>${n > 1 ? `${i + 1}種類目の商品` : '商品'}</label>
              <select class="ec-import-slot-select">${productOptionsHtml(null)}</select>
            </div>
            <div class="field" style="margin-bottom: 0; max-width: 100px;">
              <label>数量(注文1件につき)</label>
              <input type="text" inputmode="numeric" pattern="[0-9]*" class="qty-input ec-import-slot-qty" value="1" onfocus="this.select()">
            </div>
          </div>`
        ).join('');
      }
      confirmBtn.style.display = '';
    });

    confirmBtn.addEventListener('click', async () => {
      const n = Number(countSel.value);
      let items;
      if (n === 0) {
        items = [];
      } else {
        const selects = [...slotsEl.querySelectorAll('.ec-import-slot-select')];
        const qtyInputs = [...slotsEl.querySelectorAll('.ec-import-slot-qty')];
        if (selects.some((s) => !s.value)) {
          alert('すべての種類で商品を選択してください。');
          return;
        }
        items = selects.map((s, i) => ({ productId: s.value, qty: Number(qtyInputs[i].value) || 1 }));
      }
      confirmBtn.disabled = true;
      countSel.disabled = true;
      try {
        await saveEcImportMappings(key, items);
        const newEntries = [];
        entries.forEach((en) => {
          if (en.cacheKey !== key) {
            newEntries.push(en);
            return;
          }
          newEntries.push(...expandEntryForMappingItems(en, items));
        });
        // 行グループ(本日の出荷処理セクション)も新しい対応表を反映して再計算できるよう、
        // mappingsByKeyにもこの場で反映しておく。
        mappingsByKey.set(key, items);
        renderEcImportReview(bodyEl, newEntries, products, csvRows, mappingsByKey, fallbackDate, processedKeys);
      } catch (e) {
        confirmBtn.disabled = false;
        countSel.disabled = false;
        alert('保存に失敗しました: ' + e.message);
      }
    });
  });

  const confirmBtn = document.getElementById('ec-import-confirm-btn');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', async () => {
      confirmBtn.disabled = true;
      const msg = document.getElementById('ec-import-msg');
      msg.textContent = '保存中...';
      msg.className = 'msg';
      try {
        // その場で書き換えられた数量を、保存直前に読み直す(初回確定後の再修正にも対応するため)
        const currentRows = [...bodyEl.querySelectorAll('.ec-import-qty-input')].map((el) => ({
          date: el.dataset.date,
          productId: el.dataset.productId,
          qty: Number(el.value) || 0,
        }));
        const byDate = {};
        currentRows.forEach((r) => {
          (byDate[r.date] = byDate[r.date] || []).push({ productId: r.productId, qty: r.qty });
        });
        for (const date of Object.keys(byDate)) {
          await saveEcBatch(date, EC_MALL_ALL, byDate[date]);
        }
        msg.textContent = `✓ ${currentRows.length}件を保存しました。数量を直したい時は上の欄を書き換えて、もう一度このボタンを押してください。`;
        msg.className = 'msg msg-success';
      } catch (e) {
        msg.textContent = '保存に失敗しました: ' + e.message;
        msg.className = 'msg msg-error';
      } finally {
        confirmBtn.disabled = !!unresolvedKeys.length;
      }
    });
  }

  const shipConfirmBtn = document.getElementById('ec-ship-confirm-btn');
  if (shipConfirmBtn) {
    shipConfirmBtn.addEventListener('click', async () => {
      shipConfirmBtn.disabled = true;
      const msg = document.getElementById('ec-ship-msg');
      msg.textContent = '処理中...';
      msg.className = 'msg';
      try {
        const checkboxes = [...bodyEl.querySelectorAll('.ec-ship-row-checkbox')];
        const includedGroups = checkboxes.filter((cb) => cb.checked).map((cb) => shipGroupsByIdx[Number(cb.dataset.idx)]);
        const processedRows = [];
        includedGroups.forEach((g) => {
          g.entries.forEach((en) => {
            processedRows.push({
              order_no: g.orderNo,
              raw_name: g.rawName,
              product_id: en.productId,
              qty: en.qty,
              ship_date_original: g.date,
              processed_date: today,
            });
          });
        });
        if (processedRows.length) {
          await saveEcProcessedOrders(processedRows);
        }
        // 本日分の出荷記録(ec_shipments)を、ec_processed_ordersの本日分から合計し直して反映する
        // (同じ日に複数回このボタンを押しても、常に正しい本日累計になるようにするため)
        const todayProcessed = await fetchProcessedOrdersForDate(today);
        const sumByProduct = {};
        todayProcessed.forEach((r) => {
          sumByProduct[r.product_id] = (sumByProduct[r.product_id] || 0) + Number(r.qty);
        });
        const batchEntries = Object.entries(sumByProduct).map(([productId, qty]) => ({ productId, qty }));
        await saveEcBatch(today, EC_MALL_ALL, batchEntries);

        // 本日時点の残り在庫(製造累計−卸出荷累計−EC出荷累計)を計算して表示する
        const [prodRows, wsRows, ecRows] = await Promise.all([
          fetchProductionRange(FAR_PAST_DATE, today),
          fetchWholesaleRange(FAR_PAST_DATE, today),
          fetchEcRange(FAR_PAST_DATE, today),
        ]);
        const prodSum = sumBefore(prodRows, 'record_date', nextDateStr(today));
        const wsSum = sumBefore(wsRows, 'ship_date', nextDateStr(today));
        const ecSum = sumBefore(ecRows, 'ship_date', nextDateStr(today));
        const stockRows = products.map((p) => ({
          category: p.category,
          name: p.name,
          stock: (prodSum[p.id] || 0) - (wsSum[p.id] || 0) - (ecSum[p.id] || 0),
        }));
        const stockHtml = `<div class="table-scroll"><table class="agg-table"><thead><tr><th>カテゴリ</th><th>商品</th><th>本日時点の残り在庫</th></tr></thead><tbody>
          ${stockRows
            .map(
              (r) =>
                `<tr><td>${escapeHtml(r.category)}</td><td class="row-label">${escapeHtml(r.name)}</td><td>${r.stock}</td></tr>`
            )
            .join('')}
        </tbody></table></div>`;
        document.getElementById('ec-ship-stock-result').innerHTML = `<h3>本日時点の残り在庫</h3>${stockHtml}`;

        msg.textContent = `✓ ${includedGroups.length}件を本日の出荷として確定しました。`;
        msg.className = 'msg msg-success';
        checkboxes.forEach((cb) => {
          cb.disabled = true;
        });
      } catch (e) {
        msg.textContent = '処理に失敗しました: ' + e.message;
        msg.className = 'msg msg-error';
        shipConfirmBtn.disabled = false;
      }
    });
  }
}

route();
