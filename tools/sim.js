// 批量 AI 对局：不变量检查 + 平衡统计。用法：node tools/sim.js [games=200] [years=10]
require('../src/data.js');
require('../src/engine.js');
require('../src/ai.js');
const { engine: E, ai: AI, data: D } = globalThis.LT;

const N = +process.argv[2] || 200;
const YEARS = +process.argv[3] || 10;
// HUMAN=1：0 号座位标记为人类（由 AerCap 策略代打），覆盖 offer 决策与人类破产提前结束
const HUMAN = process.env.HUMAN === '1';

// 季度推进且当前不是 shortfall 决策 = 偿付阶段已结束，此时不得有未处理的负现金
function checkSolvencyDone(s, qBefore, where) {
  if (s.q === qBefore || (s.pending && s.pending.type === 'shortfall')) return;
  for (const p of s.players) if (!p.bankrupt && p.cash < -1e-6) throw new Error(`${where}: ${p.name} negative cash ${p.cash.toFixed(2)} after solvency`);
}
function checkInvariants(s, where) {
  for (const p of s.players) {
    for (const k of ['cash', 'rcf', 'rcfLimit']) if (!Number.isFinite(p[k])) throw new Error(`${where}: ${p.name}.${k} = ${p[k]}`);
    if (p.rcf > p.rcfLimit + 1e-6) throw new Error(`${where}: rcf over limit`);
  }
  for (const a of Object.values(s.aircraft)) {
    if (s.players[a.owner].bankrupt) throw new Error(`${where}: aircraft owned by bankrupt`);
    if (a.lease && !D.AIRLINES[a.lease.airline]) throw new Error(`${where}: bad lease airline`);
    if (a.lease && s.airlines[a.lease.airline].lessor !== a.owner) throw new Error(`${where}: lease at ${a.lease.airline} owner ${a.owner} but lessor ${s.airlines[a.lease.airline].lessor}`);
    if (a.loan && !(a.loan.principal >= 0)) throw new Error(`${where}: bad loan`);
    if (!Number.isFinite(E.mv(s, a))) throw new Error(`${where}: mv NaN`);
  }
  for (const id in s.airlines) {
    const L = s.airlines[id].lessor;
    if (L != null && !E.airlineFleet(s, L, id).length) throw new Error(`${where}: ${id} locked by ${L} with no fleet`);
  }
}

const agg = { games: 0, turns: 0, bankrupt: 0, winners: {}, nav: [], rent: 0, feeIn: 0, interest: 0, deals: 0, aircraft: 0, defaults: 0, lateDecisions: 0, lateTurns: 0, errors: 0, lengths: [], openAirlinesEnd: 0, buyouts: 0, offers: 0 };
const t0 = Date.now();
for (let g = 0; g < N; g++) {
  const seat0 = HUMAN ? { human: true, ai: 'aercap', name: '长空租赁' } : { ai: 'aercap' };
  const s = E.newGame({ seed: 1000 + g, years: YEARS, endOnHumanBankrupt: HUMAN, players: [seat0, { ai: 'smbc' }, { ai: 'avolon' }, { ai: 'boca' }] });
  let steps = 0;
  try {
    E.advance(s);
    while (!s.over) {
      if (++steps > 20000) throw new Error('step cap');
      const pd = s.pending;
      const late = s.q >= s.maxQ * 0.6;
      if (late && pd.type === 'turn' && !pd.again) agg.lateTurns++;
      if (late && ['airline', 'oem', 'engine', 'airshow'].includes(pd.type) && pd.mode !== 'rival') agg.lateDecisions++;
      if (pd.type === 'offer') agg.offers++;
      const choice = AI.decide(s, pd);
      const qBefore = s.q;
      E.act(s, choice);
      checkInvariants(s, `game ${g} q${s.q}`);
      checkSolvencyDone(s, qBefore, `game ${g} q${s.q}`);
    }
  } catch (e) {
    agg.errors++;
    if (agg.errors <= 5) console.error(`game ${g} seed ${1000 + g}:`, e.message, '\n', e.stack.split('\n').slice(1, 4).join('\n'));
    continue;
  }
  agg.games++;
  agg.turns += steps;
  agg.lengths.push(s.q);
  agg.winners[s.players[s.winner].name] = (agg.winners[s.players[s.winner].name] || 0) + 1;
  for (const p of s.players) {
    if (p.bankrupt) agg.bankrupt++;
    else agg.nav.push(E.nav(s, p.id));
    agg.rent += p.stats.rent;
    agg.feeIn += p.stats.feeIn;
    agg.interest += p.stats.interest;
    agg.deals += p.stats.deals;
    agg.defaults += p.stats.defaultsHit;
  }
  agg.aircraft += Object.keys(s.aircraft).length;
  agg.openAirlinesEnd += Object.keys(s.airlines).filter((id) => s.airlines[id].lessor == null).length;
  agg.buyouts += s.log.filter((l) => l.text.includes('收购') && l.text.includes('带租约飞机')).length;
}
const pct = (arr, q) => {
  const a = arr.slice().sort((x, y) => x - y);
  return a.length ? a[Math.floor((a.length - 1) * q)] : NaN;
};
const P = agg.games * 4;
console.log(`games ok ${agg.games}/${N}  errors ${agg.errors}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
console.log(`avg decisions/game ${(agg.turns / agg.games).toFixed(0)}  avg quarters ${(agg.lengths.reduce((a, b) => a + b, 0) / agg.games).toFixed(1)}`);
console.log(`bankrupt rate ${((agg.bankrupt / P) * 100).toFixed(1)}%`);
console.log(`winners`, agg.winners);
console.log(`NAV p10 ${pct(agg.nav, 0.1).toFixed(0)}  p50 ${pct(agg.nav, 0.5).toFixed(0)}  p90 ${pct(agg.nav, 0.9).toFixed(0)}  (start 150)`);
console.log(`per player: rent ${(agg.rent / P).toFixed(0)}  landing fees in ${(agg.feeIn / P).toFixed(0)}  interest ${(agg.interest / P).toFixed(0)}  deals ${(agg.deals / P).toFixed(1)}  defaults hit ${(agg.defaults / P).toFixed(1)}`);
console.log(`aircraft at end/game ${(agg.aircraft / agg.games).toFixed(1)}  open airlines at end ${(agg.openAirlinesEnd / agg.games).toFixed(1)}/25  buyouts/game ${(agg.buyouts / agg.games).toFixed(2)}`);
console.log(`offers to human seat ${agg.offers}  games ended early ${agg.lengths.filter((q) => q < YEARS * 4).length}`);
console.log(`late-game real decisions per turn ${(agg.lateDecisions / Math.max(1, agg.lateTurns)).toFixed(2)}`);
