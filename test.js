/* Node test suite for the Agent Receipts core. Run: node test.js */
'use strict';
const AR = require('./receipts.js');

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('PASS  ' + name); }
  else { failed++; console.log('FAIL  ' + name); }
}

(async () => {
  // 1. Build both built-in episodes.
  for (const key of Object.keys(AR.EPISODES)) {
    const receipts = await AR.buildChain(AR.EPISODES[key].steps);
    check(key + ': builds ' + AR.EPISODES[key].steps.length + ' receipts',
      receipts.length === AR.EPISODES[key].steps.length);
    check(key + ': genesis link', receipts[0].prev === AR.GENESIS);
    check(key + ': links chain', receipts.every((r, i) => i === 0 || r.prev === receipts[i - 1].hash));
    const v = await AR.verifyChain(receipts);
    check(key + ': verifies clean', v.ok === true);
    check(key + ': seal is last hash', v.seal === receipts[receipts.length - 1].hash);
  }

  const receipts = await AR.buildChain(AR.EPISODES['plan-trip'].steps);

  // 2. Determinism: building twice gives identical hashes.
  const again = await AR.buildChain(AR.EPISODES['plan-trip'].steps);
  check('deterministic: identical seal on rebuild', again[again.length - 1].hash === receipts[receipts.length - 1].hash);

  // 3. Tamper with an output -> verification flags exactly that index.
  const tampered = JSON.parse(JSON.stringify(receipts));
  tampered[2].output = { pair: 'USD->INR', rate: 1, amount: 120 };
  const vt = await AR.verifyChain(tampered);
  check('tamper detected at index 2', vt.ok === false && vt.firstBad === 2 && vt.results[2].status === 'tampered');
  check('later receipts invalidated', vt.results[3].status === 'invalidated' && vt.results[4].status === 'invalidated');
  check('earlier receipts still ok', vt.results[0].status === 'ok' && vt.results[1].status === 'ok');

  // 4. Break a stored hash -> broken link caught downstream.
  const cut = JSON.parse(JSON.stringify(receipts));
  cut[1].hash = 'f'.repeat(64);
  const vc = await AR.verifyChain(cut);
  check('hash edit flagged at index 1', vc.results[1].status === 'tampered');

  // 5. Replay: deterministic tools match, side effect is receipt-only.
  const rp = AR.replay(receipts);
  check('replay matches replayable steps', rp.filter(r => r.status === 'replay-match').length === 4);
  check('side effect marked receipt-only', rp[4].status === 'receipt-only');
  const rpT = AR.replay(tampered);
  check('replay catches tampered output', rpT[2].status === 'replay-mismatch');

  // 6. Export / import round trip.
  const exported = AR.exportChain('round trip', receipts);
  const imported = JSON.parse(JSON.stringify(exported));
  const vi = await AR.verifyChain(imported.receipts);
  check('export round-trips and verifies', vi.ok === true && exported.seal === imported.receipts[imported.receipts.length - 1].hash);

  // 7. Unknown tool rejected.
  let threw = false;
  try { await AR.buildChain([{ tool: 'wire_money', input: {} }]); } catch (e) { threw = true; }
  check('unknown tool rejected', threw);

  // 8. calculate refuses non-arithmetic.
  check('calculate refuses injection', AR.TOOLS.calculate.run({ expression: 'process.exit(1)' }).error !== undefined);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
