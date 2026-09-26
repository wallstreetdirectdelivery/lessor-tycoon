// 《租赁大亨》规则引擎：纯逻辑、纯 JSON 状态、种子随机数。
// 所有决策都通过 state.pending 暴露，人类（UI）和 AI 都调用 act(state, choice) 作答。
(function (root) {
  const LT = (root.LT = root.LT || {});
  const D = LT.data;
  const { TYPES, AIRLINES, GROUPS, BOARD, CREDIT, CYCLES, CYCLE_TRANS, OEMS, ENGINES, RATINGS } = D;

  const BOARD_N = BOARD.length;
  const JAIL_POS = BOARD.findIndex((s) => s.t === 'jail');
  const GO_BONUS = 4;
  const BID_COST = 0.3;
  const JAIL_FEE = 1;
  const MAX_SIGN_PER_VISIT = 2;
  const COVENANT = 0.85;
  const r2 = (x) => Math.round(x * 100) / 100;

  // ---------- RNG ----------
  function rand(s) {
    let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const randInt = (s, a, b) => a + Math.floor(rand(s) * (b - a + 1));
  function shuffle(s, arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand(s) * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- 时间 / 日志 ----------
  const qLabel = (s, q = s.q) => `${s.startYear + Math.floor(q / 4)} Q${(q % 4) + 1}`;
  function log(s, text, p = null, kind = 'info') {
    s.log.push({ q: s.q, p, text, kind });
    if (s.log.length > 500) s.log.splice(0, s.log.length - 500);
  }
  const fmt = (x) => `$${(Math.round(x * 10) / 10).toFixed(1)}m`;

  // ---------- 新游戏 ----------
  function newGame(opts = {}) {
    const seed = opts.seed != null ? opts.seed >>> 0 : (Math.random() * 2 ** 32) >>> 0;
    const s = {
      v: 1,
      seed,
      rng: seed,
      q: 0,
      startYear: 2027,
      maxQ: (opts.years || 10) * 4,
      players: [],
      airlines: {},
      oems: {},
      engines: {},
      market: { sofr: 0.035, cycle: 1, idx: {}, eng: {}, deferral: 0, capeTown: false, sanctionDone: false, maxFrozenUntil: -1 },
      aircraft: {},
      nextId: 1,
      msnUsed: {},
      decks: {},
      turn: { p: 0, doubles: 0, remoteUsed: false, roll: null, extraRoll: false },
      phase: 'turnStart',
      pending: null,
      log: [],
      events: [],
      reports: [],
      over: false,
      winner: null,
      endOnHumanBankrupt: opts.endOnHumanBankrupt !== false,
    };
    for (const t in TYPES) s.market.idx[t] = 1;
    for (const e of D.GTF) s.market.eng[e] = 0.98; // GTF 发动机飞机价值略低、交易更便宜
    for (const id in AIRLINES) s.airlines[id] = { rating: AIRLINES[id].rating, lessor: null, framework: false, defaultUntil: null, sanctioned: false };
    for (const id in OEMS) s.oems[id] = { owner: null, slots: 0 };
    for (const id in ENGINES) s.engines[id] = { owner: null };

    const startCash = opts.startCash || 150;
    const seats = opts.players || [
      { name: opts.humanName || '长空租赁', human: true },
      { ai: 'aercap' },
      { ai: 'smbc' },
      { ai: 'avolon' },
    ];
    seats.forEach((seat, i) => {
      const prof = seat.ai ? D.AI_PROFILES[seat.ai] : null;
      s.players.push({
        id: i,
        name: seat.name || (prof ? prof.name : `玩家${i + 1}`),
        cn: prof ? prof.cn : seat.name || '',
        human: !!seat.human,
        ai: seat.ai || null,
        acceptPremium: prof ? prof.acceptPremium : 1.1,
        cash: startCash,
        rcf: 0,
        rcfLimit: 30,
        pos: 0,
        jail: 0,
        passCard: false,
        spreadAdj: 0,
        referral: false,
        bankrupt: false,
        stranded: [],
        receivables: [],
        breach: 0,
        stats: { deals: 0, dealValue: 0, rent: 0, mr: 0, feeIn: 0, feeOut: 0, interest: 0, events: 0, defaultsHit: 0, bids: 0, bidsWon: 0, sold: 0 },
      });
    });
    s.decks.ch = shuffle(s, D.CHANCE.map((c) => c.id));
    s.decks.cc = shuffle(s, D.COMMUNITY.map((c) => c.id));
    log(s, `${qLabel(s)} 开局。每家公司初始股本 ${fmt(startCash)}，RCF 额度 $30m。SOFR ${(s.market.sofr * 100).toFixed(2)}%。`, null, 'sys');
    return s;
  }

  // ---------- 估值 ----------
  function ageNow(s, ac) {
    return ac.age + (s.q - ac.acqQ) / 4;
  }
  function typeValue(s, typeId, age, engine) {
    const T = TYPES[typeId];
    const e = engine && s.market.eng[engine] != null ? s.market.eng[engine] : 1;
    return T.newPrice * Math.exp(-T.k * age) * s.market.idx[typeId] * e;
  }
  function mv(s, ac) {
    return typeValue(s, ac.type, ageNow(s, ac), ac.engine) * (ac.haircut || 1);
  }
  const ownedAircraft = (s, p) => Object.values(s.aircraft).filter((a) => a.owner === p);
  const fleetValue = (s, p) => ownedAircraft(s, p).reduce((t, a) => t + mv(s, a), 0);
  function totalDebt(s, p) {
    const pl = s.players[p];
    return ownedAircraft(s, p).reduce((t, a) => t + (a.loan ? a.loan.principal : 0), 0) + pl.rcf + pl.stranded.reduce((t, d) => t + d.principal, 0);
  }
  function leverage(s, p) {
    const assets = fleetValue(s, p) + Math.max(0, s.players[p].cash);
    const debt = totalDebt(s, p);
    if (debt <= 0) return 0;
    return assets > 0 ? debt / assets : 9;
  }
  function isIG(s, p) {
    return leverage(s, p) < 0.65 && ownedAircraft(s, p).length >= 6 && s.players[p].breach === 0;
  }
  function nav(s, p) {
    const pl = s.players[p];
    let v = pl.cash - pl.rcf;
    for (const a of ownedAircraft(s, p)) {
      v += mv(s, a);
      if (a.loan) v -= a.loan.principal;
      if (a.lease) v -= a.lease.deposit + a.lease.mrBal;
    }
    for (const d of pl.stranded) v -= d.principal;
    for (const r of pl.receivables) v += r.amount;
    for (const id in s.engines) if (s.engines[id].owner === p) v += ENGINES[id].price * 0.8;
    for (const id in s.oems) if (s.oems[id].owner === p) v += s.oems[id].slots * (OEMS[id].price / OEMS[id].slots) * 0.5;
    return v;
  }
  const rcfAvail = (s, p) => Math.max(0, s.players[p].rcfLimit - s.players[p].rcf);

  // ---------- 航司 / 区域 ----------
  const airlineFleet = (s, p, id) => ownedAircraft(s, p).filter((a) => a.lease && a.lease.airline === id);
  const rentAt = (s, p, id) => airlineFleet(s, p, id).reduce((t, a) => t + a.lease.rentQ, 0);
  function dominates(s, p, g) {
    return Object.keys(AIRLINES).filter((id) => AIRLINES[id].g === g).every((id) => s.airlines[id].lessor === p);
  }
  function airlineOpen(s, id) {
    const a = s.airlines[id];
    return !a.sanctioned && a.defaultUntil == null;
  }
  function relock(s, id) {
    const a = s.airlines[id];
    const owners = new Set(Object.values(s.aircraft).filter((x) => x.lease && x.lease.airline === id).map((x) => x.owner));
    if (a.lessor != null && !owners.has(a.lessor)) {
      a.lessor = owners.size ? [...owners][0] : null;
      a.framework = false;
    }
  }
  function landingFee(s, id) {
    const a = s.airlines[id];
    if (a.lessor == null) return 0;
    let fee = 0.9 * rentAt(s, a.lessor, id) * GROUPS[AIRLINES[id].g].fee;
    if (a.framework) fee *= 1.5;
    if (dominates(s, a.lessor, AIRLINES[id].g)) fee *= 1.5;
    return Math.max(0.3, fee);
  }

  // ---------- 市场报价 ----------
  function termOptions(typeId, age) {
    return age < 3 ? [6, 8, 10, 12] : [3, 5, 7];
  }
  const TERM_ADJ = { 3: 1.04, 5: 1.02, 7: 1.0, 6: 1.03, 8: 1.0, 10: 0.98, 12: 0.96 };
  function marketLrf(s, typeId, airlineId, term, age) {
    const T = TYPES[typeId];
    const rating = Math.min(4, s.airlines[airlineId].rating);
    const cyc = CYCLES[s.market.cycle];
    const rateAdj = 1 + (s.market.sofr - 0.035) * 6;
    const ageAdj = age >= 8 ? 1 : 1 + age * 0.0; // 二手机的 LRF 已在机型参数里
    return T.lrf * (1 + CREDIT.prem[rating]) * cyc.lrf * (TERM_ADJ[term] || 1) * rateAdj * ageAdj;
  }
  function financeTerms(s, p, kind, isNew, typeId) {
    const pl = s.players[p];
    const cyc = CYCLES[s.market.cycle];
    const lev = leverage(s, p);
    const levAdj = lev > 0.75 ? 0.005 : 0;
    switch (kind) {
      case 'cash':
        return { ok: true, maxLtv: 0, spread: 0, amort: 0, fee: 0, label: '全现金' };
      case 'bank':
        return { ok: true, maxLtv: 0.75, spread: 0.02 + cyc.spread + pl.spreadAdj + levAdj, amort: 0.012, fee: 0.005, label: '银行担保贷款' };
      case 'unsecured':
        return { ok: isIG(s, p), why: '需投资级（杠杆 < 65% 且机队 ≥ 6 架）', maxLtv: 0.7, spread: 0.014 + cyc.spread * 0.8 + pl.spreadAdj, amort: 0.004, fee: 0.0025, label: '无担保债券' };
      case 'eca': {
        const T = TYPES[typeId];
        const ok = isNew && T.oem !== 'comac';
        return { ok, why: '仅限新机（不含 C919）', maxLtv: 0.85, spread: 0.011 + pl.spreadAdj, amort: 0.018, fee: 0.04, label: 'ECA 担保' };
      }
    }
    return { ok: false, why: '未知融资方式' };
  }

  // 统一报价：人类界面和 AI 共用。params: {airline, type, engine, source, aircraftId, term, ratio, finance, ltv}
  function quote(s, p, params) {
    const pl = s.players[p];
    const A = s.airlines[params.airline];
    const AD = AIRLINES[params.airline];
    const q = { ok: false };
    if (!A || !airlineOpen(s, params.airline)) return { ok: false, why: '航司不可签约' };
    if (A.lessor != null && A.lessor !== p) return { ok: false, why: '该航司已被其他出租人锁定' };
    if (airlineFleet(s, p, params.airline).length >= AD.cap) return { ok: false, why: '已达该航司机队上限' };

    let typeId = params.type;
    let age = 0;
    let idle = null;
    if (params.source === 'idle') {
      idle = s.aircraft[params.aircraftId];
      if (!idle || idle.owner !== p || idle.lease) return { ok: false, why: '闲置飞机不可用' };
      typeId = idle.type;
      age = ageNow(s, idle);
    } else {
      if (!TYPES[typeId]) return { ok: false, why: '机型无效' };
      age = TYPES[typeId].age0;
    }
    const T = TYPES[typeId];
    if (!AD.types.includes(typeId)) return { ok: false, why: `${AD.name} 不运营 ${T.name}` };
    const isNew = age < 1;
    const engine = idle ? idle.engine : params.engine || T.engines[0];
    if (!T.engines.includes(engine)) return { ok: false, why: '发动机选项无效' };
    if (AD.engine && !idle && engine !== AD.engine) return { ok: false, why: `${AD.name} 只接受 ${AD.engine}` };
    const terms = termOptions(typeId, age);
    const term = terms.includes(params.term) ? params.term : terms[1];

    const value = typeValue(s, typeId, age, engine) * (idle ? idle.haircut || 1 : 1);
    let price = value;
    let lrfMult = 1;
    let acceptBonus = 0;
    const src = params.source || 'spot';
    if (src === 'spot') price = value * 1.02;
    else if (src === 'slot') {
      const o = s.oems[T.oem];
      if (!isNew || !o || o.owner !== p || o.slots < 1) return { ok: false, why: '没有可用交付位' };
      if (T.oem === 'boeing' && s.q < s.market.maxFrozenUntil && typeId === 'B38M') return { ok: false, why: 'MAX 停飞期间交付位冻结' };
      price = value * 0.88;
    } else if (src === 'slb') {
      if (!isNew) return { ok: false, why: 'SLB 仅限新机' };
      price = value;
      lrfMult = 0.96;
      acceptBonus += 0.12;
    } else if (src === 'idle') {
      price = 0;
    }
    const transition = src === 'idle' ? value * 0.01 : 0;

    const mLrf = marketLrf(s, typeId, params.airline, term, age) * lrfMult;
    const ratio = Math.max(0.85, Math.min(1.2, params.ratio || 1));
    const lrf = mLrf * ratio;
    const rentM = value * lrf;
    const rentQ = rentM * 3;
    const deposit = rentM * 2;
    const mrQ = rentQ * T.mr;

    // 融资
    let loan = 0;
    let fin = { ok: true, spread: 0, amort: 0, fee: 0, maxLtv: 0, label: '沿用原融资' };
    let feeAmt = 0;
    if (src !== 'idle') {
      fin = financeTerms(s, p, params.finance || 'bank', isNew, typeId);
      if (!fin.ok) return { ok: false, why: fin.why };
      const ltv = Math.max(0, Math.min(fin.maxLtv, params.ltv != null ? params.ltv : fin.maxLtv));
      loan = price * ltv;
      feeAmt = loan * fin.fee;
    } else if (idle.loan) {
      loan = 0;
    }
    const outflow = price - loan + feeAmt + transition - deposit;
    const equity = price - loan + feeAmt + transition;

    // 年化指标
    const existingLoan = idle && idle.loan ? idle.loan : null;
    const loanBal = existingLoan ? existingLoan.principal : loan;
    const rate = existingLoan ? s.market.sofr + existingLoan.spread : s.market.sofr + fin.spread;
    const interestQ = (loanBal * rate) / 4;
    const depQ = value * (1 - Math.exp(-T.k / 4));
    const netQ = rentQ - interestQ - depQ;
    const eqBase = idle ? Math.max(1, value - loanBal) : Math.max(1, equity);
    const roe = (netQ * 4) / eqBase;

    // 成交概率
    const rating = A.rating;
    let p0 = 0.55 - (ratio - 1) * 7 + acceptBonus;
    if (dominates(s, p, AD.g)) p0 += 0.08;
    if (A.lessor === p && A.framework) p0 += 0.1;
    if (rating >= 3) p0 += 0.08;
    if (pl.referral) p0 += 0.15;
    if (isNew && term >= 10) p0 += 0.05;
    if (src === 'idle' && age > 12) p0 -= 0.1;
    const acceptP = Math.max(0.03, Math.min(0.97, p0));

    Object.assign(q, {
      ok: true,
      typeId,
      engine,
      age,
      isNew,
      term,
      terms,
      source: src,
      value,
      price,
      marketLrf: mLrf,
      lrf,
      ratio,
      rentM,
      rentQ,
      deposit,
      mrQ,
      loan,
      finance: src === 'idle' ? 'existing' : params.finance || 'bank',
      finLabel: fin.label,
      spread: existingLoan ? existingLoan.spread : fin.spread,
      allIn: rate,
      amort: fin.amort,
      fee: feeAmt,
      transition,
      outflow,
      equity,
      interestQ,
      depQ,
      netQ,
      roe,
      yieldA: (rentQ * 4) / value,
      acceptP,
      affordable: pl.cash + rcfAvail(s, p) >= outflow,
    });
    if (!q.affordable) q.why = `资金不足：需 ${fmt(outflow)}，可用 ${fmt(pl.cash + rcfAvail(s, p))}`;
    return q;
  }

  // 列出某航司可用的签约来源组合（UI 与 AI 共用）
  function signOptions(s, p, airlineId) {
    const AD = AIRLINES[airlineId];
    const out = [];
    for (const typeId of AD.types) {
      const T = TYPES[typeId];
      const isNew = T.age0 < 1;
      const sources = ['spot'];
      if (isNew) sources.push('slb');
      if (isNew && T.oem && s.oems[T.oem] && s.oems[T.oem].owner === p && s.oems[T.oem].slots > 0) sources.push('slot');
      const engines = AD.engine ? [AD.engine] : T.engines;
      out.push({ typeId, sources, engines, terms: termOptions(typeId, T.age0) });
    }
    const idle = ownedAircraft(s, p).filter((a) => !a.lease && AD.types.includes(a.type));
    return { types: out, idle: idle.map((a) => a.id) };
  }

  // ---------- 资产 ----------
  function genMsn(s, typeId) {
    const [a, b] = TYPES[typeId].msn;
    for (let i = 0; i < 50; i++) {
      const m = randInt(s, a, b);
      const key = typeId.slice(0, 1) + m;
      if (!s.msnUsed[key]) {
        s.msnUsed[key] = 1;
        return String(m);
      }
    }
    return String(randInt(s, a, b));
  }
  function createAircraft(s, p, typeId, engine, age) {
    const id = 'ac' + s.nextId++;
    const ac = { id, msn: genMsn(s, typeId), type: typeId, engine, owner: p, age, acqQ: s.q, haircut: 1, lease: null, loan: null };
    s.aircraft[id] = ac;
    return ac;
  }
  function saleProceeds(s, ac, atMarket) {
    const v = mv(s, ac);
    let price;
    if (ac.lease) price = v * (1 + CREDIT.bid[Math.min(4, s.airlines[ac.lease.airline].rating)]);
    else price = v * 0.92;
    if (!atMarket) price *= 0.96;
    const loan = ac.loan ? ac.loan.principal : 0;
    const liab = ac.lease ? ac.lease.deposit + ac.lease.mrBal : 0;
    return { price, loan, liab, net: price - loan - liab };
  }
  function sellAircraft(s, p, acId, atMarket, why) {
    const ac = s.aircraft[acId];
    if (!ac || ac.owner !== p) return false;
    const pr = saleProceeds(s, ac, atMarket);
    const pl = s.players[p];
    pl.cash += pr.net;
    pl.stats.sold++;
    const where = ac.lease ? `（带 ${AIRLINES[ac.lease.airline].name} 租约）` : '（闲置）';
    log(s, `${pl.name} 出售 ${TYPES[ac.type].name} MSN ${ac.msn}${where}，售价 ${fmt(pr.price)}，偿还贷款后净得 ${fmt(pr.net)}${why ? '。' + why : ''}`, p, 'deal');
    const airline = ac.lease ? ac.lease.airline : null;
    delete s.aircraft[acId];
    if (airline) relock(s, airline);
    return true;
  }
  function removeAircraftToThirdParty(s, acId) {
    const ac = s.aircraft[acId];
    delete s.aircraft[acId];
    if (ac && ac.lease) relock(s, ac.lease.airline);
  }

  // ---------- 现金流工具 ----------
  function pay(s, p, amt, to = null) {
    s.players[p].cash -= amt;
    if (to != null) s.players[to].cash += amt;
  }

  // ---------- 牌堆 ----------
  function draw(s, deck) {
    if (!s.decks[deck].length) s.decks[deck] = shuffle(s, (deck === 'ch' ? D.CHANCE : D.COMMUNITY).map((c) => c.id));
    return s.decks[deck].shift();
  }
  function cardInfo(deck, id) {
    return (deck === 'ch' ? D.CHANCE : D.COMMUNITY).find((c) => c.id === id);
  }
  function notch(s, id, d) {
    const a = s.airlines[id];
    if (a.sanctioned || a.defaultUntil != null) return;
    const before = a.rating;
    a.rating = Math.max(0, Math.min(4, a.rating + d));
    if (a.rating !== before) log(s, `${AIRLINES[id].name} 评级 ${RATINGS[before]} → ${RATINGS[a.rating]}`, null, d > 0 ? 'bad' : 'good');
  }
  function shiftCycle(s, d) {
    const before = s.market.cycle;
    s.market.cycle = Math.max(0, Math.min(3, s.market.cycle + d));
    if (before !== s.market.cycle) log(s, `市场周期：${CYCLES[before].name} → ${CYCLES[s.market.cycle].name}`, null, 'sys');
  }
  function scaleIdx(s, pred, f) {
    for (const t in TYPES) if (pred(TYPES[t], t)) s.market.idx[t] = Math.max(0.4, Math.min(1.8, s.market.idx[t] * f));
  }

  function applyChance(s, p, id) {
    const m = s.market;
    const pl = s.players[p];
    switch (id) {
      case 'pandemic':
        m.cycle = 3;
        m.deferral = 2;
        scaleIdx(s, () => true, 0.92);
        for (const a in s.airlines) if (s.airlines[a].rating >= 3) notch(s, a, 1);
        break;
      case 'sanction': {
        if (m.sanctionDone) {
          for (const a in AIRLINES) if (AIRLINES[a].g === 'EA') notch(s, a, 1);
          log(s, '制裁清单扩大：欧亚区航司全部下调一档。', null, 'bad');
          break;
        }
        m.sanctionDone = true;
        const A = s.airlines.SU;
        A.sanctioned = true;
        for (const ac of Object.values(s.aircraft).filter((x) => x.lease && x.lease.airline === 'SU')) {
          const owner = s.players[ac.owner];
          const v = mv(s, ac);
          if (ac.loan && ac.loan.principal > 0) owner.stranded.push({ principal: ac.loan.principal, spread: ac.loan.spread, amortQ: ac.loan.principal * 0.04 });
          owner.receivables.push({ amount: v * 0.55, q: s.q + 6, text: `SU 保险赔付 MSN ${ac.msn}` });
          owner.stats.defaultsHit++;
          log(s, `${owner.name} 的 ${TYPES[ac.type].name} MSN ${ac.msn} 被扣留在俄罗斯。账面 ${fmt(v)}，贷款 ${fmt(ac.loan ? ac.loan.principal : 0)} 转为搁浅债务。`, ac.owner, 'bad');
          delete s.aircraft[ac.id];
        }
        A.lessor = null;
        A.framework = false;
        break;
      }
      case 'gtf':
        for (const e of D.GTF) m.eng[e] = (m.eng[e] || 1) * 0.9;
        notch(s, '6E', 1);
        notch(s, 'W6', 1);
        break;
      case 'max':
        scaleIdx(s, (T, t) => t === 'B38M', 0.85);
        m.maxFrozenUntil = s.q + 4;
        break;
      case 'hike':
        m.sofr = Math.min(0.08, m.sofr + 0.0075);
        break;
      case 'cut':
        m.sofr = Math.max(0.0025, m.sofr - 0.005);
        break;
      case 'nbshort':
        scaleIdx(s, (T) => T.cat === 'NB', 1.08);
        break;
      case 'wbsoft':
        scaleIdx(s, (T) => T.cat === 'WB', 0.92);
        break;
      case '777x':
        scaleIdx(s, (T, t) => t === 'B77W', 1.12);
        break;
      case 'oil':
        for (const a in s.airlines) if (s.airlines[a].rating >= 3) notch(s, a, 1);
        if (rand(s) < 0.5) shiftCycle(s, 1);
        break;
      case 'recovery':
        shiftCycle(s, -1);
        for (const a in s.airlines) if (rand(s) < 0.35) notch(s, a, -1);
        break;
      case 'c919':
        scaleIdx(s, (T, t) => t === 'C919', 1.1);
        break;
      case 'restructure': {
        const weak = Object.keys(s.airlines).filter((a) => airlineOpen(s, a) && s.airlines[a].rating >= 3);
        if (weak.length) defaultAirline(s, weak[Math.floor(rand(s) * weak.length)]);
        else log(s, '没有 B 级及以下航司，重组潮平稳度过。', null, 'info');
        break;
      }
      case 'capetown':
        m.capeTown = true;
        break;
      case 'delay':
        scaleIdx(s, (T, t) => ['A320N', 'A321N', 'B38M'].includes(t), 1.06);
        for (const o in s.oems) if (s.oems[o].owner != null && s.oems[o].slots > 0) s.players[s.oems[o].owner].cash += s.oems[o].slots;
        break;
      case 'usd':
        for (const a in AIRLINES) if (['AF', 'LA', 'IN', 'SE'].includes(AIRLINES[a].g) && rand(s) < 0.4) notch(s, a, 1);
        break;
      case 'saf':
        scaleIdx(s, (T, t) => ['B738', 'A20C', 'B77W'].includes(t), 0.9);
        break;
      case 'appraisal':
        scaleIdx(s, () => true, 1.04);
        break;
    }
  }
  function applyCommunity(s, p, id) {
    const pl = s.players[p];
    switch (id) {
      case 'rcf':
        pl.rcfLimit += 20;
        break;
      case 'advisory':
        pl.cash += 2;
        break;
      case 'legal':
        pay(s, p, 1.5);
        break;
      case 'records': {
        const own = ownedAircraft(s, p);
        if (own.length) {
          const ac = own[Math.floor(rand(s) * own.length)];
          ac.haircut = (ac.haircut || 1) * 0.94;
          log(s, `受影响飞机：${TYPES[ac.type].name} MSN ${ac.msn}`, p, 'bad');
        }
        break;
      }
      case 'upgrade':
        pl.spreadAdj -= 0.0025;
        break;
      case 'downgrade':
        pl.spreadAdj += 0.0025;
        break;
      case 'jail':
        sendToJail(s, p);
        break;
      case 'dublin':
        pl.pos = 0;
        pl.cash += GO_BONUS;
        log(s, `${pl.name} 回到都柏林，收入 ${fmt(GO_BONUS)}`, p);
        break;
      case 'poached':
        pay(s, p, 1);
        break;
      case 'referral':
        pl.referral = true;
        break;
      case 'dividend':
        pay(s, p, Math.min(5, Math.max(0, pl.cash * 0.05)));
        break;
      case 'equity':
        pl.cash += 10;
        break;
      case 'insurance':
        pl.cash += 1.5;
        break;
      case 'pass':
        pl.passCard = true;
        break;
    }
  }

  // ---------- 违约 ----------
  function defaultAirline(s, id) {
    const A = s.airlines[id];
    A.defaultUntil = s.q + 4;
    log(s, `⚠ ${AIRLINES[id].name} 违约，申请破产保护（预计 ${qLabel(s, s.q + 4)} 重组完成）`, null, 'bad');
    for (const ac of Object.values(s.aircraft).filter((x) => x.lease && x.lease.airline === id)) {
      const pl = s.players[ac.owner];
      const v = mv(s, ac);
      const cost = v * (s.market.capeTown ? 0.02 : 0.04);
      // 保证金与 MR 余额留给出租人抵扣
      const kept = ac.lease.deposit + ac.lease.mrBal;
      pl.cash -= cost;
      pl.stats.defaultsHit++;
      log(s, `${pl.name} 收回 ${TYPES[ac.type].name} MSN ${ac.msn}：收回与整修成本 ${fmt(cost)}，没收保证金 + MR ${fmt(kept)}，损失未付租金 ${fmt(ac.lease.deferred || 0)}`, ac.owner, 'bad');
      ac.lease = null;
    }
    A.lessor = null;
    A.framework = false;
  }

  // ---------- 行动：移动与格子 ----------
  function sendToJail(s, p) {
    const pl = s.players[p];
    pl.pos = JAIL_POS;
    pl.jail = 1;
    s.turn.extraRoll = false;
    log(s, `${pl.name} 进入合规审查`, p, 'bad');
  }
  function move(s, p, steps) {
    const pl = s.players[p];
    const next = pl.pos + steps;
    if (next >= BOARD_N) {
      pl.cash += GO_BONUS;
      log(s, `${pl.name} 经过都柏林，平台服务费收入 ${fmt(GO_BONUS)}`, p);
    }
    pl.pos = next % BOARD_N;
    resolveSpace(s, p);
  }

  function resolveSpace(s, p) {
    const pl = s.players[p];
    const sp = BOARD[pl.pos];
    switch (sp.t) {
      case 'go':
        pl.cash += 2;
        log(s, `${pl.name} 停在都柏林，路演签约奖金 $2.0m`, p);
        break;
      case 'airline':
        visitAirline(s, p, sp.id, false);
        break;
      case 'cc':
      case 'ch': {
        const deck = sp.t;
        const id = draw(s, deck);
        const c = cardInfo(deck, id);
        pl.stats.events++;
        log(s, `${pl.name} 抽到【${deck === 'ch' ? '市场快讯' : '公司内部'}】${c.title}：${c.text}`, p, 'card');
        s.events.push({ q: s.q, p, deck, id, title: c.title, text: c.text });
        if (deck === 'ch') applyChance(s, p, id);
        else applyCommunity(s, p, id);
        break;
      }
      case 'tax': {
        let amt;
        if (sp.id === 'wht') {
          const roll = ownedAircraft(s, p).reduce((t, a) => t + (a.lease ? a.lease.rentQ : 0), 0);
          amt = Math.max(0.5, roll * 0.1);
          log(s, `${pl.name} 缴纳预提税 ${fmt(amt)}（季度租金的 10%）`, p, 'bad');
        } else {
          amt = Math.max(0.5, fleetValue(s, p) * 0.001);
          log(s, `${pl.name} 支付保险续保 ${fmt(amt)}（机队价值的 0.1%）`, p, 'bad');
        }
        pay(s, p, amt);
        break;
      }
      case 'oem': {
        const o = s.oems[sp.id];
        const O = OEMS[sp.id];
        if (o.owner == null) s.pending = { type: 'oem', p, oem: sp.id, mode: 'buy', price: O.price, slots: O.slots };
        else if (o.owner === p) s.pending = { type: 'oem', p, oem: sp.id, mode: 'topup', price: O.price / O.slots };
        else if (!s.players[o.owner].bankrupt) {
          const n = Object.values(s.oems).filter((x) => x.owner === o.owner).length;
          const fee = [0, 1, 2, 4, 8][n];
          pay(s, p, fee, o.owner);
          pl.stats.feeOut += fee;
          s.players[o.owner].stats.feeIn += fee;
          log(s, `${pl.name} 向 ${s.players[o.owner].name} 支付 ${O.name} 交付位转让溢价 ${fmt(fee)}（对方持有 ${n} 家主机厂订单）`, p, 'fee');
        }
        break;
      }
      case 'engine': {
        const e = s.engines[sp.id];
        if (e.owner == null) s.pending = { type: 'engine', p, engine: sp.id, price: ENGINES[sp.id].price };
        else if (e.owner !== p && !s.players[e.owner].bankrupt) {
          const both = Object.values(s.engines).every((x) => x.owner === e.owner);
          const dice = s.turn.roll ? s.turn.roll[0] + s.turn.roll[1] : 7;
          const fee = dice * (both ? 0.6 : 0.25);
          pay(s, p, fee, e.owner);
          pl.stats.feeOut += fee;
          s.players[e.owner].stats.feeIn += fee;
          log(s, `${pl.name} 向 ${s.players[e.owner].name} 租用备发，支付 ${fmt(fee)}（点数 ${dice} × ${both ? '0.6' : '0.25'}）`, p, 'fee');
        }
        break;
      }
      case 'market':
        s.pending = { type: 'market', p };
        break;
      case 'airshow':
        s.pending = { type: 'airshow', p };
        break;
      case 'gotojail':
        sendToJail(s, p);
        break;
      case 'jail':
      default:
        break;
    }
  }

  function canSignAt(s, p, id) {
    const A = s.airlines[id];
    if (!airlineOpen(s, id)) return false;
    if (A.lessor != null && A.lessor !== p) return false;
    return airlineFleet(s, p, id).length < AIRLINES[id].cap;
  }
  function visitAirline(s, p, id, remote) {
    const pl = s.players[p];
    const A = s.airlines[id];
    const AD = AIRLINES[id];
    if (A.sanctioned) {
      log(s, `${pl.name} 到访 ${AD.name}：受制裁，无法开展业务`, p);
      return;
    }
    if (A.defaultUntil != null) {
      log(s, `${pl.name} 到访 ${AD.name}：破产重组中，暂停引进飞机`, p);
      return;
    }
    if (A.lessor != null && A.lessor !== p) {
      const owner = s.players[A.lessor];
      const fee = landingFee(s, id);
      pay(s, p, fee, A.lessor);
      pl.stats.feeOut += fee;
      owner.stats.feeIn += fee;
      log(s, `${pl.name} 到 ${AD.name} 竞标失败——${owner.name} 以续租条款锁定客户。${pl.name} 付出竞标成本 ${fmt(fee)}，归 ${owner.name}`, p, 'fee');
      if (!remote) s.pending = { type: 'airline', p, airline: id, mode: 'rival', remote };
      return;
    }
    const own = airlineFleet(s, p, id).length;
    const canFramework = A.lessor === p && own >= 3 && !A.framework;
    if (own >= AD.cap && !canFramework) {
      log(s, `${pl.name} 到访 ${AD.name}：机队已满额（${own}/${AD.cap}）`, p);
      return;
    }
    s.pending = { type: 'airline', p, airline: id, mode: A.lessor === p ? 'own' : 'open', remote, signed: 0, retry: false, maxRatio: 1.2, limit: remote ? 1 : MAX_SIGN_PER_VISIT };
  }

  // 头寸估值：收购对手在某航司的全部租约
  function positionValue(s, p, id) {
    let v = 0;
    for (const a of airlineFleet(s, p, id)) {
      const val = mv(s, a);
      const loan = a.loan ? a.loan.principal : 0;
      const remQ = Math.max(0, a.lease.endQ - s.q);
      const interestQ = a.loan ? (loan * (s.market.sofr + a.loan.spread)) / 4 : 0;
      const depQ = val * (1 - Math.exp(-TYPES[a.type].k / 4));
      const margin = Math.max(0, a.lease.rentQ - interestQ - depQ);
      v += val - loan - a.lease.deposit - a.lease.mrBal + remQ * margin * 0.4;
    }
    return v;
  }
  function transferPosition(s, from, to, id, price) {
    const fleet = airlineFleet(s, from, id);
    for (const a of fleet) a.owner = to;
    s.players[to].cash -= price;
    s.players[from].cash += price;
    s.airlines[id].lessor = to;
    log(s, `${s.players[to].name} 以 ${fmt(price)} 收购 ${s.players[from].name} 在 ${AIRLINES[id].name} 的 ${fleet.length} 架带租约飞机（贷款一并承接）`, to, 'deal');
  }

  // ---------- 季度结算 ----------
  function quarterEnd(s) {
    const m = s.market;
    const cyc = CYCLES[m.cycle];
    const rep = { q: s.q, label: qLabel(s), sofr: m.sofr, cycle: m.cycle, players: {} };
    // 1) 违约检查
    for (const id in s.airlines) {
      const A = s.airlines[id];
      if (A.sanctioned || A.defaultUntil != null) continue;
      if (rand(s) < CREDIT.pd[A.rating] * cyc.pd) defaultAirline(s, id);
    }
    // 2) 现金流
    for (const pl of s.players) {
      if (pl.bankrupt) continue;
      const r = { rent: 0, mr: 0, interest: 0, amort: 0, storage: 0, engine: 0, receivable: 0, mrPaid: 0, depositBack: 0, extended: 0, returned: 0 };
      for (const ac of ownedAircraft(s, pl.id)) {
        const L = ac.lease;
        if (L) {
          let paid = L.rentQ;
          if (m.deferral > 0) {
            paid = L.rentQ * 0.5;
            L.deferred = (L.deferred || 0) + L.rentQ * 0.5;
          } else if (L.deferred > 0) {
            const extra = Math.min(L.deferred, L.rentQ * 0.25);
            paid += extra;
            L.deferred -= extra;
          }
          const mr = L.rentQ * TYPES[ac.type].mr;
          L.mrBal += mr;
          r.rent += paid;
          r.mr += mr;
        } else {
          r.storage += mv(s, ac) * 0.004;
        }
        if (ac.loan && ac.loan.principal > 0) {
          const i = (ac.loan.principal * (m.sofr + ac.loan.spread)) / 4;
          const am = Math.min(ac.loan.principal, ac.loan.amortQ);
          ac.loan.principal -= am;
          r.interest += i;
          r.amort += am;
          if (ac.loan.principal < 0.01) ac.loan = null;
        }
      }
      for (const d of pl.stranded) {
        r.interest += (d.principal * (m.sofr + d.spread)) / 4;
        const am = Math.min(d.principal, d.amortQ);
        d.principal -= am;
        r.amort += am;
      }
      pl.stranded = pl.stranded.filter((d) => d.principal > 0.01);
      r.interest += (pl.rcf * (m.sofr + 0.03)) / 4;
      for (const e in s.engines) if (s.engines[e].owner === pl.id) r.engine += ENGINES[e].income;
      pl.receivables = pl.receivables.filter((x) => {
        if (s.q >= x.q) {
          r.receivable += x.amount;
          log(s, `${pl.name} 收到 ${x.text} ${fmt(x.amount)}`, pl.id, 'good');
          return false;
        }
        return true;
      });
      pl.cash += r.rent + r.mr + r.engine + r.receivable - r.interest - r.amort - r.storage;
      pl.stats.rent += r.rent;
      pl.stats.mr += r.mr;
      pl.stats.interest += r.interest;
      rep.players[pl.id] = r;
    }
    // 3) 租约到期
    for (const ac of Object.values(s.aircraft)) {
      const L = ac.lease;
      if (!L || s.q + 1 < L.endQ) continue;
      const pl = s.players[ac.owner];
      const A = s.airlines[L.airline];
      let pExt = 0.5 + cyc.ext + (A.framework ? 0.3 : 0) + (A.rating === 0 ? 0.05 : 0) - (ageNow(s, ac) > 18 ? 0.2 : 0);
      if (rand(s) < pExt) {
        const age = ageNow(s, ac);
        const term = age < 12 ? 5 : 3;
        const lrf = marketLrf(s, ac.type, L.airline, term >= 5 ? 5 : 3, age);
        const rentM = mv(s, ac) * lrf;
        L.rentQ = rentM * 3;
        L.endQ = s.q + 1 + term * 4;
        L.startQ = s.q + 1;
        L.lrf = lrf;
        rep.players[ac.owner].extended++;
        log(s, `${AIRLINES[L.airline].name} 续租 ${pl.name} 的 ${TYPES[ac.type].name} MSN ${ac.msn} ${term} 年，新月租 ${fmt(rentM)}（LRF ${(lrf * 100).toFixed(2)}%）`, ac.owner, 'good');
      } else {
        const reimb = L.mrBal * 0.7;
        pl.cash -= reimb + L.deposit;
        rep.players[ac.owner].mrPaid += reimb;
        rep.players[ac.owner].returned++;
        log(s, `${TYPES[ac.type].name} MSN ${ac.msn} 租约到期退还给 ${pl.name}：返还保证金 ${fmt(L.deposit)}，支付维修补偿 ${fmt(reimb)}，MR 结余 ${fmt(L.mrBal - reimb)} 转为收益。飞机进入闲置`, ac.owner, 'info');
        const id = L.airline;
        ac.lease = null;
        relock(s, id);
      }
    }
    // 4) 市场更新
    marketUpdate(s);
    if (m.deferral > 0) m.deferral--;
    // 5) 年终
    const yearEnd = s.q % 4 === 3;
    if (yearEnd) {
      for (const id in s.airlines) {
        const A = s.airlines[id];
        if (A.sanctioned || A.defaultUntil != null) continue;
        const x = rand(s);
        if (x < CYCLES[m.cycle].up) notch(s, id, -1);
        else if (x < CYCLES[m.cycle].up + CYCLES[m.cycle].down) notch(s, id, 1);
      }
      for (const o in s.oems) if (s.oems[o].owner != null) s.oems[o].slots = Math.min(OEMS[o].slots + 2, s.oems[o].slots + 1);
    }
    // 6) 重组完成
    for (const id in s.airlines) {
      const A = s.airlines[id];
      if (A.defaultUntil != null && s.q + 1 >= A.defaultUntil) {
        A.defaultUntil = null;
        A.rating = 3;
        log(s, `${AIRLINES[id].name} 完成重组，评级 B，重新开放引进飞机`, null, 'good');
      }
    }
    // 7) RCF 自动还款 + 契约
    for (const pl of s.players) {
      if (pl.bankrupt) continue;
      if (pl.rcf > 0 && pl.cash > 15) {
        const repay = Math.min(pl.rcf, pl.cash - 15);
        pl.rcf -= repay;
        pl.cash -= repay;
      }
      const lev = leverage(s, pl.id);
      if (lev > COVENANT) {
        pl.breach++;
        log(s, `${pl.name} 杠杆 ${(lev * 100).toFixed(0)}% 超过 ${COVENANT * 100}% 契约上限（违约第 ${pl.breach} 季度）`, pl.id, 'bad');
      } else pl.breach = 0;
      rep.players[pl.id].nav = nav(s, pl.id);
      rep.players[pl.id].cash = pl.cash;
      rep.players[pl.id].lev = lev;
    }
    s.reports.push(rep);
    if (s.reports.length > 60) s.reports.shift();
    s.q++;
    log(s, `—— 进入 ${qLabel(s)} · SOFR ${(m.sofr * 100).toFixed(2)}% · 周期 ${CYCLES[m.cycle].name} ——`, null, 'sys');
  }

  function marketUpdate(s) {
    const m = s.market;
    const row = CYCLE_TRANS[m.cycle];
    let x = rand(s);
    let next = m.cycle;
    for (let i = 0; i < 4; i++) {
      if (x < row[i]) {
        next = i;
        break;
      }
      x -= row[i];
    }
    if (next !== m.cycle) {
      log(s, `市场周期：${CYCLES[m.cycle].name} → ${CYCLES[next].name}`, null, 'sys');
      m.cycle = next;
    }
    const cyc = CYCLES[m.cycle];
    let d = 0;
    const r = rand(s);
    if (r < 0.2) d -= 0.0025;
    else if (r < 0.4) d += 0.0025;
    if (m.cycle === 3 && rand(s) < 0.6) d -= 0.0025;
    if (m.cycle === 0 && rand(s) < 0.3) d += 0.0025;
    if (m.sofr > 0.05 && rand(s) < 0.3) d -= 0.0025;
    if (m.sofr < 0.015 && rand(s) < 0.3) d += 0.0025;
    m.sofr = Math.max(0.0025, Math.min(0.08, m.sofr + d));
    for (const t in m.idx) {
      let v = m.idx[t] * (1 + cyc.drift + (rand(s) - 0.5) * 0.03);
      v += (1 - v) * 0.05;
      m.idx[t] = Math.max(0.4, Math.min(1.8, v));
    }
    for (const e in m.eng) m.eng[e] += (0.98 - m.eng[e]) * 0.08;
  }

  // ---------- 偿付能力 ----------
  function sellables(s, p) {
    const items = ownedAircraft(s, p).map((a) => ({ kind: 'aircraft', id: a.id, net: saleProceeds(s, a, false).net }));
    for (const e in s.engines) if (s.engines[e].owner === p) items.push({ kind: 'engine', id: e, net: ENGINES[e].price * 0.7 });
    for (const o in s.oems) if (s.oems[o].owner === p) items.push({ kind: 'oem', id: o, net: s.oems[o].slots * (OEMS[o].price / OEMS[o].slots) * 0.5 });
    return items;
  }
  function checkSolvency(s, p, covenantCheck) {
    const pl = s.players[p];
    if (pl.bankrupt) return true;
    if (pl.cash < 0) {
      const draw = Math.min(rcfAvail(s, p), -pl.cash);
      if (draw > 0) {
        pl.rcf += draw;
        pl.cash += draw;
        log(s, `${pl.name} 提取 RCF ${fmt(draw)} 弥补现金缺口`, p, 'info');
      }
    }
    const short = pl.cash < -1e-6;
    const cov = covenantCheck && pl.breach >= 2;
    if (!short && !cov) return true;
    const items = sellables(s, p);
    const positive = items.filter((i) => i.net > 0);
    if (!positive.length || (short && items.reduce((t, i) => t + Math.max(0, i.net), 0) + pl.cash < 0)) {
      bankrupt(s, p);
      return true;
    }
    s.pending = { type: 'shortfall', p, reason: short ? 'cash' : 'covenant', gap: short ? -pl.cash : 0 };
    return false;
  }
  function bankrupt(s, p) {
    const pl = s.players[p];
    pl.bankrupt = true;
    log(s, `✖ ${pl.name} 资不抵债，进入破产清算。机队由第三方接手。`, p, 'bad');
    for (const a of ownedAircraft(s, p)) removeAircraftToThirdParty(s, a.id);
    for (const e in s.engines) if (s.engines[e].owner === p) s.engines[e].owner = null;
    for (const o in s.oems) if (s.oems[o].owner === p) s.oems[o] = { owner: null, slots: 0 };
    for (const id in s.airlines) if (s.airlines[id].lessor === p) s.airlines[id].lessor = null;
    pl.cash = 0;
    pl.rcf = 0;
    pl.stranded = [];
    pl.receivables = [];
  }

  // ---------- 主循环 ----------
  function activePlayers(s) {
    return s.players.filter((p) => !p.bankrupt);
  }
  function checkOver(s) {
    const act = activePlayers(s);
    const humanDead = s.endOnHumanBankrupt && s.players.some((p) => p.human && p.bankrupt);
    if (s.q >= s.maxQ || act.length <= 1 || humanDead) {
      s.over = true;
      const ranked = s.players.map((p) => ({ id: p.id, nav: p.bankrupt ? -Infinity : nav(s, p.id) })).sort((a, b) => b.nav - a.nav);
      s.winner = ranked[0].id;
      s.ranking = ranked.map((r) => r.id);
      log(s, `游戏结束。冠军：${s.players[s.winner].name}（NAV ${fmt(nav(s, s.winner))}）`, null, 'sys');
      return true;
    }
    return false;
  }

  function advance(s) {
    let guard = 0;
    while (!s.over && !s.pending) {
      if (++guard > 5000) throw new Error('advance loop guard');
      step(s);
    }
    return s;
  }

  function step(s) {
    const t = s.turn;
    switch (s.phase) {
      case 'turnStart': {
        const pl = s.players[t.p];
        if (pl.bankrupt) {
          s.phase = 'endTurn';
          return;
        }
        if (pl.jail > 0 && !t.extraRoll) {
          s.pending = { type: 'jail', p: t.p, tries: pl.jail };
          return;
        }
        s.pending = { type: 'turn', p: t.p, again: t.extraRoll };
        return;
      }
      case 'afterSpace': {
        const p = t.p;
        // 付费方或收款方都可能出现缺口：先检查当前玩家
        if (!checkSolvency(s, p, false)) return;
        for (const pl of s.players) if (!pl.bankrupt && pl.cash < 0 && !checkSolvency(s, pl.id, false)) return;
        if (checkOver(s)) return;
        if (t.extraRoll && !s.players[p].bankrupt && s.players[p].jail === 0) {
          s.phase = 'turnStart';
        } else {
          t.extraRoll = false;
          s.phase = 'endTurn';
        }
        return;
      }
      case 'endTurn': {
        t.doubles = 0;
        t.remoteUsed = false;
        t.extraRoll = false;
        const old = t.p;
        let n = old;
        for (let i = 0; i < s.players.length; i++) {
          n = (n + 1) % s.players.length;
          if (!s.players[n].bankrupt) break;
        }
        t.p = n;
        // 轮到的玩家序号没有变大 = 所有人都走完一轮 = 一个季度结束
        s.phase = n <= old ? 'quarterEnd' : 'turnStart';
        return;
      }
      case 'quarterEnd':
        quarterEnd(s);
        s.phase = 'solvency';
        s.solvIdx = 0;
        return;
      case 'solvency': {
        while (s.solvIdx < s.players.length) {
          const p = s.solvIdx;
          if (!checkSolvency(s, p, true)) return;
          s.solvIdx++;
        }
        if (checkOver(s)) return;
        if (s.players[t.p].bankrupt) t.p = s.players.findIndex((p) => !p.bankrupt);
        s.phase = 'turnStart';
        return;
      }
    }
  }

  function rollDice(s) {
    const d = [randInt(s, 1, 6), randInt(s, 1, 6)];
    s.turn.roll = d;
    return d;
  }

  // ---------- act：统一的决策入口 ----------
  function act(s, choice) {
    const pd = s.pending;
    if (!pd) throw new Error('no pending decision');
    const p = pd.p;
    const pl = s.players[p];
    const c = choice || {};
    const done = () => {
      s.pending = null;
    };
    switch (pd.type) {
      case 'turn': {
        if (c.action === 'roll') {
          done();
          const d = rollDice(s);
          const dbl = d[0] === d[1];
          log(s, `${pl.name} 掷出 ${d[0]} + ${d[1]}${dbl ? '（双数）' : ''}`, p, 'roll');
          if (dbl) {
            s.turn.doubles++;
            if (s.turn.doubles >= 3) {
              sendToJail(s, p);
              s.phase = 'afterSpace';
              return advance(s);
            }
            s.turn.extraRoll = true;
          } else s.turn.extraRoll = false;
          s.phase = 'afterSpace';
          move(s, p, d[0] + d[1]);
          return advance(s);
        }
        if (c.action === 'remote') {
          const id = c.airline;
          if (s.turn.remoteUsed || !AIRLINES[id] || !dominates(s, p, AIRLINES[id].g)) throw new Error('remote not allowed');
          s.turn.remoteUsed = true;
          done();
          s.phase = 'turnStart';
          visitAirline(s, p, id, true);
          if (s.pending) s.pending.returnToTurn = true;
          return advance(s);
        }
        if (c.action === 'sell') {
          sellAircraft(s, p, c.aircraftId, false);
          done();
          s.phase = 'turnStart';
          if (!checkSolvency(s, p, false)) return s;
          return advance(s);
        }
        if (c.action === 'repay') {
          const amt = Math.max(0, Math.min(pl.rcf, pl.cash, c.amount || pl.rcf));
          pl.rcf -= amt;
          pl.cash -= amt;
          log(s, `${pl.name} 偿还 RCF ${fmt(amt)}`, p);
          done();
          s.phase = 'turnStart';
          return advance(s);
        }
        throw new Error('bad turn action ' + c.action);
      }
      case 'jail': {
        done();
        if (c.action === 'card' && pl.passCard) {
          pl.passCard = false;
          pl.jail = 0;
          log(s, `${pl.name} 使用合规通行证离开审查`, p);
          s.pending = { type: 'turn', p };
          return s;
        }
        if (c.action === 'pay') {
          pay(s, p, JAIL_FEE);
          pl.jail = 0;
          log(s, `${pl.name} 支付 ${fmt(JAIL_FEE)} 合规整改费，离开审查`, p);
          s.pending = { type: 'turn', p };
          return s;
        }
        const d = rollDice(s);
        if (d[0] === d[1]) {
          pl.jail = 0;
          log(s, `${pl.name} 掷出双数 ${d[0]}+${d[1]}，审查通过`, p, 'roll');
          s.phase = 'afterSpace';
          s.turn.extraRoll = false;
          move(s, p, d[0] + d[1]);
          return advance(s);
        }
        pl.jail++;
        if (pl.jail > 3) {
          pay(s, p, JAIL_FEE);
          pl.jail = 0;
          log(s, `${pl.name} 审查满三轮，支付 ${fmt(JAIL_FEE)} 后出行`, p);
          s.phase = 'afterSpace';
          move(s, p, d[0] + d[1]);
          return advance(s);
        }
        log(s, `${pl.name} 掷出 ${d[0]}+${d[1]}，仍在审查中`, p, 'roll');
        s.phase = 'afterSpace';
        return advance(s);
      }
      case 'airline': {
        const id = pd.airline;
        const AD = AIRLINES[id];
        const finish = () => {
          done();
          if (pd.returnToTurn) s.phase = 'turnStart';
          return advance(s);
        };
        if (c.action === 'pass') return finish();
        if (c.action === 'framework') {
          const A = s.airlines[id];
          if (A.lessor !== p || A.framework || airlineFleet(s, p, id).length < 3) throw new Error('framework not allowed');
          const cost = frameworkCost(s, p, id);
          pay(s, p, cost);
          A.framework = true;
          log(s, `${pl.name} 与 ${AD.name} 签署长期框架协议，法律与结构费用 ${fmt(cost)}。竞标失败成本 ×1.5，续租概率 +30%`, p, 'deal');
          return finish();
        }
        if (c.action === 'buyout') {
          if (pd.mode !== 'rival') throw new Error('buyout only vs rival');
          const seller = s.airlines[id].lessor;
          const price = Math.max(0, c.price || 0);
          if (pl.cash + rcfAvail(s, p) < price) throw new Error('cannot afford');
          const fair = positionValue(s, seller, id);
          if (s.players[seller].human) {
            s.pending = { type: 'offer', p: seller, buyer: p, airline: id, price, fair, returnToTurn: pd.returnToTurn };
            return s;
          }
          if (price >= fair * s.players[seller].acceptPremium && price > 0) transferPosition(s, seller, p, id, price);
          else log(s, `${s.players[seller].name} 拒绝了 ${pl.name} 对 ${AD.name} 租约组合 ${fmt(price)} 的收购报价`, p, 'info');
          return finish();
        }
        if (c.action === 'sign') {
          if (pd.mode === 'rival') throw new Error('cannot sign at rival airline');
          const qt = quote(s, p, { ...c, airline: id });
          if (!qt.ok) throw new Error('sign invalid: ' + qt.why);
          if (!qt.affordable) throw new Error('sign unaffordable');
          if (pd.retry && qt.ratio > pd.maxRatio + 1e-9) throw new Error('retry must lower rate');
          pl.stats.bids++;
          const win = rand(s) < qt.acceptP;
          if (pl.referral) pl.referral = false;
          if (!win) {
            pay(s, p, BID_COST);
            log(s, `${AD.name} 拒绝了 ${pl.name} 的 ${TYPES[qt.typeId].name} 报价（LRF ${(qt.lrf * 100).toFixed(3)}%，成交概率 ${(qt.acceptP * 100).toFixed(0)}%），尽调成本 ${fmt(BID_COST)}`, p, 'bad');
            if (!pd.retry) {
              pd.retry = true;
              pd.maxRatio = qt.ratio - 0.01;
              pd.lastFail = qt.ratio;
              return s;
            }
            return finish();
          }
          executeSign(s, p, id, qt, c);
          pd.signed++;
          pd.retry = false;
          pd.maxRatio = 1.2;
          const more = pd.signed < pd.limit && canSignAt(s, p, id);
          if (!more) {
            const canFw = s.airlines[id].lessor === p && airlineFleet(s, p, id).length >= 3 && !s.airlines[id].framework;
            if (!canFw) return finish();
          }
          pd.mode = 'own';
          return s;
        }
        throw new Error('bad airline action ' + c.action);
      }
      case 'offer': {
        done();
        const buyer = pd.buyer;
        const seller = p;
        if (c.action === 'accept' && s.airlines[pd.airline].lessor === seller && s.players[buyer].cash + rcfAvail(s, buyer) >= pd.price) transferPosition(s, seller, buyer, pd.airline, pd.price);
        else log(s, `${pl.name} 拒绝了 ${s.players[buyer].name} 对 ${AIRLINES[pd.airline].name} 租约组合 ${fmt(pd.price)} 的收购报价`, seller, 'info');
        if (pd.returnToTurn) s.phase = 'turnStart';
        return advance(s);
      }
      case 'oem': {
        done();
        const o = s.oems[pd.oem];
        const O = OEMS[pd.oem];
        if (c.action === 'buy' && pd.mode === 'buy') {
          pay(s, p, O.price);
          o.owner = p;
          o.slots = O.slots;
          log(s, `${pl.name} 向 ${O.name} 下达大订单：${O.slots} 个交付位，预付款 ${fmt(O.price)}。使用交付位购机享 12% 折扣`, p, 'deal');
        } else if (c.action === 'topup' && pd.mode === 'topup') {
          const n = Math.max(1, Math.min(2, c.n || 1));
          pay(s, p, n * pd.price);
          o.slots += n;
          log(s, `${pl.name} 追加 ${n} 个 ${O.name} 交付位，${fmt(n * pd.price)}`, p, 'deal');
        }
        return advance(s);
      }
      case 'engine': {
        done();
        if (c.action === 'buy') {
          pay(s, p, pd.price);
          s.engines[pd.engine].owner = p;
          log(s, `${pl.name} 收购 ${ENGINES[pd.engine].name} 备发租赁平台 ${fmt(pd.price)}，每季度收入 ${fmt(ENGINES[pd.engine].income)}`, p, 'deal');
        }
        return advance(s);
      }
      case 'market': {
        if (c.action === 'sell') {
          sellAircraft(s, p, c.aircraftId, true);
          return s; // 可以继续卖
        }
        if (c.action === 'buy') {
          const T = TYPES[c.type];
          if (!T || T.age0 < 1) throw new Error('only used types on market');
          const price = typeValue(s, c.type, T.age0, T.engines[0]) * 1.02;
          const loan = price * 0.6;
          const outflow = price - loan;
          if (pl.cash + rcfAvail(s, p) < outflow) throw new Error('cannot afford');
          const ac = createAircraft(s, p, c.type, T.engines[0], T.age0);
          ac.loan = { principal: loan, spread: 0.025 + CYCLES[s.market.cycle].spread + pl.spreadAdj, amortQ: loan * 0.02, kind: 'bank' };
          pl.cash -= outflow;
          log(s, `${pl.name} 在二手平台购入闲置 ${T.name} MSN ${ac.msn}（${T.age0} 年机龄）${fmt(price)}，60% 银行融资`, p, 'deal');
          return s;
        }
        done();
        return advance(s);
      }
      case 'airshow': {
        if (c.action === 'visit' && (!AIRLINES[c.airline] || !canSignAt(s, p, c.airline))) throw new Error('该航司目前无法签约');
        done();
        if (c.action === 'visit') {
          log(s, `${pl.name} 在航展上会见 ${AIRLINES[c.airline].name}`, p);
          visitAirline(s, p, c.airline, true);
          if (s.pending) s.pending.airshow = true;
        }
        return advance(s);
      }
      case 'shortfall': {
        done();
        if (c.action === 'sell') sellAircraft(s, p, c.aircraftId, false, '被迫出售以弥补资金缺口');
        else if (c.action === 'sellEngine') {
          s.engines[c.id].owner = null;
          pl.cash += ENGINES[c.id].price * 0.7;
          log(s, `${pl.name} 出售 ${ENGINES[c.id].name} 备发平台，得 ${fmt(ENGINES[c.id].price * 0.7)}`, p);
        } else if (c.action === 'sellOem') {
          const o = s.oems[c.id];
          pl.cash += o.slots * (OEMS[c.id].price / OEMS[c.id].slots) * 0.5;
          s.oems[c.id] = { owner: null, slots: 0 };
          log(s, `${pl.name} 转让 ${OEMS[c.id].name} 订单`, p);
        } else if (c.action === 'bankrupt') bankrupt(s, p);
        if (pd.reason === 'covenant' && !pl.bankrupt) {
          if (leverage(s, p) <= 0.8) pl.breach = 0;
        }
        const ok = checkSolvency(s, p, pd.reason === 'covenant');
        if (!ok) return s;
        return advance(s);
      }
    }
    throw new Error('unknown pending ' + pd.type);
  }

  function frameworkCost(s, p, id) {
    return 1 + airlineFleet(s, p, id).reduce((t, a) => t + mv(s, a), 0) * 0.01;
  }

  function executeSign(s, p, id, qt, c) {
    const pl = s.players[p];
    const AD = AIRLINES[id];
    let ac;
    if (qt.source === 'idle') {
      ac = s.aircraft[c.aircraftId];
    } else {
      ac = createAircraft(s, p, qt.typeId, qt.engine, qt.age);
      if (qt.loan > 0) {
        const fin = financeTerms(s, p, qt.finance, qt.isNew, qt.typeId);
        ac.loan = { principal: qt.loan, spread: fin.spread, amortQ: qt.loan * fin.amort, kind: qt.finance };
      }
      if (qt.source === 'slot') s.oems[TYPES[qt.typeId].oem].slots--;
    }
    ac.lease = { airline: id, startQ: s.q, endQ: s.q + qt.term * 4, rentQ: qt.rentQ, lrf: qt.lrf, deposit: qt.deposit, mrBal: 0, deferred: 0, term: qt.term };
    pl.cash -= qt.outflow;
    s.airlines[id].lessor = p;
    pl.stats.deals++;
    pl.stats.bidsWon++;
    pl.stats.dealValue += qt.value;
    const src = { spot: '现货采购', slot: '自有交付位', slb: 'SLB 售后回租', idle: '闲置飞机再营销' }[qt.source];
    log(
      s,
      `✔ ${pl.name} 与 ${AD.name} 签约：${TYPES[qt.typeId].name}（${qt.engine}）MSN ${ac.msn}，${src}，${qt.term} 年，LRF ${(qt.lrf * 100).toFixed(3)}%，月租 ${fmt(qt.rentM)}，${qt.finLabel}${qt.loan > 0 ? ' ' + fmt(qt.loan) : ''}`,
      p,
      'deal'
    );
  }

  LT.engine = {
    newGame,
    advance,
    act,
    quote,
    signOptions,
    nav,
    mv,
    ageNow,
    typeValue,
    fleetValue,
    totalDebt,
    leverage,
    isIG,
    rcfAvail,
    landingFee,
    positionValue,
    airlineFleet,
    ownedAircraft,
    dominates,
    canSignAt,
    airlineOpen,
    marketLrf,
    financeTerms,
    saleProceeds,
    frameworkCost,
    sellables,
    qLabel,
    fmt,
    rand,
    BOARD_N,
    JAIL_POS,
    r2,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
