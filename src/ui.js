// 《租赁大亨》界面层：渲染状态、收集人类决策、按节奏驱动 AI。
(function () {
  const { engine: E, ai: AI, data: D } = window.LT;
  const { TYPES, AIRLINES, GROUPS, BOARD, OEMS, ENGINES, RATINGS, CYCLES } = D;

  const $ = (s, r = document) => r.querySelector(s);
  const esc = (x) => String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const m = (x, d = 1) => (x < -0.049 ? '−' : '') + '$' + Math.abs(x).toFixed(d) + 'm';
  const pct = (x, d = 1) => (x * 100).toFixed(d) + '%';
  const SAVE_KEY = 'lessor-tycoon-v1';
  const PREF_KEY = 'lessor-tycoon-prefs';
  const SPEEDS = { slow: 900, mid: 420, fast: 140, instant: 0 };
  const SRC_LABEL = { spot: '现货采购', slb: 'SLB 售后回租', slot: '自有交付位', idle: '闲置飞机' };
  const FIN_ORDER = ['bank', 'unsecured', 'eca', 'cash'];

  let S = null;
  const ui = { deal: null, dealKey: null, tab: 'fleet', speed: 'mid', timer: null, lastEvents: 0, lastRoll: null, confirm: null, buyRatio: 1.1, logMine: false, lastStamp: '' };

  // ---------- 存取 ----------
  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(S));
    } catch (e) {}
  }
  function loadSave() {
    try {
      const x = localStorage.getItem(SAVE_KEY);
      return x ? JSON.parse(x) : null;
    } catch (e) {
      return null;
    }
  }
  function savePrefs() {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({ speed: ui.speed, tab: ui.tab }));
    } catch (e) {}
  }
  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
      if (p.speed && SPEEDS[p.speed] != null) ui.speed = p.speed;
      if (p.tab) ui.tab = p.tab;
    } catch (e) {}
  }

  const H = () => S.players.findIndex((p) => p.human);
  function spaceName(i) {
    const sp = BOARD[i];
    if (sp.t === 'airline') return AIRLINES[sp.id].name;
    if (sp.t === 'oem') return OEMS[sp.id].name;
    if (sp.t === 'engine') return ENGINES[sp.id].name;
    return sp.name;
  }
  const pColor = (i) => `var(--p${i % 4})`;
  const pName = (i) => esc(S.players[i].name);
  const ratingLabel = (id) => {
    const A = S.airlines[id];
    if (A.sanctioned) return ['X', 'rD'];
    if (A.defaultUntil != null) return ['D', 'rD'];
    return [RATINGS[A.rating], 'r' + A.rating];
  };

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(ui.toastT);
    ui.toastT = setTimeout(() => (t.hidden = true), 3200);
  }

  // ---------- 行动 ----------
  function doAct(choice) {
    const backup = JSON.stringify(S);
    try {
      E.act(S, choice);
    } catch (e) {
      S = JSON.parse(backup);
      toast(e.message);
      console.error(e);
    }
    ui.confirm = null;
    save();
    render();
    pump();
  }
  function pump() {
    clearTimeout(ui.timer);
    if (!S || S.over || !S.pending) return;
    if (S.players[S.pending.p].human) return;
    const delay = SPEEDS[ui.speed];
    ui.timer = setTimeout(() => {
      let n = 0;
      // 瞬间模式下一口气跑到轮到人类为止
      do {
        const pd = S.pending;
        E.act(S, AI.decide(S, pd));
        n++;
      } while (delay === 0 && !S.over && S.pending && !S.players[S.pending.p].human && n < 400);
      save();
      render();
      pump();
    }, delay);
  }

  // ---------- 棋盘 ----------
  function gridPos(i) {
    if (i <= 11) return [12, 12 - i];
    if (i <= 22) return [12 - (i - 11), 1];
    if (i <= 33) return [1, 1 + (i - 22)];
    return [1 + (i - 33), 12];
  }
  function buildBoard() {
    const b = $('#board');
    b.innerHTML = '';
    BOARD.forEach((sp, i) => {
      const c = document.createElement('div');
      c.id = 'c' + i;
      const [r, col] = gridPos(i);
      c.style.gridArea = `${r} / ${col}`;
      b.appendChild(c);
    });
    const center = document.createElement('div');
    center.className = 'center';
    center.id = 'center';
    b.appendChild(center);
  }
  function cellHTML(i) {
    const sp = BOARD[i];
    let cls = 'cell';
    let style = '';
    let html = '';
    let title = '';
    if (sp.t === 'airline') {
      const A = S.airlines[sp.id];
      const AD = AIRLINES[sp.id];
      const [rt, rc] = ratingLabel(sp.id);
      let own = '';
      if (A.lessor != null) {
        const n = E.airlineFleet(S, A.lessor, sp.id).length;
        cls += ' owned';
        style = `--owner:${pColor(A.lessor)}`;
        own = `×${n}${A.framework ? '★' : ''}`;
      }
      if (!E.airlineOpen(S, sp.id)) cls += ' dim';
      html = `<i class="strip" style="background:var(--g-${AD.g})"></i><b class="code">${sp.id}</b><span class="nm">${esc(AD.name)}</span><span class="meta"><span class="rt ${rc}">${rt}</span><span class="own">${own}</span></span>`;
      title = `${AD.name} ${AD.cn} · ${GROUPS[AD.g].name} · 评级 ${rt}${A.lessor != null ? ' · 主力出租人 ' + S.players[A.lessor].name : ' · 开放'}`;
    } else if (sp.t === 'oem') {
      const o = S.oems[sp.id];
      cls += ' special';
      if (o.owner != null) {
        cls += ' owned';
        style = `--owner:${pColor(o.owner)}`;
      }
      html = `<b class="code">${esc(OEMS[sp.id].name)}</b><span class="nm">${o.owner != null ? '交付位 ' + o.slots : '大订单 ' + m(OEMS[sp.id].price, 1)}</span>`;
      title = `${OEMS[sp.id].name} ${OEMS[sp.id].cn} 交付位订单`;
    } else if (sp.t === 'engine') {
      const e = S.engines[sp.id];
      cls += ' special';
      if (e.owner != null) {
        cls += ' owned';
        style = `--owner:${pColor(e.owner)}`;
      }
      html = `<b class="code">${sp.id === 'cfm' ? 'CFM' : 'P&amp;W'}</b><span class="nm">备发平台</span>`;
      title = ENGINES[sp.id].name + ' 备发租赁平台';
    } else if (sp.t === 'ch' || sp.t === 'cc') {
      cls += ' special';
      html = `<b class="code">${sp.t === 'ch' ? '快讯' : '内部'}</b><span class="nm">${sp.name}</span>`;
      title = sp.name;
    } else if (sp.t === 'tax') {
      cls += ' special';
      html = `<b class="code">${sp.id === 'wht' ? 'WHT' : 'INS'}</b><span class="nm">${sp.name}</span>`;
      title = sp.name;
    } else if (sp.t === 'market') {
      cls += ' special';
      html = `<b class="code">二手</b><span class="nm">交易平台</span>`;
      title = '二手飞机交易平台：买卖飞机';
    } else {
      cls += ' corner';
      const code = { go: 'DUB', jail: '审查', airshow: '航展', gotojail: 'KYC' }[sp.t];
      html = `<b class="code">${code}</b><span class="nm">${sp.name}<br>${sp.sub || ''}</span>`;
      title = `${sp.name} · ${sp.sub || ''}`;
    }
    const here = S.players.filter((p) => !p.bankrupt && p.pos === i);
    if (here.length) html += `<span class="tokens">${here.map((p) => `<i class="tok${p.human ? ' me' : ''}" style="--c:${pColor(p.id)}" title="${esc(p.name)}"></i>`).join('')}</span>`;
    if (S.pending && S.players[S.turn.p] && S.players[S.turn.p].pos === i) cls += ' here';
    return { cls, style, html, title };
  }
  function renderBoard() {
    BOARD.forEach((sp, i) => {
      const c = document.getElementById('c' + i);
      const x = cellHTML(i);
      c.className = x.cls;
      c.setAttribute('style', `${c.style.gridArea ? 'grid-area:' + c.style.gridArea + ';' : ''}${x.style}`);
      c.title = x.title;
      c.innerHTML = x.html;
    });
    renderCenter();
  }
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  const dieHTML = (n, rolling) => `<div class="die${rolling ? ' rolling' : ''}" aria-label="${n || ''}">${Array.from({ length: 9 }, (_, k) => `<i class="${n && PIPS[n].includes(k) ? 'on' : ''}"></i>`).join('')}</div>`;
  function renderCenter() {
    const c = $('#center');
    const mk = S.market;
    const cur = S.players[S.turn.p];
    const roll = S.turn.roll || [0, 0];
    const rolling = S.turn.roll && ui.lastRoll !== JSON.stringify(S.turn.roll) + S.q + S.turn.p;
    ui.lastRoll = JSON.stringify(S.turn.roll) + S.q + S.turn.p;
    const ev = S.events[S.events.length - 1];
    const fresh = S.events.length > ui.lastEvents;
    ui.lastEvents = S.events.length;
    const recent = S.log
      .filter((l) => l.kind !== 'roll' && l.kind !== 'sys')
      .slice(-5)
      .reverse()
      .map((l) => `<div>${esc(l.text)}</div>`)
      .join('');
    const qn = Math.min(S.q + 1, S.maxQ);
    c.innerHTML = `
      <div class="brand"><h1>租赁大亨</h1><span class="en">LESSOR TYCOON</span></div>
      <div class="instruments">
        <div class="inst"><div class="eyebrow">季度</div><div class="v">${E.qLabel(S, Math.min(S.q, S.maxQ - 1))}</div></div>
        <div class="inst"><div class="eyebrow">进度</div><div class="v">${qn}/${S.maxQ}</div></div>
        <div class="inst"><div class="eyebrow">SOFR</div><div class="v">${pct(mk.sofr, 2)}</div></div>
        <div class="inst"><div class="eyebrow">周期</div><div class="v" style="color:${['var(--good)', 'var(--ink)', 'var(--warn)', 'var(--bad)'][mk.cycle]}">${CYCLES[mk.cycle].name}</div></div>
      </div>
      <div class="stage">
        <div>
          <div class="dice">${dieHTML(roll[0], rolling)}${dieHTML(roll[1], rolling)}</div>
          <div class="turn-who">${S.over ? '<b>游戏结束</b>' : `<b style="color:${pColor(cur.id)}">${esc(cur.name)}</b><br>${cur.human ? '轮到你' : '行动中'}`}</div>
        </div>
        <div style="min-height:0;display:grid;gap:8px;align-content:start">
          ${
            ev
              ? `<div class="card${fresh ? ' fresh' : ''}"><div class="deck">${ev.deck === 'ch' ? '市场快讯 · MARKET NEWS' : '公司内部 · INTERNAL'} · ${esc(S.players[ev.p].name)} · ${E.qLabel(S, ev.q)}</div><h3>${esc(ev.title)}</h3><p>${esc(ev.text)}</p></div>`
              : `<div class="card"><div class="deck">航线图 · ROUTE MAP</div><h3>在全球 25 家航司之间出租飞机</h3><p>落在未被锁定的航司上可以报价签约；集齐一个区域成为区域主力出租人。10 年后比公司净资产（NAV）。</p></div>`
          }
          <div class="recent">${recent}</div>
        </div>
      </div>
      <div class="legend">
        <div>${Object.keys(GROUPS).map((g) => `<span><i style="background:var(--g-${g})"></i>${GROUPS[g].name}</span>`).join('')}</div>
        <div>${S.players.map((p) => `<span><i class="round" style="background:${pColor(p.id)}"></i>${esc(p.name)}</span>`).join('')}<span>×n 在租架数 · ★ 框架协议</span></div>
      </div>`;
  }

  // ---------- 我的公司 ----------
  function spark(values) {
    if (values.length < 2) return '';
    const w = 300,
      h = 40;
    const min = Math.min(...values),
      max = Math.max(...values);
    const span = max - min || 1;
    const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 4 - ((v - min) / span) * (h - 8)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const last = pts[pts.length - 1];
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-label="NAV 走势"><path d="${d} L${w} ${h} L0 ${h} Z" fill="var(--accent)" opacity="0.1"/><path d="${d}" fill="none" stroke="var(--accent)" stroke-width="1.5" vector-effect="non-scaling-stroke"/><circle cx="${last[0]}" cy="${last[1]}" r="2.5" fill="var(--accent)"/></svg>`;
  }
  function renderMe() {
    const h = H();
    const pl = S.players[h];
    const navv = E.nav(S, h);
    const lev = E.leverage(S, h);
    const own = E.ownedAircraft(S, h);
    const leased = own.filter((a) => a.lease);
    const rentQ = leased.reduce((t, a) => t + a.lease.rentQ, 0);
    const hist = [150, ...S.reports.map((r) => (r.players[h] ? r.players[h].nav : null)).filter((x) => x != null)];
    if (!S.over) hist.push(navv);
    const ig = E.isIG(S, h);
    $('#me').innerHTML = `
      <div class="panel-h"><h2>${esc(pl.name)} · 你的公司</h2><span class="eyebrow" style="color:${ig ? 'var(--good)' : 'var(--ink-3)'}">${ig ? '投资级' : '高收益级'}</span></div>
      <div class="panel-b me-grid">
        <div class="kv big"><span class="eyebrow">NAV</span><span class="v ${navv >= 150 ? 'good' : 'bad'}">${m(navv)}</span></div>
        <div class="kv big"><span class="eyebrow">现金</span><span class="v ${pl.cash < 10 ? 'warn' : ''}">${m(pl.cash)}</span></div>
        <div class="kv big"><span class="eyebrow">杠杆</span><span class="v ${lev > 0.85 ? 'bad' : lev > 0.75 ? 'warn' : ''}">${pct(lev, 0)}</span></div>
        <div class="kv"><span class="eyebrow">机队</span><span class="v">${leased.length}<small> 在租</small> ${own.length - leased.length}<small> 闲置</small></span></div>
        <div class="kv"><span class="eyebrow">季度租金</span><span class="v">${m(rentQ)}</span></div>
        <div class="kv"><span class="eyebrow">RCF 已用</span><span class="v">${m(pl.rcf, 0)}<small> / ${pl.rcfLimit}</small></span></div>
        ${spark(hist)}
        ${pl.passCard ? '<div class="kv"><span class="eyebrow">持有</span><span class="v" style="font-size:13px">合规通行证</span></div>' : ''}
        ${pl.referral ? '<div class="kv"><span class="eyebrow">加成</span><span class="v" style="font-size:13px">下次签约 +15%</span></div>' : ''}
        ${pl.stranded.length ? `<div class="kv"><span class="eyebrow">搁浅债务</span><span class="v bad">${m(pl.stranded.reduce((t, d) => t + d.principal, 0))}</span></div>` : ''}
        ${pl.receivables.length ? `<div class="kv"><span class="eyebrow">应收保险</span><span class="v good">${m(pl.receivables.reduce((t, d) => t + d.amount, 0))}</span></div>` : ''}
      </div>`;
  }

  function renderPlayers() {
    const list = S.players.map((p) => ({ p, nav: p.bankrupt ? -Infinity : E.nav(S, p.id) })).sort((a, b) => b.nav - a.nav);
    $('#players').innerHTML = list
      .map(({ p, nav }) => {
        const own = E.ownedAircraft(S, p.id).length;
        return `<div class="pl${p.id === S.turn.p && !S.over ? ' cur' : ''}${p.bankrupt ? ' dead' : ''}" style="--c:${pColor(p.id)}">
          <i class="dot"></i><span class="n">${esc(p.name)} ${p.human ? '<small>你</small>' : `<small>${esc(p.cn)}</small>`}</span><span class="navv">${p.bankrupt ? '破产' : nav.toFixed(1)}</span>
          <span class="d"><span>现金 ${p.cash.toFixed(1)}</span><span>机队 ${own}</span><span>杠杆 ${pct(E.leverage(S, p.id), 0)}</span><span>${esc(spaceName(p.pos))}</span></span>
        </div>`;
      })
      .join('');
  }

  function renderLog() {
    const h = H();
    const items = S.log.filter((l) => !ui.logMine || l.p === h).slice(-90).reverse();
    $('#log').innerHTML = items
      .map((l) => {
        const who = l.p != null ? `<span class="who" style="--c:${pColor(l.p)}">●</span> ` : '';
        return `<div class="k-${l.kind}${l.p === h ? ' mine' : ''}">${who}${esc(l.text)}</div>`;
      })
      .join('');
  }

  // ---------- 决策面板 ----------
  function airlineHead(id) {
    const AD = AIRLINES[id];
    const A = S.airlines[id];
    const [rt] = ratingLabel(id);
    const h = H();
    const mine = E.airlineFleet(S, h, id).length;
    return `<div class="airline-head" style="--gc:var(--g-${AD.g})"><span class="badge">${id}</span>
      <div><div class="t">${esc(AD.name)}</div><div class="s">${AD.cn} · ${GROUPS[AD.g].name} · 你的机队 ${mine}/${AD.cap}${A.framework ? ' · 框架协议' : ''}</div></div>
      <span class="rt r${A.rating}" style="font:700 16px var(--f-mono);padding:4px 7px">${rt}</span></div>`;
  }

  function dealDefaults(pd) {
    const h = H();
    const opts = E.signOptions(S, h, pd.airline);
    const t = opts.types[0];
    return { type: t.typeId, engine: t.engines[0], source: opts.idle.length ? 'idle' : 'spot', aircraftId: opts.idle[0] || null, term: t.terms[1], ratio: 1, finance: 'bank', ltv: 0.75 };
  }
  function normalizeDeal(pd) {
    const h = H();
    const d = ui.deal;
    const opts = E.signOptions(S, h, pd.airline);
    if (d.source === 'idle') {
      if (!opts.idle.includes(d.aircraftId)) d.aircraftId = opts.idle[0] || null;
      if (!d.aircraftId) d.source = 'spot';
    }
    const t = opts.types.find((x) => x.typeId === d.type) || opts.types[0];
    d.type = t.typeId;
    if (d.source !== 'idle' && !t.sources.includes(d.source)) d.source = 'spot';
    if (!t.engines.includes(d.engine)) d.engine = t.engines[0];
    let age = TYPES[d.type].age0;
    if (d.source === 'idle' && d.aircraftId) age = E.ageNow(S, S.aircraft[d.aircraftId]);
    const terms = age < 3 ? [6, 8, 10, 12] : [3, 5, 7];
    if (!terms.includes(d.term)) d.term = terms[1];
    if (pd.retry) d.ratio = Math.min(d.ratio, pd.maxRatio);
    const f = E.financeTerms(S, h, d.finance, age < 1, d.type);
    if (!f.ok) d.finance = 'bank';
    const f2 = E.financeTerms(S, h, d.finance, age < 1, d.type);
    if (d.ltv > f2.maxLtv) d.ltv = f2.maxLtv;
    return { opts, terms, age };
  }

  function quoteHTML(q) {
    if (!q.ok) return `<div class="note bad">${esc(q.why)}</div>`;
    const rows = [
      ['飞机价值', m(q.value)],
      ['购机价格', q.source === 'idle' ? '已持有' : m(q.price)],
      ['市场 LRF', pct(q.marketLrf, 3)],
      ['你的 LRF', pct(q.lrf, 3)],
      ['月租金', m(q.rentM, 2)],
      ['季度租金', m(q.rentQ, 2)],
      ['保证金（2 个月）', m(q.deposit, 2)],
      ['MR / 季', m(q.mrQ, 2)],
      ['贷款', q.source === 'idle' ? '沿用' : m(q.loan)],
      ['全包利率', pct(q.allIn, 2)],
      ['季度利息', m(q.interestQ, 2)],
      ['季度折旧', m(q.depQ, 2)],
      ['季度净收益', m(q.netQ, 2)],
      ['租金收益率', pct(q.yieldA, 1)],
      ['股本 ROE（年化）', pct(q.roe, 1)],
      ['本次现金流出', m(q.outflow)],
    ];
    return `<div class="quote">${rows.map(([a, b]) => `<div><span>${a}</span><span>${b}</span></div>`).join('')}</div>
      ${!q.affordable ? `<div class="note bad">${esc(q.why)}</div>` : ''}`;
  }

  function renderDeal(pd) {
    const h = H();
    const key = pd.airline + '|' + pd.signed + '|' + S.q;
    if (ui.dealKey !== key || !ui.deal) {
      ui.deal = dealDefaults(pd);
      ui.dealKey = key;
    }
    const { opts, terms, age } = normalizeDeal(pd);
    const d = ui.deal;
    const canSign = E.canSignAt(S, h, pd.airline);
    const A = S.airlines[pd.airline];
    const canFw = A.lessor === h && !A.framework && E.airlineFleet(S, h, pd.airline).length >= 3;
    const q = canSign ? E.quote(S, h, { ...d, airline: pd.airline }) : { ok: false, why: '已达该航司机队上限' };
    const t = opts.types.find((x) => x.typeId === d.type);
    const srcs = ['spot', 'slb', 'slot', 'idle'];
    const chip = (attr, val, label, on, disabled, tip) => `<button type="button" class="chip" data-deal="${attr}" data-val="${esc(val)}" aria-pressed="${on}" ${disabled ? 'disabled' : ''} ${tip ? `title="${esc(tip)}"` : ''}>${label}</button>`;
    let body = '';
    if (canSign) {
      const srcChips = srcs
        .map((sId) => {
          let ok = sId === 'idle' ? opts.idle.length > 0 : t.sources.includes(sId);
          let label = SRC_LABEL[sId];
          if (sId === 'slot') {
            const o = S.oems[TYPES[d.type].oem];
            label += o && o.owner === h ? ` <small>${o.slots}</small>` : '';
          }
          if (sId === 'idle') label += ` <small>${opts.idle.length}</small>`;
          return chip('source', sId, label, d.source === sId, !ok, sId === 'slot' ? '需先在主机厂格购买交付位；新机价格 −12%' : sId === 'slb' ? '从航司买入新机再租回：价格 = 市值，LRF −4%，成交概率 +12%' : sId === 'idle' ? '把闲置飞机租给这家航司，交接成本 1%' : '按市值 +2% 采购')
        })
        .join('');
      const typeBlock =
        d.source === 'idle'
          ? `<div class="field"><span class="eyebrow">闲置飞机</span><div class="chips">${opts.idle
              .map((id) => {
                const a = S.aircraft[id];
                return chip('aircraftId', id, `${TYPES[a.type].name} <small>MSN ${a.msn} · ${E.ageNow(S, a).toFixed(1)}年</small>`, d.aircraftId === id, false);
              })
              .join('')}</div></div>`
          : `<div class="field"><span class="eyebrow">机型</span><div class="chips">${opts.types
              .map((x) => {
                const T = TYPES[x.typeId];
                const v = E.typeValue(S, x.typeId, T.age0, x.engines[0]);
                return chip('type', x.typeId, `${T.name} <small>${m(v, 0)}${T.age0 ? ' · ' + T.age0 + '年' : ''}</small>`, d.type === x.typeId, false);
              })
              .join('')}</div></div>
            ${t.engines.length > 1 ? `<div class="field"><span class="eyebrow">发动机</span><div class="chips">${t.engines.map((e) => chip('engine', e, `${e}${D.GTF.includes(e) ? ' <small>GTF</small>' : ''}`, d.engine === e, false, D.GTF.includes(e) ? 'GTF：价值略低（−2%），有召回事件风险' : '')).join('')}</div></div>` : ''}`;
      const finChips =
        d.source === 'idle'
          ? '<span class="note">闲置飞机沿用原有融资</span>'
          : FIN_ORDER.map((k) => {
              const f = E.financeTerms(S, h, k, age < 1, d.type);
              return chip('finance', k, `${f.label}${k !== 'cash' ? ` <small>+${(f.spread * 10000).toFixed(0)}bp</small>` : ''}`, d.finance === k, !f.ok, f.ok ? `最高 LTV ${pct(f.maxLtv, 0)}，季度摊还 ${pct(f.amort, 1)}，前端费 ${pct(f.fee, 2)}` : f.why);
            }).join('');
      const fin = E.financeTerms(S, h, d.finance, age < 1, d.type);
      const maxR = pd.retry ? pd.maxRatio : 1.12;
      body = `
        ${pd.retry ? `<div class="note bad">${esc(AIRLINES[pd.airline].name)} 拒绝了上次报价。可以降低 LRF 再报一次（报价系数不高于 ${pd.maxRatio.toFixed(2)}）。</div>` : ''}
        ${pd.signed ? `<div class="note good">本次拜访已签 ${pd.signed} 架，还可再签 ${pd.limit - pd.signed} 架。</div>` : ''}
        <div class="field"><span class="eyebrow">飞机来源</span><div class="chips">${srcChips}</div></div>
        ${typeBlock}
        <div class="field"><span class="eyebrow">租期</span><div class="chips">${terms.map((y) => chip('term', y, `${y} 年`, d.term === y, false)).join('')}</div></div>
        <div class="field"><label for="ratio">LRF 报价（相对市场）</label>
          <div class="slider-row"><input type="range" id="ratio" min="0.88" max="${maxR.toFixed(3)}" step="0.005" value="${d.ratio}"><output id="ratio-out">${d.ratio >= 1 ? '+' : ''}${((d.ratio - 1) * 100).toFixed(1)}%</output></div></div>
        <div class="field"><span class="eyebrow">融资</span><div class="chips">${finChips}</div></div>
        ${d.source !== 'idle' && d.finance !== 'cash' ? `<div class="field"><label for="ltv">贷款价值比 LTV</label><div class="slider-row"><input type="range" id="ltv" min="0" max="${fin.maxLtv}" step="0.05" value="${d.ltv}"><output id="ltv-out">${pct(d.ltv, 0)}</output></div></div>` : ''}
        <div class="gauge"><span class="eyebrow">成交概率</span><span class="bar"><i id="acc-bar" style="width:${q.ok ? q.acceptP * 100 : 0}%"></i></span><b id="acc">${q.ok ? pct(q.acceptP, 0) : '—'}</b></div>
        <div id="quote">${quoteHTML(q)}</div>`;
    } else {
      body = `<div class="note">你在 ${esc(AIRLINES[pd.airline].name)} 的机队已达上限（${AIRLINES[pd.airline].cap} 架）。</div>`;
    }
    const fwBtn = canFw ? `<button type="button" class="btn" data-act="framework">签长期框架协议 ${m(E.frameworkCost(S, h, pd.airline))}</button>` : '';
    return `${airlineHead(pd.airline)}
      <div class="stack">${body}
      <div class="row">${canSign ? `<button type="button" class="btn primary" data-act="sign" ${q.ok && q.affordable ? '' : 'disabled'}>提交报价</button>` : ''}${fwBtn}<button type="button" class="btn ghost" data-act="pass">${pd.signed ? '完成拜访' : '放弃'}</button></div>
      ${canFw ? '<div class="note">框架协议：对手落在此格的竞标成本 ×1.5，到期续租概率 +30%，追加飞机成交概率 +10%。</div>' : ''}
      </div>`;
  }

  function updateQuoteOnly(pd) {
    const h = H();
    const q = E.quote(S, h, { ...ui.deal, airline: pd.airline });
    $('#quote').innerHTML = quoteHTML(q);
    $('#acc').textContent = q.ok ? pct(q.acceptP, 0) : '—';
    $('#acc-bar').style.width = (q.ok ? q.acceptP * 100 : 0) + '%';
    const btn = $('[data-act="sign"]');
    if (btn) btn.disabled = !(q.ok && q.affordable);
    const ro = $('#ratio-out');
    if (ro) ro.textContent = `${ui.deal.ratio >= 1 ? '+' : ''}${((ui.deal.ratio - 1) * 100).toFixed(1)}%`;
    const lo = $('#ltv-out');
    if (lo) lo.textContent = pct(ui.deal.ltv, 0);
  }

  function renderRival(pd) {
    const h = H();
    const seller = S.airlines[pd.airline].lessor;
    if (seller == null) return `${airlineHead(pd.airline)}<div class="row"><button type="button" class="btn" data-act="pass">离开</button></div>`;
    const fleet = E.airlineFleet(S, seller, pd.airline);
    const fair = E.positionValue(S, seller, pd.airline);
    const price = Math.max(0.5, fair * ui.buyRatio);
    const afford = S.players[h].cash + E.rcfAvail(S, h) >= price;
    return `${airlineHead(pd.airline)}
      <div class="stack">
        <div class="note">${pName(seller)} 是这家航司的主力出租人，你已支付竞标失败成本。可以尝试收购对方在此的全部租约组合（贷款一并承接）。</div>
        <div class="list">${fleet
          .map(
            (a) => `<div class="list-item"><div><b>${TYPES[a.type].name}</b> <span class="mono">MSN ${a.msn}</span><div class="sub">剩余 ${((a.lease.endQ - S.q) / 4).toFixed(1)} 年 · 月租 ${m(a.lease.rentQ / 3, 2)} · 市值 ${m(E.mv(S, a))} · 贷款 ${m(a.loan ? a.loan.principal : 0)}</div></div></div>`
          )
          .join('')}</div>
        <div class="quote"><div><span>股权估值参考</span><span>${m(fair)}</span></div><div><span>你的报价</span><span id="buy-price">${m(price)}</span></div></div>
        <div class="field"><label for="buy">报价（相对估值）</label><div class="slider-row"><input type="range" id="buy" min="0.8" max="1.6" step="0.01" value="${ui.buyRatio}"><output id="buy-out">${pct(ui.buyRatio, 0)}</output></div></div>
        <div class="note">AI 通常要求高于估值 5–15% 才会出售。</div>
        <div class="row"><button type="button" class="btn primary" data-act="buyout" ${afford ? '' : 'disabled'}>发出收购报价</button><button type="button" class="btn ghost" data-act="pass">离开</button></div>
      </div>`;
  }

  function sellList(pd, atMarket) {
    const h = H();
    const own = E.ownedAircraft(S, h);
    if (!own.length) return '<div class="empty">没有可出售的飞机</div>';
    return `<div class="list">${own
      .map((a) => {
        const pr = E.saleProceeds(S, a, atMarket);
        const lessee = a.lease ? AIRLINES[a.lease.airline].name : '闲置';
        const armed = ui.confirm === a.id;
        return `<div class="list-item"><div><b>${TYPES[a.type].name}</b> <span class="mono">MSN ${a.msn}</span><div class="sub">${esc(lessee)} · 售价 ${m(pr.price)} · 贷款 ${m(pr.loan)}${pr.liab ? ' · 保证金+MR ' + m(pr.liab) : ''}</div></div>
          <button type="button" class="btn small${armed ? ' primary' : ''}" data-sell="${a.id}">${armed ? '确认 ' : '出售 '}<span class="mono">${m(pr.net)}</span></button></div>`;
      })
      .join('')}</div>`;
  }

  function renderDecision() {
    const box = $('#decision');
    const pd = S.pending;
    const h = H();
    if (S.over) {
      box.className = 'panel decision';
      box.innerHTML = `<div class="panel-h"><h2>游戏结束</h2></div><div class="panel-b stack"><p class="dec-title">冠军：${pName(S.winner)}</p><div class="row"><button type="button" class="btn primary" data-act="results">查看结算</button><button type="button" class="btn" data-act="newgame">再来一局</button></div></div>`;
      return;
    }
    if (!pd) {
      box.innerHTML = '';
      return;
    }
    const mine = pd.p === h;
    box.className = 'panel decision' + (mine ? ' mine' : '');
    if (!mine) {
      const who = S.players[pd.p];
      const what = { turn: '准备掷骰', airline: '在航司洽谈', oem: '考虑主机厂订单', engine: '考虑备发平台', market: '在二手平台交易', airshow: '在航展上', shortfall: '处理资金缺口', jail: '在合规审查中' }[pd.type] || '决策中';
      box.innerHTML = `<div class="panel-h"><h2>对手回合</h2><span class="eyebrow">${E.qLabel(S)}</span></div><div class="panel-b"><div class="waiting" style="--c:${pColor(pd.p)}"><i class="pulse"></i><span><b>${esc(who.name)}</b> ${what}…</span></div></div>`;
      return;
    }
    const pl = S.players[h];
    let title = '';
    let inner = '';
    switch (pd.type) {
      case 'turn': {
        const remotes = Object.keys(AIRLINES).filter((id) => E.dominates(S, h, AIRLINES[id].g) && E.canSignAt(S, h, id));
        title = pd.again ? '掷出双数，再掷一次' : '你的回合';
        inner = `<p class="dec-sub">当前位置：${esc(spaceName(pl.pos))}。掷骰前可以先做资产管理。</p>
          <div class="stack">
            <div class="row"><button type="button" class="btn primary big" data-act="roll">掷骰子</button>
            ${pl.rcf > 0 && pl.cash > 0 ? `<button type="button" class="btn" data-act="repay">偿还 RCF ${m(Math.min(pl.rcf, pl.cash))}</button>` : ''}</div>
            ${remotes.length && !S.turn.remoteUsed ? `<div class="field"><span class="eyebrow">区域主力出租人 · 远程加机（每回合一次）</span><div class="chips">${remotes.map((id) => `<button type="button" class="chip" data-remote="${id}">${id} ${esc(AIRLINES[id].name)}</button>`).join('')}</div></div>` : ''}
            <div class="note">需要现金时，可以在下方「我的机队」里出售飞机（在交易平台外出售折价 4%）。</div>
          </div>`;
        break;
      }
      case 'jail':
        title = '合规审查中';
        inner = `<p class="dec-sub">第 ${pd.tries} 次尝试。掷出双数即可离开，满三次必须缴费。</p>
          <div class="row"><button type="button" class="btn primary" data-act="jail-roll">掷骰（求双数）</button><button type="button" class="btn" data-act="jail-pay">支付 $1.0m 离开</button>${pl.passCard ? '<button type="button" class="btn" data-act="jail-card">使用合规通行证</button>' : ''}</div>`;
        break;
      case 'airline':
        title = pd.mode === 'rival' ? '对手的客户' : pd.airshow ? '航展洽谈' : pd.remote ? '远程加机' : pd.mode === 'own' ? '追加飞机' : '新客户拜访';
        inner = pd.mode === 'rival' ? renderRival(pd) : renderDeal(pd);
        break;
      case 'offer': {
        const b = S.players[pd.buyer];
        title = '收到收购报价';
        inner = `${airlineHead(pd.airline)}<p class="dec-sub"><b>${esc(b.name)}</b> 想以 <b class="mono">${m(pd.price)}</b> 收购你在 ${esc(AIRLINES[pd.airline].name)} 的全部租约组合（贷款一并转让）。你的股权估值约 <span class="mono">${m(pd.fair)}</span>（溢价 ${pct(pd.price / Math.max(0.01, pd.fair) - 1, 0)}）。</p>
          <div class="row"><button type="button" class="btn primary" data-act="accept">接受</button><button type="button" class="btn" data-act="reject">拒绝</button></div>`;
        break;
      }
      case 'oem': {
        const O = OEMS[pd.oem];
        title = `${O.name} ${O.cn}`;
        inner =
          pd.mode === 'buy'
            ? `<p class="dec-sub">下达大订单：${O.slots} 个交付位，预付 ${m(O.price)}。用交付位购买 ${O.name} 新机价格 −12%；每年补充 1 个交付位。对手落在这里要向你支付交付位转让溢价（持有 1/2/3/4 家主机厂订单：$1m/$2m/$4m/$8m）。</p>
             <div class="row"><button type="button" class="btn primary" data-act="oem-buy" ${pl.cash + E.rcfAvail(S, h) >= O.price ? '' : 'disabled'}>下单 ${m(O.price)}</button><button type="button" class="btn ghost" data-act="pass">不下单</button></div>`
            : `<p class="dec-sub">你持有 ${S.oems[pd.oem].slots} 个交付位。可以追加，每个 ${m(pd.price)}。</p>
             <div class="row"><button type="button" class="btn primary" data-act="oem-top1">追加 1 个</button><button type="button" class="btn" data-act="oem-top2">追加 2 个</button><button type="button" class="btn ghost" data-act="pass">不追加</button></div>`;
        break;
      }
      case 'engine': {
        const G = ENGINES[pd.engine];
        title = G.name;
        inner = `<p class="dec-sub">收购备发租赁平台 ${m(G.price)}：每季度稳定收入 ${m(G.income)}。对手落在这里按骰子点数付费（持有一家 ×$0.25m，两家 ×$0.6m）。</p>
          <div class="row"><button type="button" class="btn primary" data-act="engine-buy" ${pl.cash + E.rcfAvail(S, h) >= G.price ? '' : 'disabled'}>收购 ${m(G.price)}</button><button type="button" class="btn ghost" data-act="pass">不收购</button></div>`;
        break;
      }
      case 'market': {
        title = '二手飞机交易平台';
        const used = ['B738', 'A20C', 'B77W'];
        inner = `<p class="dec-sub">在平台出售不打折（带租约的飞机按承租人信用定价）。也可以买入二手飞机作为闲置库存，之后落在合适的航司时再租出。</p>
          <div class="field"><span class="eyebrow">出售</span>${sellList(pd, true)}</div>
          <div class="field"><span class="eyebrow">买入闲置二手机（60% 银行融资）</span><div class="list">${used
            .map((t) => {
              const T = TYPES[t];
              const price = E.typeValue(S, t, T.age0, T.engines[0]) * 1.02;
              return `<div class="list-item"><div><b>${T.name}</b><div class="sub">${T.age0} 年机龄 · 价格 ${m(price)} · 股本 ${m(price * 0.4)}</div></div><button type="button" class="btn small" data-buyused="${t}" ${pl.cash + E.rcfAvail(S, h) >= price * 0.4 ? '' : 'disabled'}>买入</button></div>`;
            })
            .join('')}</div></div>
          <div class="row"><button type="button" class="btn primary" data-act="pass">离开平台</button></div>`;
        break;
      }
      case 'airshow': {
        title = '航展 · 远程签约一次';
        const open = Object.keys(AIRLINES).filter((id) => E.canSignAt(S, h, id));
        inner = `<p class="dec-sub">选择一家可签约的航司当场洽谈（未被锁定，或你已是其主力出租人）。</p>
          <div class="list">${open
            .map((id) => {
              const AD = AIRLINES[id];
              const [rt, rc] = ratingLabel(id);
              return `<div class="list-item"><div><span class="gdot" style="--gc:var(--g-${AD.g})"></span><b>${id}</b> ${esc(AD.name)} <span class="rt ${rc}">${rt}</span><div class="sub">${GROUPS[AD.g].name} · ${AD.types.map((t) => TYPES[t].name).join(' / ')}</div></div><button type="button" class="btn small" data-airshow="${id}">洽谈</button></div>`;
            })
            .join('')}</div>
          <div class="row"><button type="button" class="btn ghost" data-act="pass">不参加</button></div>`;
        break;
      }
      case 'shortfall': {
        title = pd.reason === 'cash' ? '资金缺口' : '违反杠杆契约';
        const items = E.sellables(S, h);
        inner = `<div class="note bad">${pd.reason === 'cash' ? `现金为 ${m(pl.cash)}，RCF 已用尽。必须出售资产补足缺口。` : `杠杆 ${pct(E.leverage(S, h), 0)} 连续两个季度超过 85%。必须出售资产降到 80% 以下。`}</div>
          ${sellList(pd, false)}
          ${items
            .filter((i) => i.kind !== 'aircraft')
            .map((i) => `<div class="row"><button type="button" class="btn small" data-sellother="${i.kind}:${i.id}">出售 ${i.kind === 'engine' ? ENGINES[i.id].name + ' 平台' : OEMS[i.id].name + ' 订单'} ${m(i.net)}</button></div>`)
            .join('')}`;
        break;
      }
      default:
        inner = `<div class="row"><button type="button" class="btn" data-act="pass">继续</button></div>`;
    }
    box.innerHTML = `<div class="panel-h"><h2>${esc(title)}</h2><span class="eyebrow">${E.qLabel(S)}</span></div><div class="panel-b">${inner}</div>`;
  }

  // ---------- 标签页 ----------
  function renderTabs() {
    document.querySelectorAll('#tabbar [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === ui.tab)));
    const h = H();
    const pane = $('#tabpane');
    const sellable = S.pending && S.pending.p === h && ['turn', 'market', 'shortfall'].includes(S.pending.type);
    if (ui.tab === 'fleet') {
      const own = E.ownedAircraft(S, h).sort((a, b) => (a.lease ? a.lease.airline : 'zz').localeCompare(b.lease ? b.lease.airline : 'zz'));
      if (!own.length) {
        pane.innerHTML = '<div class="empty">还没有飞机。落在航司格上报价签约，或在二手平台买入。</div>';
        return;
      }
      const atMarket = S.pending && S.pending.type === 'market';
      pane.innerHTML = `<div class="tbl-wrap"><table><thead><tr><th>MSN</th><th>机型</th><th>发动机</th><th class="r">机龄</th><th>承租人</th><th>评级</th><th class="r">剩余租期</th><th class="r">LRF</th><th class="r">月租</th><th class="r">MR 余额</th><th class="r">市值</th><th class="r">贷款</th><th class="r">LTV</th><th></th></tr></thead><tbody>${own
        .map((a) => {
          const v = E.mv(S, a);
          const loan = a.loan ? a.loan.principal : 0;
          const L = a.lease;
          const pr = E.saleProceeds(S, a, atMarket);
          const armed = ui.confirm === a.id;
          const [rt, rc] = L ? ratingLabel(L.airline) : ['', ''];
          return `<tr class="${L ? '' : 'idle'}"><td class="num">${a.msn}</td><td>${TYPES[a.type].name}</td><td>${a.engine}</td><td class="num r">${E.ageNow(S, a).toFixed(1)}</td><td>${L ? esc(AIRLINES[L.airline].name) : '闲置'}</td><td>${L ? `<span class="rt ${rc}">${rt}</span>` : ''}</td><td class="num r">${L ? ((L.endQ - S.q) / 4).toFixed(1) + ' 年' : '—'}</td><td class="num r">${L ? pct(L.lrf, 3) : '—'}</td><td class="num r">${L ? (L.rentQ / 3).toFixed(2) : '—'}</td><td class="num r">${L ? L.mrBal.toFixed(1) : '—'}</td><td class="num r">${v.toFixed(1)}</td><td class="num r">${loan.toFixed(1)}</td><td class="num r">${pct(loan / v, 0)}</td>
            <td>${sellable ? `<button type="button" class="btn small${armed ? ' primary' : ''}" data-sell="${a.id}">${armed ? '确认' : '出售'} ${m(pr.net)}</button>` : ''}</td></tr>`;
        })
        .join('')}</tbody></table></div>`;
    } else if (ui.tab === 'airlines') {
      pane.innerHTML = `<div class="tbl-wrap"><table><thead><tr><th>航司</th><th>区域</th><th>评级</th><th>主力出租人</th><th class="r">机队</th><th class="r">竞标成本</th><th>可签机型</th></tr></thead><tbody>${Object.keys(AIRLINES)
        .map((id) => {
          const AD = AIRLINES[id];
          const A = S.airlines[id];
          const [rt, rc] = ratingLabel(id);
          const n = A.lessor != null ? E.airlineFleet(S, A.lessor, id).length : 0;
          return `<tr><td><b>${id}</b> ${esc(AD.name)} <span style="color:var(--ink-3)">${AD.cn}</span></td><td><span class="gdot" style="--gc:var(--g-${AD.g})"></span>${GROUPS[AD.g].name}</td><td><span class="rt ${rc}">${rt}</span>${A.defaultUntil != null ? ` <small>至 ${E.qLabel(S, A.defaultUntil)}</small>` : ''}</td><td>${A.lessor != null ? `<span style="color:${pColor(A.lessor)};font-weight:600">${esc(S.players[A.lessor].name)}</span>${A.framework ? ' ★' : ''}` : '<span style="color:var(--ink-3)">开放</span>'}</td><td class="num r">${n}/${AD.cap}</td><td class="num r">${A.lessor != null ? E.landingFee(S, id).toFixed(1) : '—'}</td><td>${AD.types.map((t) => TYPES[t].name).join(' / ')}${AD.engine ? ` <small>(${AD.engine})</small>` : ''}</td></tr>`;
        })
        .join('')}</tbody></table></div>`;
    } else if (ui.tab === 'market') {
      const mk = S.market;
      pane.innerHTML = `<p class="dec-sub">SOFR ${pct(mk.sofr, 2)} · 周期 ${CYCLES[mk.cycle].name}${mk.deferral ? ` · 租金延付还剩 ${mk.deferral} 季度` : ''}${mk.capeTown ? ' · 开普敦公约强化（收回成本减半）' : ''}${S.q < mk.maxFrozenUntil ? ` · MAX 交付位冻结至 ${E.qLabel(S, mk.maxFrozenUntil)}` : ''}${mk.sanctionDone ? ' · 对俄制裁生效' : ''}</p>
        <div class="tbl-wrap"><table><thead><tr><th>机型</th><th>类别</th><th>主机厂</th><th class="r">机龄</th><th class="r">当前价值</th><th class="r">价值指数</th><th class="r">市场 LRF（BBB，8 年）</th><th class="r">月租</th><th>发动机</th></tr></thead><tbody>${Object.keys(TYPES)
          .map((t) => {
            const T = TYPES[t];
            const v = E.typeValue(S, t, T.age0, T.engines[0]);
            const term = T.age0 ? 5 : 8;
            const lrf = T.lrf * CYCLES[mk.cycle].lrf * (1 + (mk.sofr - 0.035) * 6) * (term === 5 ? 1.02 : 1);
            const idx = mk.idx[t];
            return `<tr><td><b>${T.name}</b></td><td>${{ NB: '窄体', WB: '宽体', RJ: '支线喷气', TP: '涡桨' }[T.cat]}</td><td>${T.oem ? OEMS[T.oem].name : 'ATR'}</td><td class="num r">${T.age0}</td><td class="num r">${v.toFixed(1)}</td><td class="num r" style="color:${idx >= 1 ? 'var(--good)' : 'var(--bad)'}">${idx.toFixed(3)}</td><td class="num r">${pct(lrf, 3)}</td><td class="num r">${(v * lrf).toFixed(2)}</td><td>${T.engines.map((e) => (D.GTF.includes(e) ? `${e} <small>(${(mk.eng[e] * 100).toFixed(0)}%)</small>` : e)).join(' / ')}</td></tr>`;
          })
          .join('')}</tbody></table></div>`;
    } else if (ui.tab === 'reports') {
      const rows = S.reports.slice().reverse();
      if (!rows.length) {
        pane.innerHTML = '<div class="empty">第一个季度结束后生成季报。</div>';
        return;
      }
      pane.innerHTML = `<div class="tbl-wrap"><table><thead><tr><th>季度</th><th class="r">租金</th><th class="r">MR 收入</th><th class="r">利息</th><th class="r">本金摊还</th><th class="r">闲置仓储</th><th class="r">备发收入</th><th class="r">续租/退租</th><th class="r">期末现金</th><th class="r">杠杆</th><th class="r">NAV</th></tr></thead><tbody>${rows
        .map((r) => {
          const x = r.players[h];
          if (!x) return '';
          return `<tr><td class="num">${r.label}</td><td class="num r">${x.rent.toFixed(2)}</td><td class="num r">${x.mr.toFixed(2)}</td><td class="num r">${x.interest.toFixed(2)}</td><td class="num r">${x.amort.toFixed(2)}</td><td class="num r">${x.storage.toFixed(2)}</td><td class="num r">${x.engine.toFixed(2)}</td><td class="num r">${x.extended}/${x.returned}</td><td class="num r">${x.cash.toFixed(1)}</td><td class="num r">${pct(x.lev, 0)}</td><td class="num r"><b>${x.nav.toFixed(1)}</b></td></tr>`;
        })
        .join('')}</tbody></table></div>`;
    } else {
      pane.innerHTML = RULES;
    }
  }

  const RULES = `<div class="rules">
    <h3>目标</h3><p>你是一家飞机租赁公司的销售。和 AerCap、SMBC Aviation Capital、Avolon、BOC Aviation 竞争，把飞机租给全球 25 家航司。每一轮（所有公司各走一次）是一个季度，默认打满 10 年，比<b>公司净资产 NAV</b>：</p>
    <p><code>NAV = 现金 − RCF + Σ飞机市值 − Σ贷款 − Σ保证金 − ΣMR 余额 − 搁浅债务 + 应收保险 + 备发平台 + 交付位</code></p>
    <h3>大富翁对照</h3>
    <div class="tbl-wrap"><table><tbody>
      <tr><td>地产 / 颜色组</td><td>航司 / 9 个区域</td></tr>
      <tr><td>买地</td><td>报价签约，成为该航司的主力出租人（其他人无法再签）</td></tr>
      <tr><td>盖房子 / 酒店</td><td>追加飞机（每家航司有上限）/ 长期框架协议 ★</td></tr>
      <tr><td>集齐颜色</td><td>区域主力出租人：竞标成本 ×1.5，回合开始可远程加机</td></tr>
      <tr><td>收租</td><td>对手落在你的航司：付「竞标失败成本」= 0.9 × 你在该航司的季度租金 × 区域系数</td></tr>
      <tr><td>火车站</td><td>4 家主机厂交付位订单；用交付位购机 −12%</td></tr>
      <tr><td>水电公司</td><td>CFM / 普惠备发租赁平台</td></tr>
      <tr><td>起点 / 监狱 / 免费停车</td><td>都柏林 / 合规审查 / 航展</td></tr>
    </tbody></table></div>
    <h3>签约</h3>
    <ul>
      <li><b>来源</b>：现货（市值 +2%）、SLB（市值，LRF −4%，成交 +12%）、自有交付位（市值 −12%）、闲置飞机（交接成本 1%）。</li>
      <li><b>租金</b>：<code>月租 = 飞机价值 × LRF</code>。市场 LRF 由机型基准、航司信用溢价（A −6% … CCC +22%）、周期、租期和 SOFR 决定。租金在租期内<b>固定</b>，而贷款是浮动利率，所以加息会压缩利差。</li>
      <li><b>成交概率</b>：以市场 LRF 报价约 55%；每高 1% 降约 7 个百分点。弱信用航司、区域主力、框架协议、长租期、同行转介都会加成。被拒后可降价再报一次。</li>
      <li><b>保证金</b>：签约时收取 2 个月租金，退租时返还；违约时没收。<b>MR</b>：每季度按租金 12–20% 收取，退租时支付 70% 作为维修补偿，其余为收益。</li>
    </ul>
    <h3>融资</h3>
    <ul>
      <li>银行担保贷款：LTV ≤ 75%，SOFR + 200bp，季度摊还 1.2%。</li>
      <li>无担保债券：需投资级（杠杆 &lt; 65% 且机队 ≥ 6 架），LTV ≤ 70%，SOFR + 140bp。</li>
      <li>ECA 担保：仅新机（不含 C919），LTV ≤ 85%，SOFR + 110bp，但前端保费 4%，摊还 1.8%/季。</li>
      <li>RCF：现金不足时自动提取，现金超过 $15m 时季末自动偿还。<b>契约</b>：杠杆（债务 / 资产）连续两季超过 85% 时必须卖机降杠杆。</li>
    </ul>
    <h3>信用与风险</h3>
    <ul>
      <li>每季度按评级抽违约：A 0.1%、BBB 0.3%、BB 0.8%、B 2%、CCC 4.5%，下行周期 ×1.6，危机 ×2.5。</li>
      <li>违约后飞机被收回（收回与整修成本为市值的 4%），保证金和 MR 余额归你，航司进入 4 个季度重组后以 B 级重新开放。</li>
      <li>每年年末航司评级迁移；租约到期时约 50% 续租（框架协议 +30%），否则飞机退回闲置，每季度仓储成本为市值的 0.4%。</li>
      <li>飞机价值 = 新机价 × e<sup>−k·机龄</sup> × 机型指数。指数随周期和事件波动；GTF 发动机的飞机价值再打 98 折。</li>
    </ul>
    <h3>小技巧</h3>
    <ul>
      <li>CCC 航司收益最高，但十年内大概率违约。高收益航司的保证金和 MR 是违约时的缓冲。</li>
      <li>ECA 杠杆最高但摊还快，吃现金；无担保最便宜，需先把杠杆做低。</li>
      <li>危机时二手机价格低，是买入闲置库存的机会；繁荣时在交易平台卖出带租约的飞机锁定收益。</li>
    </ul>
  </div>`;

  // ---------- 覆盖层 ----------
  function showSetup() {
    const saved = loadSave();
    const canResume = saved && !saved.over && saved.players && saved.v === 1;
    const aiKeys = Object.keys(D.AI_PROFILES);
    const sel = new Set(['aercap', 'smbc', 'avolon']);
    const ov = $('#overlay');
    ov.innerHTML = `<div class="overlay"><form class="sheet" id="setup">
      <div><div class="en">LESSOR TYCOON</div><h2>租赁大亨</h2></div>
      <p>你是一家飞机租赁公司的销售，要在全球 25 家航司间出租飞机。掷骰子绕航线图行进，报价签约、安排融资、应对违约和周期，10 年后比公司净资产。</p>
      <div class="field"><label for="f-name">你的公司名称</label><input type="text" id="f-name" maxlength="16" value="长空租赁"></div>
      <div class="field"><span class="eyebrow">对手（选 1–3 家）</span><div class="chips" id="f-ai">${aiKeys.map((k) => `<button type="button" class="chip" data-ai="${k}" aria-pressed="${sel.has(k)}">${D.AI_PROFILES[k].name}</button>`).join('')}</div></div>
      <div class="field"><span class="eyebrow">游戏时长</span><div class="chips" id="f-years">${[5, 8, 10, 12].map((y) => `<button type="button" class="chip" data-years="${y}" aria-pressed="${y === 10}">${y} 年</button>`).join('')}</div></div>
      <div class="field"><label for="f-seed">随机种子（可选，同一种子开局相同）</label><input type="number" id="f-seed" placeholder="留空随机"></div>
      <div class="row"><button type="submit" class="btn primary big">开始新游戏</button>${canResume ? `<button type="button" class="btn big" id="f-resume">继续存档（${E.qLabel(saved)}）</button>` : ''}${S ? '<button type="button" class="btn ghost" id="f-close">取消</button>' : ''}</div>
    </form></div>`;
    let years = 10;
    ov.querySelector('#f-ai').addEventListener('click', (e) => {
      const b = e.target.closest('[data-ai]');
      if (!b) return;
      const k = b.dataset.ai;
      if (sel.has(k)) {
        if (sel.size > 1) sel.delete(k);
      } else if (sel.size < 3) sel.add(k);
      ov.querySelectorAll('[data-ai]').forEach((x) => x.setAttribute('aria-pressed', String(sel.has(x.dataset.ai))));
    });
    ov.querySelector('#f-years').addEventListener('click', (e) => {
      const b = e.target.closest('[data-years]');
      if (!b) return;
      years = +b.dataset.years;
      ov.querySelectorAll('[data-years]').forEach((x) => x.setAttribute('aria-pressed', String(+x.dataset.years === years)));
    });
    ov.querySelector('#setup').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = ($('#f-name').value || '长空租赁').trim().slice(0, 16) || '长空租赁';
      const seedV = $('#f-seed').value;
      const players = [{ name, human: true }, ...aiKeys.filter((k) => sel.has(k)).map((k) => ({ ai: k }))];
      startGame({ players, years, seed: seedV !== '' ? +seedV : undefined });
    });
    const r = ov.querySelector('#f-resume');
    if (r)
      r.addEventListener('click', () => {
        S = saved;
        ov.innerHTML = '';
        fullRender();
        pump();
      });
    const c = ov.querySelector('#f-close');
    if (c) c.addEventListener('click', () => (ov.innerHTML = ''));
  }
  function showResults() {
    const h = H();
    const ranked = S.players.map((p) => ({ p, nav: p.bankrupt ? null : E.nav(S, p.id) })).sort((a, b) => (b.nav ?? -1e9) - (a.nav ?? -1e9));
    const pos = ranked.findIndex((r) => r.p.id === h) + 1;
    const me = S.players[h];
    $('#overlay').innerHTML = `<div class="overlay"><div class="sheet">
      <div><div class="en">FINAL · ${E.qLabel(S, S.q - 1)}</div><h2>${pos === 1 ? '你赢了。' : `你排名第 ${pos}。`}</h2></div>
      <div class="rank">${ranked.map((r, i) => `<div><span class="pos">${i + 1}</span><span><b style="color:${pColor(r.p.id)}">${esc(r.p.name)}</b>${r.p.human ? ' · 你' : ''}<br><small class="mono">签约 ${r.p.stats.deals} 单 · 租金 ${m(r.p.stats.rent, 0)} · 竞标成本收入 ${m(r.p.stats.feeIn, 0)} · 违约影响 ${r.p.stats.defaultsHit} 次</small></span><b class="mono">${r.nav == null ? '破产' : m(r.nav)}</b></div>`).join('')}</div>
      <p>你签了 ${me.stats.deals} 单（报价 ${me.stats.bids} 次），累计租金 ${m(me.stats.rent)}，利息 ${m(me.stats.interest)}，出售飞机 ${me.stats.sold} 架。</p>
      <div class="row"><button type="button" class="btn primary" id="r-new">再来一局</button><button type="button" class="btn ghost" id="r-close">查看棋盘</button></div>
    </div></div>`;
    $('#r-new').addEventListener('click', showSetup);
    $('#r-close').addEventListener('click', () => ($('#overlay').innerHTML = ''));
  }

  function startGame(opts) {
    S = E.newGame(opts);
    E.advance(S);
    ui.deal = null;
    ui.lastEvents = 0;
    $('#overlay').innerHTML = '';
    save();
    fullRender();
    pump();
  }

  // ---------- 渲染入口 ----------
  function render() {
    if (!S) return;
    renderBoard();
    renderMe();
    renderPlayers();
    renderLog();
    renderDecision();
    renderTabs();
    document.querySelectorAll('#speed [data-speed]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.speed === ui.speed)));
    if (S.over && !ui.shownResults) {
      ui.shownResults = true;
      showResults();
    }
    if (!S.over) ui.shownResults = false;
  }
  function fullRender() {
    buildBoard();
    render();
  }

  // ---------- 事件 ----------
  function armOrDo(id, fn) {
    if (ui.confirm === id) {
      ui.confirm = null;
      fn();
    } else {
      ui.confirm = id;
      render();
      setTimeout(() => {
        if (ui.confirm === id) {
          ui.confirm = null;
          render();
        }
      }, 3500);
    }
  }
  function sellClick(id) {
    const pd = S.pending;
    if (!pd || pd.p !== H()) return;
    armOrDo(id, () => {
      if (pd.type === 'shortfall') doAct({ action: 'sell', aircraftId: id });
      else if (pd.type === 'market') doAct({ action: 'sell', aircraftId: id });
      else if (pd.type === 'turn') doAct({ action: 'sell', aircraftId: id });
    });
  }

  document.addEventListener('click', (e) => {
    if (!S) return;
    const t = e.target.closest('button');
    if (!t || t.disabled) return;
    const pd = S.pending;
    if (t.dataset.tab) {
      ui.tab = t.dataset.tab;
      savePrefs();
      renderTabs();
      return;
    }
    if (t.dataset.speed) {
      ui.speed = t.dataset.speed;
      savePrefs();
      render();
      pump();
      return;
    }
    if (t.id === 'btn-new') {
      showSetup();
      return;
    }
    if (t.dataset.sell) return sellClick(t.dataset.sell);
    if (t.dataset.act === 'results') return showResults();
    if (t.dataset.act === 'newgame') return showSetup();
    if (!pd || pd.p !== H()) return;
    if (t.dataset.deal) {
      const k = t.dataset.deal;
      let v = t.dataset.val;
      if (k === 'term') v = +v;
      ui.deal[k] = v;
      if (k === 'finance') {
        const f = E.financeTerms(S, H(), v, true, ui.deal.type);
        ui.deal.ltv = f.maxLtv;
      }
      renderDecision();
      return;
    }
    if (t.dataset.remote) return doAct({ action: 'remote', airline: t.dataset.remote });
    if (t.dataset.airshow) return doAct({ action: 'visit', airline: t.dataset.airshow });
    if (t.dataset.buyused) return doAct({ action: 'buy', type: t.dataset.buyused });
    if (t.dataset.sellother) {
      const [kind, id] = t.dataset.sellother.split(':');
      return armOrDo('o' + id, () => doAct({ action: kind === 'engine' ? 'sellEngine' : 'sellOem', id }));
    }
    const a = t.dataset.act;
    if (!a) return;
    switch (a) {
      case 'roll':
        return doAct({ action: 'roll' });
      case 'repay':
        return doAct({ action: 'repay', amount: Math.min(S.players[H()].rcf, S.players[H()].cash) });
      case 'pass':
        return doAct({ action: 'pass' });
      case 'sign':
        return doAct({ action: 'sign', ...ui.deal });
      case 'framework':
        return doAct({ action: 'framework' });
      case 'buyout': {
        const seller = S.airlines[pd.airline].lessor;
        const fair = E.positionValue(S, seller, pd.airline);
        return doAct({ action: 'buyout', price: Math.round(Math.max(0.5, fair * ui.buyRatio) * 10) / 10 });
      }
      case 'accept':
        return doAct({ action: 'accept' });
      case 'reject':
        return doAct({ action: 'reject' });
      case 'oem-buy':
        return doAct({ action: 'buy' });
      case 'oem-top1':
        return doAct({ action: 'topup', n: 1 });
      case 'oem-top2':
        return doAct({ action: 'topup', n: 2 });
      case 'engine-buy':
        return doAct({ action: 'buy' });
      case 'jail-roll':
        return doAct({ action: 'roll' });
      case 'jail-pay':
        return doAct({ action: 'pay' });
      case 'jail-card':
        return doAct({ action: 'card' });
    }
  });
  document.addEventListener('input', (e) => {
    if (!S || !S.pending) return;
    const pd = S.pending;
    if (e.target.id === 'ratio' && ui.deal) {
      ui.deal.ratio = +e.target.value;
      updateQuoteOnly(pd);
    } else if (e.target.id === 'ltv' && ui.deal) {
      ui.deal.ltv = +e.target.value;
      updateQuoteOnly(pd);
    } else if (e.target.id === 'buy') {
      ui.buyRatio = +e.target.value;
      const seller = S.airlines[pd.airline].lessor;
      const fair = E.positionValue(S, seller, pd.airline);
      $('#buy-out').textContent = pct(ui.buyRatio, 0);
      $('#buy-price').textContent = m(Math.max(0.5, fair * ui.buyRatio));
    } else if (e.target.id === 'log-mine') {
      ui.logMine = e.target.checked;
      renderLog();
    }
  });

  // ---------- 启动 ----------
  loadPrefs();
  const saved = loadSave();
  if (saved && !saved.over && saved.v === 1) {
    S = saved;
    fullRender();
    pump();
  } else {
    // 先放一局示例开局在背后，让首屏不是空棋盘
    S = E.newGame({ seed: 20270101 });
    E.advance(S);
    fullRender();
    S = null;
    showSetup();
    // showSetup 之后若用户取消，S 为空；保留示例棋盘渲染
  }
  window.__LT_UI = { get state() { return S; }, doAct, render };
})();
