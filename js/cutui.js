/*
 * Warsha Studio: the cutting planner, for the carpenter.
 * A list of parts (typed, pasted, or taken from the design on screen), the boards and offcuts of the workshop, and a
 * plan drawn board by board that can be rearranged with the finger. The engine is js/cut.js.
 *
 * Jobs are kept through the editor's own storage (E.store), under ids that start with "cut-", so they are saved and
 * synced wherever the designs are: this device, the page's database in Claude, or the workshop server. The workshop's
 * offcut stock is one more document, "cut-stock".
 */
(function () {
  'use strict';
  const C = window.WarshaCut, E = window.WarshaEd;
  if (!C || !E) return;
  const q = s => document.querySelector(s), qa = s => [...document.querySelectorAll(s)];
  const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const T = s => (window.I18N ? I18N.t(s) : s);
  const mm = v => Math.round(v);
  const ltr = v => '\u2066' + v + '\u2069';   // sizes read left to right inside Arabic text
  const m2 = a => (a / 1e6).toFixed(2);
  const pct = v => Math.round(v * 100) + '%';
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const isRtl = () => (window.I18N ? I18N.rtl !== false : true);
  const cur = () => E.money;

  /* ---------- storage ---------- */
  const JOB = id => 'cut-' + id, STOCK_ID = 'cut-stock';
  const jobs = () => E.store.list.filter(d => d.cfg?.kind === 'cut').sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const stockDoc = () => E.store.list.find(d => d.id === STOCK_ID)?.cfg || {kind: 'cutstock', offcuts: [], stocks: []};
  let job = null, pl = null, tab = 'parts', saveT = 0, dirty = false;
  const S = {sel: null, draw: false, arm: null, big: false, cuts: true};

  async function persist(now) {
    if (!job) return;
    clearTimeout(saveT);
    const go = async () => {
      job.updatedAt = Date.now();
      try { await E.store.save(JOB(job.id), {name: job.name, phone: '', note: '', cfg: {kind: 'cut', job}, thumb: '', updatedAt: job.updatedAt}); dirty = false; status(''); }
      catch (e) { status(T('تعذّر الحفظ على هذا الجهاز: المساحة ممتلئة')); }
    };
    if (now) return go();
    dirty = true; saveT = setTimeout(go, 900);
  }
  async function saveStockDoc(d) {
    try { await E.store.save(STOCK_ID, {name: T('مخزون البقايا'), phone: '', note: '', cfg: {kind: 'cutstock', ...d}, thumb: '', updatedAt: Date.now()}); } catch {}
  }

  /* ---------- a new job: empty, or from the design on screen ---------- */
  function defaultStocks() {
    const sd = stockDoc();
    if (Array.isArray(sd.stocks) && sd.stocks.length) return JSON.parse(JSON.stringify(sd.stocks));
    return [{id: 'b1', name: T('ميلامين أبيض'), L: E.fab.sheetL, W: E.fab.sheetW, th: E.fab.t, grain: false, price: +E.prices.sheetCarcass || 0}];
  }
  function newJob(name) {
    return C.sanitizeJob({id: uid(), name: name || T('مهمة تقطيع'), stocks: defaultStocks(), parts: [], offcuts: [], opt: {kerf: E.fab.kerf, trim: E.fab.trim, minL: 300, minW: 100}});
  }
  const PRICE_KEY = {carcass: 'sheetCarcass', back: 'sheetBack', front: 'sheetFront', accent: 'sheetAccent', panel: 'sheetPanel'};
  function jobFromDesign() {
    const cl = E.cutList(E.cfg), stocks = [], parts = [], key = {};
    for (const m of cl.mats) {
      if (E.NOSHEET.includes(String(m.mat).split(':')[0]) || E.NOSHEET.includes(m.mat)) continue;
      const id = 's' + (stocks.length + 1), grain = cl.grouped.some(g => g.mat === m.mat && g.th === m.th && g.grain);
      key[m.mat + '|' + m.th] = id;
      stocks.push({id, name: `${m.name || E.matName(m.mat)}`, L: E.fab.sheetL, W: E.fab.sheetW, th: m.th, grain, price: +E.prices[PRICE_KEY[m.kind]] || 0});
    }
    cl.grouped.forEach((g, i) => {
      const st = key[g.mat + '|' + g.th]; if (!st) return;
      parts.push({id: 'p' + (i + 1), name: g.kind, note: (g.codes || []).join(' '), L: g.L, W: g.W, qty: g.qty, stock: st, grain: g.grain || '', e: [g.ea >= 1, g.ea >= 2, g.eb >= 1, g.eb >= 2].map(Number)});
    });
    const name = (E.current?.name ? E.current.name + '، ' : '') + T('من التصميم');
    return C.sanitizeJob({id: uid(), name, from: E.current?.id || '', stocks: stocks.length ? stocks : defaultStocks(), parts, offcuts: [], opt: {kerf: E.fab.kerf, trim: E.fab.trim, minL: 300, minW: 100}});
  }

  /* ---------- styles: the editor's tokens, nothing loud but the tape yellow ---------- */
  const CSS = `
#cutSheet{z-index:19}
#cutSheet .box{width:min(1180px,100%);height:min(94vh,980px);max-height:none}
@media (max-width:760px){#cutSheet .box{height:100%;max-height:100%;border-radius:0}}
.cz-top{display:flex;gap:8px;align-items:center;flex:1;min-width:0}
.cz-top input{flex:1;min-width:0;border:1px solid transparent;background:transparent;border-radius:8px;padding:6px 8px;font-family:var(--f-display);font-size:19px;font-weight:600}
.cz-top input:focus{border-color:var(--line);background:var(--sunk);outline:none}
.cz-tabs{flex:none;display:flex;gap:4px;padding:0 16px;border-bottom:1px solid var(--line);position:sticky;top:61px;background:var(--panel);z-index:1;overflow-x:auto}
.cz-tabs button{border:0;background:none;padding:11px 14px;font-weight:500;color:var(--muted);border-bottom:3px solid transparent;white-space:nowrap}
.cz-tabs button[aria-selected=true]{color:var(--ink);border-bottom-color:var(--tape)}
.cz-body{flex:none;padding:14px 16px 90px;display:flex;flex-direction:column;gap:14px}
.cz-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.cz-status{font-size:12.5px;color:var(--muted);white-space:nowrap}
.cz-parts{display:flex;flex-direction:column;gap:6px}
.cz-p{display:grid;grid-template-columns:34px minmax(110px,1.4fr) 86px 86px 62px minmax(110px,1fr) 64px 60px 34px;gap:6px;align-items:center;padding:6px;border:1px solid var(--line);border-radius:10px;background:var(--panel)}
.cz-p.head{border:0;background:none;color:var(--muted);font-size:12.5px;padding:0 6px}
.cz-p .lab{display:none}
.cz-p input,.cz-p select,.cz-f input,.cz-f select{width:100%;min-width:0;border:1px solid var(--line);border-radius:7px;padding:7px 8px;background:var(--sunk)}
.cz-p input[type=number],.cz-f input[type=number]{font-family:var(--f-num);direction:ltr;text-align:center}
.cz-n{font-family:var(--f-num);font-weight:600;text-align:center;font-size:13px}
.cz-g{border:1px solid var(--line);background:var(--sunk);border-radius:7px;padding:6px 4px;font-size:12px;width:100%}
.cz-g[data-g=L],.cz-g[data-g=W]{background:var(--ink);color:var(--panel);border-color:var(--ink)}
.cz-e{width:60px;height:38px;cursor:pointer;touch-action:manipulation}
.cz-e rect.b{fill:var(--sunk);stroke:var(--line)}
.cz-e line{stroke:var(--line);stroke-width:4;stroke-linecap:round}
.cz-e line.on{stroke:var(--tape);stroke-width:5}
.cz-x{border:0;background:none;color:var(--muted);font-size:20px;line-height:1}
@media (max-width:860px){
  .cz-p{grid-template-columns:30px 1fr 1fr 1fr;grid-template-areas:"n name name x" "L L W W" "qty qty st st" "g g e e"}
  .cz-p.head{display:none}
  .cz-p>.cz-n{grid-area:n}.cz-p>.nm{grid-area:name}.cz-p>.L{grid-area:L}.cz-p>.W{grid-area:W}.cz-p>.qty{grid-area:qty}.cz-p>.st{grid-area:st}.cz-p>.cz-g{grid-area:g}.cz-p>.cz-e{grid-area:e;justify-self:center}.cz-p>.cz-x{grid-area:x;justify-self:end}
  .cz-p .lab{display:block;font-size:11px;color:var(--muted)}
}
.cz-f{display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:10px}
.cz-f label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--muted)}
.cz-card{border:1px solid var(--line);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:10px;background:var(--panel)}
.cz-card h3{margin:0;font-size:15px}
.cz-kpi{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.cz-kpi div{border-radius:10px;background:var(--sunk);padding:10px 12px;display:flex;flex-direction:column;gap:2px}
.cz-kpi span{font-size:12.5px;color:var(--muted)}.cz-kpi b{font-family:var(--f-num);font-size:19px;font-weight:600;line-height:1.3}.cz-kpi b bdi{direction:ltr;unicode-bidi:isolate}
.cz-nb{font-family:var(--f-num);font-weight:600;unicode-bidi:isolate;direction:ltr}
.cz-kpi .hi{background:var(--ink);color:var(--panel)}.cz-kpi .hi span{color:inherit;opacity:.75}
.cz-warn{border-inline-start:4px solid var(--bad);background:color-mix(in srgb,var(--bad) 9%,var(--panel));padding:9px 12px;border-radius:8px;font-size:13.5px}
.cz-ok{border-inline-start:4px solid var(--ok);background:color-mix(in srgb,var(--ok) 9%,var(--panel));padding:9px 12px;border-radius:8px;font-size:13.5px}
.cz-sheet{border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--panel)}
.cz-sheet>header{position:static!important;display:flex;gap:10px;align-items:center;justify-content:space-between;padding:9px 12px;border-bottom:1px solid var(--line);background:var(--sunk)!important;flex-wrap:wrap}
.cz-sheet>header b{font-size:14.5px}.cz-sheet>header small{color:var(--muted);font-family:var(--f-num);direction:ltr}
.cz-wrap{overflow:auto;padding:10px;background:var(--stage)}
.cz-wrap svg{display:block;width:100%;height:auto;user-select:none;-webkit-user-select:none}
.cz-wrap.big svg{width:220%}
.cz-wrap.edit svg{touch-action:none}
.cz-svg .board{fill:#E3E7EA;stroke:#14191E;stroke-width:3}
.cz-svg .trim{fill:none;stroke:#8A949B;stroke-width:2;stroke-dasharray:14 10}
.cz-svg .part rect.pr{fill:#FFFFFF;stroke:#14191E;stroke-width:2.5}
.cz-svg .part.sel rect.pr{stroke:#F4B400;stroke-width:9}
.cz-svg .part.bad rect.pr{fill:#F6D2CC}
.cz-svg .part text{fill:#14191E;font-family:"IBM Plex Mono",ui-monospace,monospace;text-anchor:middle;dominant-baseline:central}
.cz-svg .part text.nm{font-family:"IBM Plex Sans Arabic",sans-serif;fill:#3A434A}
.cz-svg .edge{stroke:#F4B400;stroke-width:11}
.cz-svg .grain{stroke:#C4CBD0;stroke-width:2}
.cz-svg .keep{fill:url(#czKeep);stroke:#2E7D4F;stroke-width:2.5}
.cz-svg .keep+text,.cz-svg text.kt{fill:#1E5C38;font-family:"IBM Plex Mono",monospace;text-anchor:middle;dominant-baseline:central;font-weight:600}
.cz-svg .scrap{fill:url(#czScrap)}
.cz-svg .cut{stroke:#D93025;stroke-width:4}
.cz-svg .cutn circle{fill:#D93025}.cz-svg .cutn text{fill:#fff;font-family:"IBM Plex Mono",monospace;text-anchor:middle;dominant-baseline:central;font-weight:600}
.cz-svg .ghost{fill:rgba(244,180,0,.25);stroke:#F4B400;stroke-width:4;stroke-dasharray:16 8}
.cz-svg .ghost+text{fill:#14191E;font-family:"IBM Plex Mono",monospace;text-anchor:middle;dominant-baseline:central;font-weight:600}
.cz-cuts{margin:0;padding:10px 12px 12px;columns:2 240px;font-size:13px;line-height:1.7}
.cz-cuts li{break-inside:avoid}
.cz-tray{display:flex;gap:6px;flex-wrap:wrap}
.cz-chip{border:1px dashed var(--muted);background:var(--panel);border-radius:999px;padding:6px 12px;font-size:13px}
.cz-chip[aria-pressed=true]{border-style:solid;border-color:var(--ink);background:var(--ink);color:var(--panel)}
.cz-bar{position:sticky;bottom:0;margin:0 -16px -90px;padding:10px 16px;background:var(--panel);border-top:1px solid var(--line);display:flex;gap:8px;flex-wrap:wrap;align-items:center;z-index:2}
.cz-tool{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:8px 10px;border-radius:10px;background:var(--ink);color:var(--panel)}
.cz-tool .btn{background:transparent;color:inherit;border-color:rgba(255,255,255,.25)}
.cz-tool .btn[aria-pressed=true]{background:var(--tape);color:var(--tape-ink);border-color:var(--tape)}
.cz-list{display:flex;flex-direction:column;gap:6px}
.cz-list>div{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:8px 10px;border:1px solid var(--line);border-radius:9px}
.cz-mini{display:grid;grid-template-columns:1fr 1fr;gap:8px}
`;
  function addStyle() { if (q('#czCss')) return; const st = document.createElement('style'); st.id = 'czCss'; st.textContent = CSS; document.head.appendChild(st); }

  /* ---------- the sheet ---------- */
  function mount() {
    if (q('#cutSheet')) return;
    addStyle();
    const d = document.createElement('div'); d.className = 'sheet'; d.id = 'cutSheet'; d.hidden = true;
    d.innerHTML = `<div class="box" role="dialog" aria-label="مخطط التقطيع">
      <header><div class="cz-top"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 11h11M14 4v16"/></svg><input id="czName" aria-label="اسم المهمة" maxlength="80"><span class="cz-status" id="czStatus"></span></div>
        <div style="display:flex;gap:6px"><button class="btn" type="button" id="czJobs">المهام</button><button class="x" data-close aria-label="إغلاق">×</button></div></header>
      <div class="cz-tabs" role="tablist"><button type="button" role="tab" data-cztab="parts">القطع</button><button type="button" role="tab" data-cztab="boards">الألواح والبقايا</button><button type="button" role="tab" data-cztab="plan">المخطط</button></div>
      <div class="cz-body" id="czBody"></div>
    </div>`;
    document.body.appendChild(d);
    d.addEventListener('click', onClick);
    d.addEventListener('input', onInput);
    d.addEventListener('change', onChange);
    d.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }
  const status = t => { const s = q('#czStatus'); if (s) s.textContent = t; };

  function open(j) {
    mount();
    job = C.sanitizeJob(j); S.sel = null; S.draw = false; S.arm = null;
    try { localStorage.setItem('wr_cutjob', JSON.stringify(job.id)); } catch {}
    q('#czName').value = job.name;
    q('#cutSheet').hidden = false;
    recompute(); render();
    persist(true);
  }
  function openLast() {
    let id = null; try { id = JSON.parse(localStorage.getItem('wr_cutjob') || 'null'); } catch {}
    const d = jobs().find(x => x.id === JOB(id)) || jobs()[0];
    if (d) open(d.cfg.job); else open(newJob());
  }

  /* ---------- planning ---------- */
  function recompute() {
    try { pl = C.plan(job); } catch (e) { console.error(e); pl = null; }
    job = pl ? pl.job : job;
  }
  function changed(full = true) { recompute(); if (full) render(); else renderPlanOnly(); persist(); }

  /* ---------- rendering ---------- */
  function render() {
    qa('[data-cztab]').forEach(b => b.setAttribute('aria-selected', b.dataset.cztab === tab));
    const body = q('#czBody');
    body.innerHTML = tab === 'parts' ? partsPane() : tab === 'boards' ? boardsPane() : planPane();
  }
  const stockOpts = sel => job.stocks.map(s => `<option value="${h(s.id)}" ${s.id === sel ? 'selected' : ''}>${h(s.name)} ${s.th}</option>`).join('');
  const GR = {L: 'عرق بالطول', W: 'عرق بالعرض', '': 'بلا عرق'};
  // the four edges of a part, drawn as a small board: top and bottom are its length, the sides its width
  const edgeSvg = (p, i) => `<svg class="cz-e" viewBox="0 0 60 38" data-edges="${i}" role="group" aria-label="الحواف"><rect class="b" x="9" y="8" width="42" height="22" rx="2"/>
    <line x1="12" y1="5" x2="48" y2="5" class="${p.e[0] ? 'on' : ''}" data-edge="0"/><line x1="12" y1="33" x2="48" y2="33" class="${p.e[1] ? 'on' : ''}" data-edge="1"/>
    <line x1="5" y1="11" x2="5" y2="27" class="${p.e[2] ? 'on' : ''}" data-edge="2"/><line x1="55" y1="11" x2="55" y2="27" class="${p.e[3] ? 'on' : ''}" data-edge="3"/>
    <rect x="0" y="0" width="60" height="10" fill="transparent" data-edge="0"/><rect x="0" y="28" width="60" height="10" fill="transparent" data-edge="1"/><rect x="0" y="8" width="10" height="22" fill="transparent" data-edge="2"/><rect x="50" y="8" width="10" height="22" fill="transparent" data-edge="3"/></svg>`;
  function partsPane() {
    const n = job.parts.reduce((s, p) => s + p.qty, 0), area = job.parts.reduce((s, p) => s + p.qty * p.L * p.W, 0);
    return `<div class="cz-row"><button class="btn primary" type="button" data-cz="addPart">+ قطعة</button><button class="btn" type="button" data-cz="fromDesign">من التصميم الحالي</button><button class="btn" type="button" data-cz="paste">لصق من جدول</button>
        <label class="btn">استيراد CSV<input type="file" accept=".csv,text/csv,text/plain" id="czCsv" hidden></label><span class="grow" style="flex:1"></span><span class="cz-status"><b class="cz-nb">${n}</b> قطعة، <b class="cz-nb">${m2(area)}</b> م²</span></div>
      <div id="czPaste" hidden class="cz-card"><h3>الصق الأسطر من جدول</h3><p class="hint">كل سطر: الاسم، الطول، العرض، العدد. يقبل النسخ من Excel أو Google Sheets أو أعمدة مفصولة بفاصلة منقوطة.</p>
        <textarea id="czPasteIn" rows="6" dir="auto" placeholder="جانب&#9;720&#9;560&#9;4"></textarea><div class="cz-row"><button class="btn primary" type="button" data-cz="pasteGo">أضف الأسطر</button><button class="btn" type="button" data-cz="pasteX">إلغاء</button></div></div>
      <div class="cz-parts"><div class="cz-p head"><span>#</span><span>القطعة</span><span>الطول مم</span><span>العرض مم</span><span>العدد</span><span>اللوح</span><span>العرق</span><span>الحواف</span><span></span></div>
      ${job.parts.map((p, i) => `<div class="cz-p" data-pi="${i}">
        <span class="cz-n">${i + 1}</span>
        <label class="nm"><span class="lab">القطعة</span><input data-pf="name" value="${h(p.name)}" placeholder="جانب، رف، باب" dir="auto" data-notr></label>
        <label class="L"><span class="lab">الطول مم</span><input data-pf="L" type="number" min="1" max="6000" value="${p.L || ''}" inputmode="numeric"></label>
        <label class="W"><span class="lab">العرض مم</span><input data-pf="W" type="number" min="1" max="3000" value="${p.W || ''}" inputmode="numeric"></label>
        <label class="qty"><span class="lab">العدد</span><input data-pf="qty" type="number" min="1" max="999" value="${p.qty}" inputmode="numeric"></label>
        <label class="st"><span class="lab">اللوح</span><select data-pf="stock">${stockOpts(p.stock)}</select></label>
        <button type="button" class="cz-g" data-g="${p.grain}" data-grain="${i}" title="اتجاه عرق الخشب في القطعة">${GR[p.grain]}</button>
        ${edgeSvg(p, i)}
        <button type="button" class="cz-x" data-delpart="${i}" aria-label="حذف القطعة">×</button></div>`).join('')}
      </div>
      ${job.parts.length ? '' : `<div class="empty">اكتب قطعك أو اجلبها من التصميم الحالي. المقاسات بالمليمتر.</div>`}
      <p class="hint">الحواف: اضغط على جهة القطعة في الرسم الصغير لتضع عليها شريط حافة (فوق وتحت للطول، الجانبان للعرض). العرق: «بالطول» يعني أن العرق يسير مع طول القطعة؛ «بلا عرق» يسمح بتدويرها لتوفير الخشب.</p>
      <div class="cz-bar"><button class="btn primary" type="button" data-cztab="plan">احسب المخطط</button><span class="cz-status">${pl ? sumLine() : ''}</span></div>`;
  }
  function boardsPane() {
    const o = job.opt, inv = stockDoc().offcuts || [];
    return `<div class="cz-card"><h3>الألواح</h3><div class="cz-list">${job.stocks.map((s, i) => `<div data-si="${i}" style="flex-wrap:wrap">
        <div class="cz-f" style="flex:1">
          <label>الاسم<input data-sf="name" value="${h(s.name)}" dir="auto" data-notr></label>
          <label>الطول مم<input data-sf="L" type="number" value="${s.L}"></label><label>العرض مم<input data-sf="W" type="number" value="${s.W}"></label>
          <label>السماكة مم<input data-sf="th" type="number" value="${s.th}" step="0.5"></label>
          <label>سعر اللوح<input data-sf="price" type="number" value="${s.price}" min="0"></label>
          <label class="sw-row" style="flex-direction:row;align-items:center;gap:8px;margin-top:20px"><input type="checkbox" data-sf="grain" ${s.grain ? 'checked' : ''} style="width:auto"> له عرق</label>
        </div>${job.stocks.length > 1 ? `<button type="button" class="cz-x" data-delstock="${i}" aria-label="حذف اللوح">×</button>` : ''}</div>`).join('')}</div>
      <div class="cz-row"><button class="btn" type="button" data-cz="addStock">+ نوع لوح</button><button class="btn ghost" type="button" data-cz="saveStocks">احفظها ألواحاً افتراضية للمهام الجديدة</button></div>
      <p class="hint">طول اللوح هو جهة العرق. اللوح الذي له عرق لا تُدار عليه القطع ذات العرق.</p></div>
      <div class="cz-card"><h3>بقايا تستعملها في هذه المهمة</h3><p class="hint">قطع خشب باقية في الورشة. تُستعمل قبل فتح لوح جديد، ويحسب المخطط كم لوحاً وفّرت.</p>
        <div class="cz-list">${job.offcuts.map((f, i) => `<div data-oi="${i}"><div class="cz-f" style="flex:1"><label>اللوح<select data-of="stock">${stockOpts(f.stock)}</select></label><label>الطول مم<input data-of="L" type="number" value="${f.L}"></label><label>العرض مم<input data-of="W" type="number" value="${f.W}"></label><label>العدد<input data-of="qty" type="number" value="${f.qty}" min="1"></label></div><button type="button" class="cz-x" data-deloff="${i}" aria-label="حذف">×</button></div>`).join('') || `<div class="empty">لا بقايا في هذه المهمة.</div>`}</div>
        <div class="cz-row"><button class="btn" type="button" data-cz="addOff">+ بقية</button>${inv.length ? `<button class="btn" type="button" data-cz="useInv">من مخزون البقايا (${inv.length})</button>` : ''}</div></div>
      <div class="cz-card"><h3>الإعدادات</h3><div class="cz-f">
        <label>سماكة المنشار مم<input data-of2="kerf" type="number" value="${o.kerf}" step="0.5" min="0" max="10"></label>
        <label>تشذيب كل حافة مم<input data-of2="trim" type="number" value="${o.trim}" min="0" max="50"></label>
        <label>أصغر بقية تُحفظ: الطول مم<input data-of2="minL" type="number" value="${o.minL}" min="0"></label>
        <label>أصغر بقية تُحفظ: العرض مم<input data-of2="minW" type="number" value="${o.minW}" min="0"></label>
        <label>القص الأول<select data-of2="first"><option value="rip" ${o.first === 'rip' ? 'selected' : ''}>بالطول أولاً (شرائط)</option><option value="cross" ${o.first === 'cross' ? 'selected' : ''}>بالعرض أولاً</option></select></label>
      </div></div>
      <div class="cz-bar"><button class="btn primary" type="button" data-cztab="plan">احسب المخطط</button><span class="cz-status">${pl ? sumLine() : ''}</span></div>`;
  }
  const stockOf = id => job.stocks.find(s => s.id === id) || job.stocks[0];
  const partOf = id => job.parts.find(p => p.id === id);
  const numOf = id => job.parts.findIndex(p => p.id === id) + 1;
  function sumLine() {
    if (!pl) return '';
    const t = pl.totals;
    return `${t.boards} ${T('لوح')}، ${T('استغلال')} ${pct(pl.per.reduce((s, x) => s + x.partsArea, 0) / Math.max(1, pl.per.reduce((s, x) => s + x.area, 0)))}`;
  }
  function planPane() {
    if (!pl) return `<div class="cz-warn">تعذّر حساب المخطط.</div>`;
    if (!job.parts.some(p => p.qty > 0 && p.L > 0 && p.W > 0)) return `<div class="empty">أضف القطع أولاً من تبويب «القطع».</div>`;
    return `<div id="czPlanTop">${planTop()}</div><div id="czSheets">${pl.sheets.map((s, i) => sheetBox(i)).join('')}</div>
      <div class="cz-bar"><button class="btn primary" type="button" data-cz="pdf">طباعة المخطط PDF</button><button class="btn" type="button" data-cz="labels">ملصقات القطع</button><button class="btn" type="button" data-cz="csv">CSV</button>
        <span style="flex:1"></span>${pl.per.some(x => x.keep.length) ? `<button class="btn ghost" type="button" data-cz="keepToInv">احفظ البقايا الصالحة في المخزون</button>` : ''}</div>`;
  }
  function planTop() {
    const t = pl.totals, all = pl.per, area = all.reduce((s, x) => s + x.area, 0), used = all.reduce((s, x) => s + x.partsArea, 0), keepA = all.reduce((s, x) => s + x.keepArea, 0), waste = all.reduce((s, x) => s + x.wasteArea, 0);
    const keepN = all.reduce((s, x) => s + x.keep.length, 0), notStraight = pl.read.some(r => !r.straight), over = pl.read.some(r => r.errors.some(e => e.type !== 'notStraight'));
    const warn = [];
    if (pl.tooBig.length) warn.push(`${T('قطع أكبر من اللوح، لا تُقص منه')}: ${pl.tooBig.map(id => '#' + numOf(id) + ' ' + h(partOf(id).name)).join('، ')}`);
    if (over) warn.push(T('قطع متداخلة أو خارجة عن اللوح: حرّكها حتى يزول اللون الأحمر.'));
    else if (notStraight) warn.push(T('هذا الترتيب لا يُقص بخطوط مستقيمة من حافة إلى حافة على منشار الألواح. حرّك القطع المظللة أو ارجع إلى المخطط التلقائي.'));
    const free = job.manual ? pl.unplaced.filter(u => !pl.tooBig.includes(u.pid)) : [];
    return `<div class="cz-kpi">
        <div class="hi"><span>الألواح الجديدة</span><b><bdi>${t.boards}</bdi></b></div>
        <div><span>الاستغلال</span><b><bdi>${pct(used / Math.max(1, area))}</bdi></b></div>
        <div><span>الهدر</span><b><bdi>${m2(waste)}</bdi> م²</b></div>
        <div><span>بقايا صالحة</span><b><bdi>${keepN}</bdi> ${T('قطعة')} · <bdi>${m2(keepA)}</bdi> م²</b></div>
        <div><span>كلفة الألواح</span><b><bdi>${cur()(t.cost)}</bdi></b></div>
        ${t.keepValue ? `<div><span>قيمة البقايا الصالحة</span><b><bdi>${cur()(t.keepValue)}</bdi></b></div>` : ''}
        ${t.saved ? `<div class="hi"><span>وفّرت البقايا</span><b><bdi>${t.saved}</bdi> ${T('لوح')}</b></div>` : ''}
        <div><span>شريط الحواف</span><b><bdi>${pl.edge.toFixed(1)}</bdi> م</b></div>
        <div><span>القصات</span><b><bdi>${pl.cuts}</bdi> · <bdi>${pl.cutLen.toFixed(1)}</bdi> م</b></div>
      </div>
      ${all.map(x => `<div class="cz-list"><div><span><b data-notr>${h(x.name)}</b> ${x.th} مم <small class="cz-nb">${x.L}×${x.W}</small></span><span><b class="cz-nb">${x.boards}</b> ${T('لوح جديد')}${x.offcutsUsed ? `، <b class="cz-nb">${x.offcutsUsed}</b> ${T('من البقايا')}` : ''}، ${T('استغلال')} <b class="cz-nb">${pct(x.yield)}</b></span></div></div>`).join('')}
      ${warn.map(w => `<div class="cz-warn">${w}</div>`).join('')}
      ${!warn.length && pl.sheets.length ? `<div class="cz-ok">${T('كل لوح يُقص بخطوط مستقيمة من حافة إلى حافة، والترقيم على الرسم هو ترتيب القص.')}</div>` : ''}
      <div class="cz-tool">
        <button class="btn" type="button" data-cz="edit" aria-pressed="${!!job.manual}">${job.manual ? T('ترتيب يدوي') : T('عدّل بالإصبع')}</button>
        ${job.manual ? `<button class="btn" type="button" data-cz="draw" aria-pressed="${S.draw}">${T('ارسم قطعة')}</button><button class="btn" type="button" data-cz="addSheet">+ ${T('لوح')}</button><button class="btn" type="button" data-cz="auto">${T('رجوع إلى المخطط التلقائي')}</button>` : ''}
        <button class="btn" type="button" data-cz="cuts" aria-pressed="${S.cuts}">${T('تسلسل القص')}</button>
        <button class="btn" type="button" data-cz="big" aria-pressed="${S.big}">${T('تكبير')}</button>
        ${S.sel ? `<span style="flex:1"></span><button class="btn" type="button" data-cz="rot">${T('تدوير')}</button><button class="btn" type="button" data-cz="unplace">${T('إلى القائمة')}</button>` : ''}
      </div>
      ${free.length ? `<div class="cz-card"><h3>${T('قطع لم توضع على لوح')}</h3><p class="hint">${T('اضغط قطعة ثم اضغط مكاناً فارغاً على أي لوح.')}</p><div class="cz-tray">${groupFree(free).map(([pid, n]) => `<button type="button" class="cz-chip" data-arm="${h(pid)}" aria-pressed="${S.arm === pid}">#${numOf(pid)} <span data-notr>${h(partOf(pid).name)}</span> ${partOf(pid).L}×${partOf(pid).W}${n > 1 ? ' ×' + n : ''}</button>`).join('')}</div></div>` : ''}
      ${S.draw ? `<div class="cz-ok">${T('اسحب بإصبعك على مكان فارغ في اللوح لترسم قطعة جديدة، ثم عدّل اسمها ومقاسها.')}</div>` : ''}
      <div id="czDrawForm"></div>`;
  }
  const groupFree = list => Object.entries(list.reduce((m, u) => (m[u.pid] = (m[u.pid] || 0) + 1, m), {}));

  function sheetBox(i) {
    const s = pl.sheets[i], r = pl.read[i], st = stockOf(s.stock), area = s.L * s.W;
    const title = s.kind === 'off' ? T('بقية من المخزون') : `${T('لوح')} ${pl.sheets.slice(0, i + 1).filter(x => x.kind === 'new' && x.stock === s.stock).length} ${T('من')} ${pl.sheets.filter(x => x.kind === 'new' && x.stock === s.stock).length}`;
    return `<section class="cz-sheet" data-sheetbox="${i}"><header><span><b>${title}</b> · <span data-notr>${h(st.name)}</span> ${st.th} ${T('مم')} <small>${s.L}×${s.W}</small></span>
      <span class="cz-status">${T('استغلال')} <b class="cz-nb">${pct(r.partsArea / area)}</b> · ${T('بقايا صالحة')} <b class="cz-nb">${r.keep.length}</b>${job.manual && !s.parts.length ? ` <button type="button" class="btn sm" data-delsheet="${i}">${T('احذف اللوح')}</button>` : ''}</span></header>
      <div class="cz-wrap ${S.big ? 'big' : ''} ${job.manual ? 'edit' : ''}">${sheetSvg(i)}</div>
      ${S.cuts && r.cuts.length ? `<ol class="cz-cuts">${r.cuts.map(c => `<li>${cutText(c)}</li>`).join('')}</ol>` : ''}
      ${r.keep.length ? `<p class="hint" style="padding:0 12px 10px">${T('بقايا صالحة')}: ${r.keep.map(f => `<span class="cz-nb">${mm(Math.max(f.w, f.h))}×${mm(Math.min(f.w, f.h))}</span>`).join('، ')}</p>` : ''}</section>`;
  }
  // "rip a strip 600 wide from the 2780×2050 piece": the width cut off, and the piece it comes from
  function cutText(c) {
    const strip = mm(c.at - (c.dir === 'h' ? c.y : c.x)), from = `${mm(c.w)}×${mm(c.h)}`;
    return c.dir === 'h' ? `${T('قصة طولية')}: ${T('شريط بعرض')} <b class="cz-nb">${strip}</b> ${T('مم من قطعة')} <span class="cz-nb">${from}</span>`
      : `${T('قصة عرضية')}: <b class="cz-nb">${strip}</b> ${T('مم من قطعة')} <span class="cz-nb">${from}</span>`;
  }

  // the board drawn to scale; it reads from the side the page reads from, like the workshop sheet
  function sheetSvg(i) {
    const s = pl.sheets[i], r = pl.read[i], st = stockOf(s.stock), L = s.L, W = s.W, t = job.opt.trim, rtl = isRtl();
    const X = (x, w) => (rtl ? L - x - w : x), pad = Math.max(40, L * .02), fs = Math.max(28, Math.min(L, W) * .028);
    const bad = new Set(r.errors.map(e => e.i).concat(r.errors.filter(e => e.j !== undefined).map(e => e.j)));
    const out = [`<svg class="cz-svg" viewBox="${-pad} ${-pad} ${L + 2 * pad} ${W + 2 * pad}" data-sheet="${i}" role="img" aria-label="${h(st.name)}">
      <defs><pattern id="czKeep" width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="40" height="40" fill="#E6F2EA"/><line x1="0" y1="0" x2="0" y2="40" stroke="#9FCCAF" stroke-width="10"/></pattern>
      <pattern id="czScrap" width="30" height="30" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="30" height="30" fill="#D2D8DC"/><line x1="0" y1="0" x2="0" y2="30" stroke="#B9C1C7" stroke-width="6"/></pattern></defs>
      <rect class="board" x="0" y="0" width="${L}" height="${W}" data-board="${i}"/>`];
    if (t > 0) out.push(`<rect class="trim" x="${t}" y="${t}" width="${L - 2 * t}" height="${W - 2 * t}" pointer-events="none"/>`);
    if (st.grain) for (let y = W * .1; y < W; y += W / 9) out.push(`<line class="grain" x1="${t}" y1="${y}" x2="${L - t}" y2="${y}" pointer-events="none"/>`);
    for (const f of r.scrap) out.push(`<rect class="scrap" x="${X(f.x, f.w)}" y="${f.y}" width="${f.w}" height="${f.h}" pointer-events="none"/>`);
    for (const f of r.keep) {
      out.push(`<rect class="keep" x="${X(f.x, f.w)}" y="${f.y}" width="${f.w}" height="${f.h}" pointer-events="none"/>`);
      const k = Math.min(fs * 1.1, f.h * .32, f.w / 6); if (k > 12) out.push(`<text class="kt" x="${X(f.x, f.w) + f.w / 2}" y="${f.y + f.h / 2}" font-size="${k}" pointer-events="none">${ltr(mm(f.w) + '×' + mm(f.h))}</text>`);
    }
    s.parts.forEach((pq, k) => {
      const p = partOf(pq.pid); if (!p) return;
      const d = C.dims(p, pq.rot), x = X(pq.x, d.w), y = pq.y, sel = S.sel && S.sel.sheet === i && S.sel.k === k;
      const g = [`<g class="part ${sel ? 'sel' : ''} ${bad.has(k) ? 'bad' : ''}" data-part="${i}:${k}" transform="translate(${x} ${y})"><rect class="pr" width="${d.w}" height="${d.h}"/>`];
      // banding drawn inside the edge it is on; for a turned part its length runs up and down
      const e = p.e, ins = 6;
      const lines = pq.rot
        ? [[ins, 0, ins, d.h, e[0]], [d.w - ins, 0, d.w - ins, d.h, e[1]], [0, ins, d.w, ins, e[2]], [0, d.h - ins, d.w, d.h - ins, e[3]]]
        : [[0, ins, d.w, ins, e[0]], [0, d.h - ins, d.w, d.h - ins, e[1]], [ins, 0, ins, d.h, e[2]], [d.w - ins, 0, d.w - ins, d.h, e[3]]];
      for (const [a, b, c2, d2, on] of lines) if (on) g.push(`<line class="edge" x1="${a}" y1="${b}" x2="${c2}" y2="${d2}"/>`);
      const big = Math.min(fs * 1.25, d.h * .3, d.w / 4.2), small = Math.min(fs * .85, d.h * .2, d.w / 7);
      if (big > 10) g.push(`<text x="${d.w / 2}" y="${d.h / 2 - (small > 9 && d.h > big * 3 ? big * .8 : 0)}" font-size="${big}" font-weight="600">${ltr('#' + numOf(p.id))}</text>`);
      if (small > 9 && d.h > big * 3) {
        g.push(`<text class="nm" x="${d.w / 2}" y="${d.h / 2 + small * .5}" font-size="${small}">${h(p.name).slice(0, 18)}</text>`);
        g.push(`<text x="${d.w / 2}" y="${d.h / 2 + small * 1.75}" font-size="${small}">${ltr(p.L + '×' + p.W)}</text>`);
      }
      g.push('</g>'); out.push(g.join(''));
    });
    if (S.cuts) r.cuts.forEach((c, n) => {
      const len = c.len, x1 = c.dir === 'h' ? c.x : c.at, y1 = c.dir === 'h' ? c.at : c.y, x2 = c.dir === 'h' ? c.x + len : c.at, y2 = c.dir === 'h' ? c.at : c.y + len;
      const ax = rtl ? L - x1 : x1, bx = rtl ? L - x2 : x2, mx = (ax + bx) / 2 + (c.dir === 'h' ? 0 : 0), my = (y1 + y2) / 2, rr = Math.max(fs * .62, 16);
      out.push(`<line class="cut" x1="${ax}" y1="${y1}" x2="${bx}" y2="${y2}" pointer-events="none"/><g class="cutn" pointer-events="none"><circle cx="${c.dir === 'h' ? (rtl ? L - c.x - Math.min(len * .08 + rr, len / 2) : c.x + Math.min(len * .08 + rr, len / 2)) : mx}" cy="${c.dir === 'h' ? my : c.y + Math.min(len * .08 + rr, len / 2)}" r="${rr}"/><text x="${c.dir === 'h' ? (rtl ? L - c.x - Math.min(len * .08 + rr, len / 2) : c.x + Math.min(len * .08 + rr, len / 2)) : mx}" y="${c.dir === 'h' ? my : c.y + Math.min(len * .08 + rr, len / 2)}" font-size="${rr * 1.1}">${n + 1}</text></g>`);
    });
    out.push('</svg>');
    return out.join('');
  }
  function renderPlanOnly() {
    if (tab !== 'plan') return render();
    const top = q('#czPlanTop'), sh = q('#czSheets');
    if (!top || !sh) return render();
    top.innerHTML = planTop(); sh.innerHTML = pl.sheets.map((s, i) => sheetBox(i)).join('');
  }

  /* ---------- editing the lists ---------- */
  function onInput(e) {
    const t = e.target;
    if (t.id === 'czName') { job.name = t.value.trim().slice(0, 80) || T('مهمة تقطيع'); persist(); return; }
    const pi = t.closest('[data-pi]'), f = t.dataset.pf;
    if (pi && f && f !== 'stock') { const p = job.parts[+pi.dataset.pi]; if (!p) return; p[f] = f === 'name' ? t.value.slice(0, 60) : Math.max(0, Math.round(+t.value || 0)); if (f === 'qty' && !p.qty) p.qty = 0; soft(); return; }
    const si = t.closest('[data-si]'), sf = t.dataset.sf;
    if (si && sf && sf !== 'grain') { const s = job.stocks[+si.dataset.si]; s[sf] = sf === 'name' ? t.value.slice(0, 60) : +t.value || 0; soft(); return; }
    const oi = t.closest('[data-oi]'), of = t.dataset.of;
    if (oi && of && of !== 'stock') { job.offcuts[+oi.dataset.oi][of] = Math.max(0, Math.round(+t.value || 0)); soft(); return; }
    if (t.dataset.of2 && t.dataset.of2 !== 'first') { job.opt[t.dataset.of2] = +t.value || 0; soft(); }
  }
  // typing: plan again quietly, no redraw of the fields being typed in
  let softT = 0;
  function soft() { clearTimeout(softT); softT = setTimeout(() => { recompute(); const st = qa('.cz-bar .cz-status'); st.forEach(x => (x.textContent = sumLine())); persist(); }, 350); }
  function onChange(e) {
    const t = e.target;
    if (t.id === 'czCsv' && t.files?.[0]) { const r = new FileReader(); r.onload = () => { addRows(C.parseRows(r.result)); t.value = ''; }; r.readAsText(t.files[0]); return; }
    const pi = t.closest('[data-pi]');
    if (pi && t.dataset.pf === 'stock') { job.parts[+pi.dataset.pi].stock = t.value; changed(); return; }
    const si = t.closest('[data-si]');
    if (si && t.dataset.sf === 'grain') { job.stocks[+si.dataset.si].grain = t.checked; changed(); return; }
    if (si && t.dataset.sf) { changed(); return; }
    const oi = t.closest('[data-oi]');
    if (oi && t.dataset.of === 'stock') { job.offcuts[+oi.dataset.oi].stock = t.value; changed(); return; }
    if (t.dataset.of2 === 'first') { job.opt.first = t.value; changed(); return; }
    if (t.dataset.pf || t.dataset.of || t.dataset.of2) changed(false);
  }
  function addRows(rows) {
    if (!rows.length) { E.toast(T('لم أجد أسطراً فيها طول وعرض')); return; }
    const st = job.stocks[0].id;
    for (const r of rows) job.parts.push({id: 'p' + uid(), name: r.name || T('قطعة'), L: r.L, W: r.W, qty: r.qty, stock: st, grain: '', e: [0, 0, 0, 0], note: ''});
    E.toast(`${T('أضيفت')} ${rows.length} ${T('قطعة')}`); changed();
  }

  async function onClick(e) {
    const t = e.target;
    const tb = t.closest('[data-cztab]'); if (tb) { tab = tb.dataset.cztab; S.sel = null; if (tab === 'plan') recompute(); render(); return; }
    const ed = t.closest('[data-edge]'); if (ed) { const i = +ed.closest('[data-edges]').dataset.edges, k = +ed.dataset.edge, p = job.parts[i]; p.e[k] = p.e[k] ? 0 : 1; ed.closest('svg').querySelectorAll(`line[data-edge="${k}"]`).forEach(l => l.classList.toggle('on', !!p.e[k])); soft(); return; }
    const gr = t.closest('[data-grain]'); if (gr) { const p = job.parts[+gr.dataset.grain]; p.grain = p.grain === '' ? 'L' : p.grain === 'L' ? 'W' : ''; gr.dataset.g = p.grain; gr.textContent = T(GR[p.grain]); soft(); return; }
    const dp = t.closest('[data-delpart]'); if (dp) { const p = job.parts[+dp.dataset.delpart]; job.parts.splice(+dp.dataset.delpart, 1); if (job.manual) for (const s of job.manual.sheets) s.parts = s.parts.filter(x => x.pid !== p.id); changed(); return; }
    const ds = t.closest('[data-delstock]'); if (ds) { const s = job.stocks[+ds.dataset.delstock]; job.stocks.splice(+ds.dataset.delstock, 1); for (const p of job.parts) if (p.stock === s.id) p.stock = job.stocks[0].id; changed(); return; }
    const dof = t.closest('[data-deloff]'); if (dof) { job.offcuts.splice(+dof.dataset.deloff, 1); changed(); return; }
    const dsh = t.closest('[data-delsheet]'); if (dsh && job.manual) { job.manual.sheets.splice(+dsh.dataset.delsheet, 1); S.sel = null; changed(); return; }
    const arm = t.closest('[data-arm]'); if (arm) { S.arm = S.arm === arm.dataset.arm ? null : arm.dataset.arm; S.draw = false; renderPlanOnly(); return; }
    if (t.closest('#czJobs')) { jobsSheet(); return; }
    const a = t.closest('[data-cz]')?.dataset.cz; if (!a) return;
    if (a === 'addPart') { job.parts.push({id: 'p' + uid(), name: '', L: 0, W: 0, qty: 1, stock: job.stocks[0].id, grain: '', e: [0, 0, 0, 0], note: ''}); changed(); setTimeout(() => { const ins = qa('[data-pi] [data-pf=name]'); ins[ins.length - 1]?.focus(); }, 30); return; }
    if (a === 'fromDesign') { const j = jobFromDesign(); if (!j.parts.length) { E.toast(T('لا قطع ألواح في التصميم الحالي')); return; } if (job.parts.length && !confirm(T('تُفتح مهمة جديدة بقطع التصميم الحالي. المهمة الحالية تبقى محفوظة.'))) return; open(j); return; }
    if (a === 'paste') { q('#czPaste').hidden = false; q('#czPasteIn').focus(); return; }
    if (a === 'pasteX') { q('#czPaste').hidden = true; return; }
    if (a === 'pasteGo') { addRows(C.parseRows(q('#czPasteIn').value)); return; }
    if (a === 'addStock') { job.stocks.push({id: 's' + uid(), name: T('لوح'), L: E.fab.sheetL, W: E.fab.sheetW, th: 18, grain: false, price: 0}); changed(); return; }
    if (a === 'saveStocks') { await saveStockDoc({...stockDoc(), stocks: job.stocks}); E.toast(T('صارت هذه الألواح الافتراضية للمهام الجديدة')); return; }
    if (a === 'addOff') { job.offcuts.push({stock: job.stocks[0].id, L: 1000, W: 500, qty: 1}); changed(); return; }
    if (a === 'useInv') { const inv = stockDoc().offcuts || []; for (const o of inv) { const st = job.stocks.find(s => Math.abs(s.th - o.th) < .01 && (!o.name || s.name === o.name)) || job.stocks.find(s => Math.abs(s.th - o.th) < .01); if (st) job.offcuts.push({stock: st.id, L: o.L, W: o.W, qty: o.qty || 1}); } changed(); E.toast(T('أضيفت البقايا المناسبة من المخزون')); return; }
    if (a === 'keepToInv') { const inv = stockDoc(), add = []; pl.per.forEach(x => { for (const k of x.keep) add.push({name: x.name, th: x.th, L: k.L, W: k.W, qty: 1, from: job.name.slice(0, 40), at: Date.now()}); }); await saveStockDoc({...inv, offcuts: [...(inv.offcuts || []), ...add].slice(-300)}); E.toast(`${T('حُفظت')} ${add.length} ${T('بقية في المخزون')}`); return; }
    if (a === 'edit') { if (!job.manual) { job.manual = C.toManual(pl); changed(); E.toast(T('حرّك القطع بإصبعك. اضغط قطعة لتدويرها أو إرجاعها إلى القائمة.')); } return; }
    if (a === 'auto') { if (!confirm(T('يُلغى ترتيبك اليدوي ويُحسب المخطط من جديد.'))) return; job.manual = null; S.sel = null; S.draw = false; S.arm = null; changed(); return; }
    if (a === 'draw') { S.draw = !S.draw; S.arm = null; S.sel = null; renderPlanOnly(); return; }
    if (a === 'addSheet') { const st = (S.sel && pl.sheets[S.sel.sheet]?.stock) || job.stocks[0].id, s0 = stockOf(st); job.manual.sheets.push({stock: st, kind: 'new', L: s0.L, W: s0.W, parts: []}); changed(false); return; }
    if (a === 'cuts') { S.cuts = !S.cuts; renderPlanOnly(); return; }
    if (a === 'big') { S.big = !S.big; renderPlanOnly(); return; }
    if (a === 'rot' && S.sel) { rotateSel(); return; }
    if (a === 'unplace' && S.sel) { job.manual.sheets[S.sel.sheet].parts.splice(S.sel.k, 1); S.sel = null; changed(false); return; }
    if (a === 'pdf') { await makePdf(false); return; }
    if (a === 'labels') { await makePdf(true); return; }
    if (a === 'csv') { csvOut(); return; }
    if (a === 'drawOk') { drawCommit(); return; }
    if (a === 'drawX') { q('#czDrawForm').innerHTML = ''; ghost = null; renderPlanOnly(); return; }
  }
  function rotateSel() {
    const {sheet, k} = S.sel, s = job.manual.sheets[sheet], pq = s.parts[k], p = partOf(pq.pid), st = stockOf(s.stock);
    if (st.grain && p.grain) { E.toast(T('القطعة لها عرق على لوح له عرق: لا تُدار')); return; }
    pq.rot = !pq.rot; changed(false);
  }

  /* ---------- the finger on the board: move, place, draw ---------- */
  let drag = null, ghost = null;
  const toBoard = (svg, ev) => { const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY; const m = svg.getScreenCTM(); return m ? pt.matrixTransform(m.inverse()) : {x: 0, y: 0}; };
  const fromView = (i, x, w) => (isRtl() ? pl.sheets[i].L - x - w : x);
  function onDown(e) {
    const svg = e.target.closest('svg[data-sheet]'); if (!svg || !job?.manual || tab !== 'plan') return;
    const i = +svg.dataset.sheet, P = toBoard(svg, e), s = job.manual.sheets[i];
    const pg = e.target.closest('[data-part]');
    if (S.arm) {
      const p = partOf(S.arm); if (!p) return;
      const st = stockOf(s.stock), d = C.dims(p, !!(st.grain && p.grain === 'W'));
      let x = fromView(i, P.x, d.w), y = P.y;
      x = Math.max(job.opt.trim, Math.min(s.L - job.opt.trim - d.w, x)); y = Math.max(job.opt.trim, Math.min(s.W - job.opt.trim - d.h, y));
      s.parts.push({pid: p.id, x: Math.round(x), y: Math.round(y), rot: !!(st.grain && p.grain === 'W')});
      const left = pl.unplaced.filter(u => u.pid === S.arm).length - 1; if (left <= 0) S.arm = null;
      changed(false); e.preventDefault(); return;
    }
    if (S.draw && !pg) { e.preventDefault(); drag = {kind: 'draw', i, svg, x0: P.x, y0: P.y}; svg.setPointerCapture?.(e.pointerId); return; }
    if (!pg) { if (S.sel) { S.sel = null; renderPlanOnly(); } return; }
    const [si, k] = pg.dataset.part.split(':').map(Number), pq = job.manual.sheets[si].parts[k], p = partOf(pq.pid), d = C.dims(p, pq.rot);
    const vx = fromView(si, pq.x, d.w);
    drag = {kind: 'move', i: si, k, svg, g: pg, dx: P.x - vx, dy: P.y - pq.y, w: d.w, h: d.h, moved: false, sx: e.clientX, sy: e.clientY, nx: pq.x, ny: pq.y};
    e.preventDefault();
  }
  function snap(i, k, x, y, w, h) {
    const s = job.manual.sheets[i], t = job.opt.trim, kf = job.opt.kerf, tol = Math.max(8, s.L * .006);
    const xs = [t, s.L - t - w], ys = [t, s.W - t - h];
    s.parts.forEach((o, j) => { if (j === k) return; const p = partOf(o.pid); if (!p) return; const d = C.dims(p, o.rot); xs.push(o.x + d.w + kf, o.x - kf - w, o.x, o.x + d.w - w); ys.push(o.y + d.h + kf, o.y - kf - h, o.y, o.y + d.h - h); });
    const near = (v, list) => { let b = v, bd = tol; for (const c of list) { const dd = Math.abs(c - v); if (dd < bd) { bd = dd; b = c; } } return b; };
    x = near(x, xs); y = near(y, ys);
    return {x: Math.round(Math.max(t, Math.min(s.L - t - w, x))), y: Math.round(Math.max(t, Math.min(s.W - t - h, y)))};
  }
  function onMove(e) {
    if (!drag) return;
    const P = toBoard(drag.svg, e);
    if (drag.kind === 'move') {
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return;
      drag.moved = true;
      const raw = fromView(drag.i, P.x - drag.dx, drag.w), sn = snap(drag.i, drag.k, raw, P.y - drag.dy, drag.w, drag.h);
      drag.nx = sn.x; drag.ny = sn.y;
      drag.g.setAttribute('transform', `translate(${fromView(drag.i, sn.x, drag.w)} ${sn.y})`);
      drag.g.classList.add('sel');
    } else if (drag.kind === 'draw') {
      const x = Math.min(drag.x0, P.x), y = Math.min(drag.y0, P.y), w = Math.abs(P.x - drag.x0), hh = Math.abs(P.y - drag.y0);
      drag.svg.querySelector('.ghost')?.remove(); drag.svg.querySelector('.ghostT')?.remove();
      const ns = 'http://www.w3.org/2000/svg', r = document.createElementNS(ns, 'rect');
      r.setAttribute('class', 'ghost'); r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', w); r.setAttribute('height', hh); drag.svg.appendChild(r);
      const tx = document.createElementNS(ns, 'text'); tx.setAttribute('class', 'ghostT'); tx.setAttribute('x', x + w / 2); tx.setAttribute('y', y + hh / 2); tx.setAttribute('font-size', Math.max(24, Math.min(80, hh * .3)));
      tx.setAttribute('style', 'font-family:IBM Plex Mono,monospace;text-anchor:middle;dominant-baseline:central;font-weight:600'); tx.textContent = `${Math.round(w)}×${Math.round(hh)}`; drag.svg.appendChild(tx);
      drag.box = {x, y, w, h: hh};
    }
  }
  function onUp(e) {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.kind === 'move') {
      if (!d.moved) { S.sel = S.sel && S.sel.sheet === d.i && S.sel.k === d.k ? null : {sheet: d.i, k: d.k}; renderPlanOnly(); return; }
      // dropped on another board: the part moves there, where the finger is
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('svg[data-sheet]');
      const to = over ? +over.dataset.sheet : d.i;
      if (to !== d.i) {
        const pq = job.manual.sheets[d.i].parts.splice(d.k, 1)[0], P = toBoard(over, e), dest = job.manual.sheets[to];
        const st = stockOf(dest.stock), p = partOf(pq.pid);
        if (dest.stock !== job.manual.sheets[d.i].stock) { E.toast(T('اللوح الآخر من نوع مختلف: غيّر لوح القطعة من القائمة أولاً')); job.manual.sheets[d.i].parts.splice(d.k, 0, pq); renderPlanOnly(); return; }
        void st;
        const sn = snap(to, -1, fromView(to, P.x - d.dx, d.w), P.y - d.dy, d.w, d.h); pq.x = sn.x; pq.y = sn.y; dest.parts.push(pq); S.sel = {sheet: to, k: dest.parts.length - 1};
        void p;
      } else { const pq = job.manual.sheets[d.i].parts[d.k]; pq.x = d.nx; pq.y = d.ny; S.sel = {sheet: d.i, k: d.k}; }
      changed(false); return;
    }
    if (d.kind === 'draw') {
      const b = d.box; if (!b || b.w < 20 || b.h < 20) { renderPlanOnly(); return; }
      const s = job.manual.sheets[d.i], x = fromView(d.i, b.x, b.w);
      ghost = {i: d.i, x: Math.round(Math.max(job.opt.trim, x)), y: Math.round(Math.max(job.opt.trim, b.y)), w: Math.round(b.w), h: Math.round(b.h)};
      q('#czDrawForm').innerHTML = `<div class="cz-card"><h3>${T('قطعة جديدة')}</h3><div class="cz-f">
        <label>${T('القطعة')}<input id="czDN" dir="auto" placeholder="${T('رف إضافي')}"></label><label>${T('الطول مم')}<input id="czDL" type="number" value="${ghost.w}"></label><label>${T('العرض مم')}<input id="czDW" type="number" value="${ghost.h}"></label></div>
        <div class="cz-row"><button class="btn primary" type="button" data-cz="drawOk">${T('أضف القطعة')}</button><button class="btn" type="button" data-cz="drawX">${T('إلغاء')}</button></div></div>`;
      void s; q('#czDN').focus();
    }
  }
  function drawCommit() {
    if (!ghost) return;
    const s = job.manual.sheets[ghost.i], L = Math.max(1, Math.round(+q('#czDL').value || ghost.w)), W = Math.max(1, Math.round(+q('#czDW').value || ghost.h));
    const p = {id: 'p' + uid(), name: q('#czDN').value.trim() || T('قطعة'), L, W, qty: 1, stock: s.stock, grain: '', e: [0, 0, 0, 0], note: ''};
    job.parts.push(p); s.parts.push({pid: p.id, x: ghost.x, y: ghost.y, rot: false});
    ghost = null; S.draw = false; q('#czDrawForm').innerHTML = ''; changed(false); E.toast(T('أضيفت القطعة إلى القائمة وإلى اللوح'));
  }

  /* ---------- the jobs ---------- */
  function jobsSheet() {
    const L = jobs();
    const box = document.createElement('div'); box.className = 'cz-card'; box.id = 'czJobsBox';
    box.innerHTML = `<h3>${T('مهام التقطيع')}</h3><div class="cz-row"><button class="btn primary" type="button" data-cj="new">${T('مهمة جديدة فارغة')}</button><button class="btn" type="button" data-cj="design">${T('مهمة من التصميم الحالي')}</button></div>
      <div class="cz-list">${L.map(d => `<div><span><b data-notr>${h(d.name)}</b> <small class="cz-nb">${new Date(d.updatedAt || 0).toLocaleDateString('en-GB')}</small> · ${(d.cfg.job?.parts || []).length} ${T('سطر')}</span>
        <span class="cz-row"><button class="btn sm" type="button" data-cj="open:${h(d.id)}">${T('فتح')}</button><button class="btn sm ghost" type="button" data-cj="copy:${h(d.id)}">${T('نسخة')}</button><button class="btn sm danger" type="button" data-cj="del:${h(d.id)}">${T('حذف')}</button></span></div>`).join('') || `<div class="empty">${T('لا مهام بعد')}</div>`}</div>`;
    const body = q('#czBody'); q('#czJobsBox')?.remove(); body.prepend(box);
    box.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-cj]'); if (!b) return; const [a, id] = b.dataset.cj.split(/:(.*)/);
      if (a === 'new') { tab = 'parts'; open(newJob()); return; }
      if (a === 'design') { tab = 'parts'; const j = jobFromDesign(); if (!j.parts.length) { E.toast(T('لا قطع ألواح في التصميم الحالي')); return; } open(j); return; }
      const d = E.store.list.find(x => x.id === id); if (!d) return;
      if (a === 'open') { open(d.cfg.job); return; }
      if (a === 'copy') { const j = JSON.parse(JSON.stringify(d.cfg.job)); j.id = uid(); j.name = (j.name + ' ' + T('نسخة')).slice(0, 80); open(j); return; }
      if (a === 'del') { if (!confirm(T('حذف مهمة التقطيع هذه؟'))) return; await E.store.remove(id); if (job && JOB(job.id) === id) { job = null; open(jobs()[0]?.cfg.job || newJob()); } else jobsSheet(); }
    });
  }

  /* ---------- the workshop papers: plan, labels, CSV ---------- */
  async function makePdf(labels) {
    if (!pl || !pl.sheets.length) { E.toast(T('لا مخطط بعد')); return; }
    const btn = q(`[data-cz="${labels ? 'labels' : 'pdf'}"]`); if (btn) btn.disabled = true;
    try {
      await E.docFonts(); await E.logoReady();
      const d = E.newDoc(labels ? 'ملصقات القطع' : 'مخطط التقطيع');
      head(d, labels ? 'ملصقات القطع' : 'مخطط التقطيع');
      if (labels) drawLabels(d); else drawPlan(d);
      E.showDoc({...(await d.finish()), name: `${T(labels ? 'ملصقات القطع' : 'مخطط التقطيع')} ${job.name}.pdf`}, T(labels ? 'ملصقات القطع' : 'مخطط التقطيع'), T(labels ? 'اطبع على ورق ملصقات A4، ثلاثة في كل سطر.' : 'اطبع المخطط وضعه عند المنشار.'));
    } catch (e) { console.error(e); E.toast(T('تعذّر تجهيز الملف، حاول مرة أخرى')); }
    finally { if (btn) btn.disabled = false; }
  }
  function head(d, kind) {
    const x = d.x; let right = E.PW - E.PM;
    if (E.logoImg) { const hh = 80, w = Math.min(200, E.logoImg.width * hh / E.logoImg.height); x.drawImage(E.logoImg, right - w, d.y - 4, w, hh); right -= w + 20; }
    d.set(38, 700, 'd'); x.textAlign = 'right'; x.fillText(E.prices.shop || 'ورشة العرض', right, d.y + 40);
    d.set(32, 600, 'b'); x.textAlign = 'left'; x.fillText(kind, E.PM, d.y + 38);
    x.font = `400 18px ${E.FF.m}`; x.fillStyle = E.MUTED; x.direction = 'ltr'; x.textAlign = 'left'; x.fillText(E.today(), E.PM, d.y + 72);
    d.y += 100; x.fillStyle = E.TAPE; x.fillRect(E.PM, d.y, E.PW - 2 * E.PM, 8); d.y += 30;
    d.text(job.name, {sz: 24, w: 600});
    d.text(`${T('المنشار')} ${job.opt.kerf} ${T('مم')}، ${T('تشذيب')} ${job.opt.trim} ${T('مم')} ${T('من كل حافة')}، ${T('أصغر بقية تُحفظ')} ${job.opt.minL}×${job.opt.minW} ${T('مم')}`, {sz: 17, color: E.MUTED, gap: 6});
  }
  const edgeCode = p => [p.e[0] + p.e[1] ? 'ط' + (p.e[0] + p.e[1]) : '', p.e[2] + p.e[3] ? 'ع' + (p.e[2] + p.e[3]) : ''].filter(Boolean).join(' ') || '-';
  function drawPlan(d) {
    const t = pl.totals;
    d.h2('الخلاصة');
    d.table([{label: 'اللوح', w: .3}, {label: 'جديد', w: .1, align: 'center', f: 'm'}, {label: 'بقايا', w: .1, align: 'center', f: 'm'}, {label: 'الاستغلال', w: .13, align: 'center', f: 'm'}, {label: 'الهدر م²', w: .13, align: 'center', f: 'm'}, {label: 'بقايا صالحة', w: .24, align: 'center', f: 'm'}],
      pl.per.map(x => [`${x.name} ${x.th} مم`, String(x.boards), String(x.offcutsUsed), pct(x.yield), m2(x.wasteArea), `${x.keep.length} · ${m2(x.keepArea)} م²`]));
    d.text(`${T('كلفة الألواح')}: ${cur()(t.cost)}${t.keepValue ? `، ${T('قيمة البقايا الصالحة')}: ${cur()(t.keepValue)}` : ''}${t.saved ? `، ${T('وفّرت البقايا')} ${t.saved} ${T('لوح')}` : ''}. ${T('شريط الحواف')}: ${pl.edge.toFixed(1)} ${T('م')}. ${T('القصات')}: ${pl.cuts} (${pl.cutLen.toFixed(1)} ${T('م')}).`, {sz: 18});
    if (pl.tooBig.length) d.text(`${T('قطع أكبر من اللوح، لا تُقص منه')}: ${pl.tooBig.map(id => '#' + numOf(id)).join('، ')}`, {sz: 18, color: '#B3261E', w: 600});
    if (pl.read.some(r => !r.straight)) d.text(T('تنبيه: في هذا الترتيب لوح لا يُقص بخطوط مستقيمة من حافة إلى حافة.'), {sz: 18, color: '#B3261E', w: 600});
    d.h2('القطع');
    d.table([{label: '#', w: .06, align: 'center', f: 'm'}, {label: 'القطعة', w: .26}, {label: 'الطول', w: .1, align: 'center', f: 'm'}, {label: 'العرض', w: .1, align: 'center', f: 'm'}, {label: 'العدد', w: .08, align: 'center', f: 'm'}, {label: 'اللوح', w: .2}, {label: 'العرق', w: .09, align: 'center'}, {label: 'الحواف', w: .11, align: 'center'}],
      job.parts.filter(p => p.qty > 0).map(p => [String(numOf(p.id)), p.name + (p.note ? ` (${p.note})` : ''), String(p.L), String(p.W), String(p.qty), `${stockOf(p.stock).name} ${stockOf(p.stock).th}`, p.grain === 'L' ? 'طول' : p.grain === 'W' ? 'عرض' : '-', edgeCode(p)]), {sz: 16, pad: 8});
    d.text('الحواف: ط = على الطول، ع = على العرض، والرقم عدد الجهات. الأرقام على الرسوم أرقام هذه القائمة، والدوائر الحمراء ترتيب القص.', {sz: 15, color: E.MUTED});
    pl.sheets.forEach((s, i) => {
      const r = pl.read[i], st = stockOf(s.stock), w = E.PW - 2 * E.PM, k = w / s.L, hh = Math.round(s.W * k);
      d.need(hh + 200);
      if (d.y > E.PM + 200) { d.page(); }
      d.h2(`${s.kind === 'off' ? T('بقية من المخزون') : T('لوح') + ' ' + (i + 1)}: ${st.name} ${st.th} ${T('مم')}، ${s.L}×${s.W}`, hh + 40);
      drawBoard(d.x, E.PM, d.y, w, s, r, i);
      d.y += hh + 18;
      d.text(`${T('استغلال')} ${pct(r.partsArea / (s.L * s.W))}. ${r.keep.length ? T('بقايا صالحة') + ': ' + r.keep.map(f => `${mm(Math.max(f.w, f.h))}×${mm(Math.min(f.w, f.h))}`).join('، ') : T('لا بقايا صالحة')}.`, {sz: 17});
      if (r.cuts.length) {
        d.table([{label: '#', w: .07, align: 'center', f: 'm'}, {label: 'القصة', w: .23}, {label: 'المقاس المقطوع مم', w: .3, align: 'center', f: 'm'}, {label: 'من قطعة مم', w: .4, align: 'center', f: 'm'}],
          r.cuts.map((c, n) => [String(n + 1), c.dir === 'h' ? 'طولية' : 'عرضية', String(mm(c.at - (c.dir === 'h' ? c.y : c.x))), `${mm(c.w)}×${mm(c.h)}`]), {sz: 15, pad: 7});
      }
    });
  }
  // a board on the page: same drawing as on screen, read from the reading side (the page mirrors itself in LTR)
  function drawBoard(x, x0, y0, w, s, r, i) {
    const k = w / s.L, hh = s.W * k, Xp = (bx, bw) => x0 + w - (bx + bw) * k;
    x.fillStyle = '#E3E7EA'; x.fillRect(x0, y0, w, hh); x.strokeStyle = E.INK; x.lineWidth = 2; x.strokeRect(x0, y0, w, hh);
    for (const f of r.scrap) { x.fillStyle = '#C9D0D5'; x.fillRect(Xp(f.x, f.w), y0 + f.y * k, f.w * k, f.h * k); }
    for (const f of r.keep) {
      const fx = Xp(f.x, f.w), fy = y0 + f.y * k; x.fillStyle = '#DDEFE3'; x.fillRect(fx, fy, f.w * k, f.h * k); x.strokeStyle = '#2E7D4F'; x.lineWidth = 1.5; x.strokeRect(fx, fy, f.w * k, f.h * k);
      if (f.w * k > 70 && f.h * k > 18) { x.direction = 'ltr'; x.textAlign = 'center'; x.fillStyle = '#1E5C38'; x.font = `600 13px ${E.FF.m}`; x.fillText(`${mm(f.w)}×${mm(f.h)}`, fx + f.w * k / 2, fy + f.h * k / 2 + 5); }
    }
    s.parts.forEach(pq => {
      const p = partOf(pq.pid); if (!p) return; const dd = C.dims(p, pq.rot), px = Xp(pq.x, dd.w), py = y0 + pq.y * k, pw = dd.w * k, ph = dd.h * k;
      x.fillStyle = '#FFFFFF'; x.fillRect(px, py, pw, ph); x.strokeStyle = E.INK; x.lineWidth = 1.3; x.strokeRect(px, py, pw, ph);
      x.fillStyle = E.TAPE; const e = p.e, b = Math.max(2, 4 * k * 10);
      const sides = pq.rot ? [[px, py, b, ph, e[1]], [px + pw - b, py, b, ph, e[0]], [px, py, pw, b, e[2]], [px, py + ph - b, pw, b, e[3]]] : [[px, py, pw, b, e[0]], [px, py + ph - b, pw, b, e[1]], [px + pw - b, py, b, ph, e[2]], [px, py, b, ph, e[3]]];
      for (const [a1, a2, a3, a4, on] of sides) if (on) x.fillRect(a1, a2, a3, a4);
      x.direction = 'ltr'; x.textAlign = 'center'; x.fillStyle = E.INK;
      if (pw > 30 && ph > 16) { x.font = `600 ${Math.min(19, ph * .45)}px ${E.FF.m}`; x.fillText('#' + numOf(p.id), px + pw / 2, py + ph / 2 + (pw > 90 && ph > 46 ? -8 : 6)); }
      if (pw > 90 && ph > 46) { x.font = `400 13px ${E.FF.m}`; x.fillStyle = E.MUTED; x.fillText(`${p.L}×${p.W}`, px + pw / 2, py + ph / 2 + 14); }
    });
    r.cuts.forEach((c, n) => {
      const X1 = c.dir === 'h' ? Xp(c.x, c.len) : Xp(c.at, 0), Y1 = y0 + (c.dir === 'h' ? c.at : c.y) * k, len = c.len * k;
      x.strokeStyle = '#D93025'; x.lineWidth = 1.6; x.beginPath();
      if (c.dir === 'h') { x.moveTo(X1, Y1); x.lineTo(X1 + len, Y1); } else { x.moveTo(X1, Y1); x.lineTo(X1, Y1 + len); } x.stroke();
      const cx = c.dir === 'h' ? X1 + len - Math.min(len / 2, 24) : X1, cy = c.dir === 'h' ? Y1 : Y1 + Math.min(len / 2, 24);
      x.fillStyle = '#D93025'; x.beginPath(); x.arc(cx, cy, 11, 0, Math.PI * 2); x.fill(); x.fillStyle = '#fff'; x.font = `600 12px ${E.FF.m}`; x.textAlign = 'center'; x.direction = 'ltr'; x.fillText(String(n + 1), cx, cy + 4);
    });
    void i;
  }
  function drawLabels(d) {
    const cols = 3, rows = 8, gx = 14, gy = 10, lw = (E.PW - 2 * E.PM - (cols - 1) * gx) / cols, lh = (E.PH - d.y - E.PM - (rows - 1) * gy) / rows;
    const all = [];
    pl.sheets.forEach((s, si) => s.parts.forEach((pq, k) => { const p = partOf(pq.pid); if (p) all.push({p, si, n: pl.labels[si][k]}); }));
    let y = d.y, col = 0, row = 0, firstPage = true;
    const LH = () => (firstPage ? lh : (E.PH - 2 * E.PM - (rows - 1) * gy) / rows);
    for (const a of all) {
      if (row >= rows) { d.page(); firstPage = false; y = E.PM; row = 0; col = 0; }
      const x0 = E.PW - E.PM - (col + 1) * lw - col * gx, y0 = y + row * (LH() + gy), x = d.x;
      x.strokeStyle = E.RULE; x.lineWidth = 1.5; x.strokeRect(x0, y0, lw, LH()); x.fillStyle = E.TAPE; x.fillRect(x0 + lw - 8, y0, 8, LH());
      d.set(26, 700, 'm'); x.direction = 'ltr'; x.textAlign = 'left'; x.fillText('#' + numOf(a.p.id), x0 + 14, y0 + 36);
      d.set(19, 600, 'b'); x.textAlign = 'right'; x.fillText(String(a.p.name).slice(0, 22), x0 + lw - 20, y0 + 34);
      x.font = `600 22px ${E.FF.m}`; x.fillStyle = E.INK; x.direction = 'ltr'; x.textAlign = 'left'; x.fillText(`${a.p.L} × ${a.p.W}`, x0 + 14, y0 + 72);
      d.set(15, 400, 'b', E.MUTED); x.textAlign = 'right';
      x.fillText(`${T('حواف')} ${edgeCode(a.p)} · ${T('لوح')} ${a.si + 1} · ${a.n}/${a.p.qty}`, x0 + lw - 20, y0 + 102);
      x.fillText(String(job.name).slice(0, 34), x0 + lw - 20, y0 + 126);
      col++; if (col >= cols) { col = 0; row++; }
    }
    d.y = E.PH;
  }
  function csvOut() {
    const e = v => /[",;\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
    const rows = [['No', 'Part', 'Length_mm', 'Width_mm', 'Qty', 'Board', 'Thickness_mm', 'Grain', 'Edge_L1', 'Edge_L2', 'Edge_W1', 'Edge_W2', 'Note']];
    for (const p of job.parts) rows.push([numOf(p.id), p.name, p.L, p.W, p.qty, stockOf(p.stock).name, stockOf(p.stock).th, p.grain === 'L' ? 'length' : p.grain === 'W' ? 'width' : 'none', ...p.e, p.note]);
    rows.push([]); rows.push(['Sheet', 'Board', 'Part_No', 'X_mm', 'Y_mm', 'Along_length_mm', 'Across_mm', 'Turned']);
    pl.sheets.forEach((s, i) => s.parts.forEach(pq => { const p = partOf(pq.pid); if (!p) return; const d = C.dims(p, pq.rot); rows.push([i + 1, stockOf(s.stock).name, numOf(p.id), pq.x, pq.y, d.w, d.h, pq.rot ? 'yes' : 'no']); }));
    E.saveFile(`${T('مخطط التقطيع')} ${job.name}.csv`, new Blob(['﻿' + rows.map(r => r.map(e).join(',')).join('\r\n')], {type: 'text/csv'}));
  }

  /* ---------- entry points ---------- */
  window.WarshaCutUI = {open: j => open(j || newJob()), openLast, fromDesign: () => open(jobFromDesign()), get job() { return job; }, get plan() { return pl; }, render};
  document.addEventListener('click', e => {
    if (e.target.closest('[data-cutplan]')) { tab = 'plan'; const j = jobFromDesign(); if (j.parts.length) open(j); else { tab = 'parts'; openLast(); } }
    if (e.target.closest('[data-cutjobs]')) { const cs = q('#clientsSheet'); if (cs) cs.hidden = true; tab = 'parts'; openLast(); jobsSheet(); }
  });
})();
