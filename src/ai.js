// AI 租赁公司：对 state.pending 给出选择，和人类走同一个 act() 接口。
(function (root) {
  const LT = (root.LT = root.LT || {});
  const D = LT.data;
  const E = LT.engine;
  const { AIRLINES, TYPES, OEMS, ENGINES } = D;

  const profileOf = (s, p) => D.AI_PROFILES[s.players[p].ai] || D.AI_PROFILES.avolon;
  const liquidity = (s, p) => s.players[p].cash + E.rcfAvail(s, p) * 0.5;

  // 在某航司找最优签约方案
  function bestSign(s, p, airlineId, maxRatio) {
    const prof = profileOf(s, p);
    const A = s.airlines[airlineId];
    if (A.rating > prof.minRating) return null;
    const opts = E.signOptions(s, p, airlineId);
    const ratio = Math.min(maxRatio || 1.2, prof.lrfRatio);
    const fins = ['eca', 'unsecured', 'bank'];
    let best = null;
    const consider = (params) => {
      const q = E.quote(s, p, { ...params, airline: airlineId, ratio });
      if (!q.ok || !q.affordable) return;
      const after = s.players[p].cash - q.outflow;
      if (after + E.rcfAvail(s, p) * 0.3 < prof.reserve) return;
      let score = q.roe * q.acceptP;
      if (prof.prefer && AIRLINES[airlineId].g === prof.prefer) score *= 1.2;
      if (params.source === 'idle') score += 1; // 优先把闲置飞机租出去
      if (!best || score > best.score) best = { score, params: { ...params, ratio }, q };
    };
    for (const id of opts.idle) {
      const ac = s.aircraft[id];
      const terms = [3, 5, 7, 6, 8, 10, 12];
      for (const term of terms) consider({ source: 'idle', aircraftId: id, term, type: ac.type });
    }
    for (const t of opts.types) {
      for (const source of t.sources) {
        for (const engine of t.engines) {
          const term = t.terms[Math.min(t.terms.length - 1, prof.bold > 0.6 ? 2 : 1)];
          for (const finance of fins) consider({ type: t.typeId, engine, source, term, finance, ltv: prof.ltv + (finance === 'eca' ? 0.1 : 0) });
        }
      }
    }
    return best;
  }

  function decide(s, pd) {
    const p = pd.p;
    const pl = s.players[p];
    const prof = profileOf(s, p);
    switch (pd.type) {
      case 'turn': {
        if (pl.rcf > 0 && pl.cash > prof.reserve + 10) return { action: 'repay', amount: Math.min(pl.rcf, pl.cash - prof.reserve - 5) };
        if (!s.turn.remoteUsed) {
          for (const id in AIRLINES) {
            if (!E.dominates(s, p, AIRLINES[id].g) || !E.canSignAt(s, p, id)) continue;
            if (bestSign(s, p, id)) return { action: 'remote', airline: id };
          }
        }
        return { action: 'roll' };
      }
      case 'jail':
        if (pl.passCard) return { action: 'card' };
        if (pl.cash > prof.reserve + 5) return { action: 'pay' };
        return { action: 'roll' };
      case 'airline': {
        if (pd.mode === 'rival') {
          const seller = s.airlines[pd.airline].lessor;
          if (seller == null) return { action: 'pass' };
          const fair = E.positionValue(s, seller, pd.airline);
          const price = Math.max(1, fair * (1.06 + prof.bold * 0.08));
          const A = s.airlines[pd.airline];
          const chance = E.rand(s) < prof.bold * 0.35;
          if (chance && A.rating <= prof.minRating && liquidity(s, p) - price > prof.reserve + 20) return { action: 'buyout', price: Math.round(price * 10) / 10 };
          return { action: 'pass' };
        }
        const b = bestSign(s, p, pd.airline, pd.retry ? pd.maxRatio - 0.02 : null);
        if (b && E.canSignAt(s, p, pd.airline)) {
          if (pd.retry) b.params.ratio = Math.min(b.params.ratio, pd.maxRatio - 0.02);
          return { action: 'sign', ...b.params };
        }
        const A = s.airlines[pd.airline];
        if (A.lessor === p && !A.framework && E.airlineFleet(s, p, pd.airline).length >= 3) {
          const cost = E.frameworkCost(s, p, pd.airline);
          if (pl.cash - cost > prof.reserve + 5) return { action: 'framework' };
        }
        return { action: 'pass' };
      }
      case 'oem': {
        const O = OEMS[pd.oem];
        if (pd.mode === 'buy' && pl.cash > prof.reserve + O.price + 15 && E.rand(s) < 0.4 + prof.bold * 0.5) return { action: 'buy' };
        if (pd.mode === 'topup' && s.oems[pd.oem].slots < 2 && pl.cash > prof.reserve + 20) return { action: 'topup', n: 1 };
        return { action: 'pass' };
      }
      case 'engine':
        if (pl.cash > prof.reserve + pd.price + 20 && E.rand(s) < 0.3 + prof.bold * 0.5) return { action: 'buy' };
        return { action: 'pass' };
      case 'market': {
        if (pl.cash < 0 || E.leverage(s, p) > 0.8) {
          const list = E.ownedAircraft(s, p)
            .map((a) => ({ a, net: E.saleProceeds(s, a, true).net }))
            .filter((x) => x.net > 0)
            .sort((x, y) => y.net - x.net);
          if (list.length) return { action: 'sell', aircraftId: list[0].a.id };
        }
        return { action: 'pass' };
      }
      case 'airshow': {
        let best = null;
        for (const id in AIRLINES) {
          if (!E.canSignAt(s, p, id)) continue;
          const b = bestSign(s, p, id);
          if (b && (!best || b.score > best.score)) best = { id, score: b.score };
        }
        return best ? { action: 'visit', airline: best.id } : { action: 'pass' };
      }
      case 'shortfall': {
        const items = E.sellables(s, p).filter((i) => i.net > 0);
        if (!items.length) return { action: 'bankrupt' };
        // 优先卖闲置飞机和收益最低的资产；缺口大时卖净回款最多的
        const gap = pd.gap || 0;
        const idle = items.filter((i) => i.kind === 'aircraft' && !s.aircraft[i.id].lease);
        const pick = idle.length ? idle.sort((a, b) => b.net - a.net)[0] : items.filter((i) => i.net >= gap).sort((a, b) => a.net - b.net)[0] || items.sort((a, b) => b.net - a.net)[0];
        if (pick.kind === 'engine') return { action: 'sellEngine', id: pick.id };
        if (pick.kind === 'oem') return { action: 'sellOem', id: pick.id };
        return { action: 'sell', aircraftId: pick.id };
      }
      case 'offer':
        return { action: pd.price >= pd.fair * pl.acceptPremium ? 'accept' : 'reject' };
    }
    return { action: 'pass' };
  }

  LT.ai = { decide, bestSign };
})(typeof globalThis !== 'undefined' ? globalThis : this);
