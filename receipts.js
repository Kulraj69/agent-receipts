/*
 * Agent Receipts, core library.
 * Deterministic demo tools + hash-chained, tamper-evident receipts.
 * Runs in the browser (WebCrypto) and in Node (for tests).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AgentReceipts = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const GENESIS = '0'.repeat(64);

  async function sha256Hex(text) {
    if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    const { createHash } = require('crypto');
    return createHash('sha256').update(text, 'utf8').digest('hex');
  }

  // Deterministic JSON: object keys sorted at every depth.
  function stable(value) {
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
    }
    return JSON.stringify(value);
  }

  // ---- Demo tool registry (fixed data, so replay is meaningful) ----

  const FLIGHTS = [
    { from: 'BLR', to: 'DEL', airline: 'IndiGo', depart: '06:10', arrive: '08:55', price_inr: 4820 },
    { from: 'BLR', to: 'DEL', airline: 'Air India', depart: '14:25', arrive: '17:10', price_inr: 5450 },
    { from: 'BLR', to: 'GOI', airline: 'IndiGo', depart: '09:40', arrive: '10:50', price_inr: 3120 },
    { from: 'BLR', to: 'BOM', airline: 'Akasa', depart: '07:15', arrive: '09:00', price_inr: 3890 },
    { from: 'DEL', to: 'GOI', airline: 'Vistara', depart: '11:05', arrive: '13:35', price_inr: 6210 },
  ];

  const WEATHER = {
    goa: { summary: 'Humid, 31C, evening showers', good_for: 'beach mornings' },
    delhi: { summary: 'Hazy, 26C', good_for: 'museums at noon' },
    mumbai: { summary: 'Coastal, 30C, light breeze', good_for: 'late walks' },
    bengaluru: { summary: 'Mild, 24C', good_for: 'everything' },
  };

  const RATES = {
    'USD->INR': 84.2,
    'INR->USD': 1 / 84.2,
    'EUR->INR': 88.7,
    'INR->EUR': 1 / 88.7,
  };

  function searchFlights(input) {
    const from = String(input.from || '').toUpperCase();
    const to = String(input.to || '').toUpperCase();
    const found = FLIGHTS.filter(f => f.from === from && f.to === to);
    return found.length ? { results: found } : { note: 'no flights in demo dataset for ' + from + '->' + to };
  }

  function getWeather(input) {
    const city = String(input.city || '').toLowerCase();
    return WEATHER[city] || { note: 'no demo weather for ' + city };
  }

  function convertCurrency(input) {
    const pair = (String(input.from || '') + '->' + String(input.to || '')).toUpperCase();
    const rate = RATES[pair];
    if (!rate || typeof input.amount !== 'number') return { note: 'no demo rate for ' + pair };
    return { pair, rate: +rate.toFixed(6), amount: +(input.amount * rate).toFixed(2) };
  }

  function calculate(input) {
    const expr = String(input.expression || '');
    if (!/^[0-9+\-*/().\s]+$/.test(expr) || !expr.trim()) return { error: 'only arithmetic allowed' };
    const value = Function('"use strict"; return (' + expr + ')')();
    if (typeof value !== 'number' || !isFinite(value)) return { error: 'not a finite number' };
    return { value };
  }

  // Side-effecting step: cannot be honestly replayed, so the receipt is the only record.
  function sendSummary(input) {
    const text = String(input.text || '');
    return { status: 'queued', to: String(input.to || ''), chars: text.length };
  }

  const TOOLS = {
    search_flights: { run: searchFlights, replayable: true, label: 'Search flights (demo data)' },
    get_weather: { run: getWeather, replayable: true, label: 'Get weather (demo data)' },
    convert_currency: { run: convertCurrency, replayable: true, label: 'Convert currency (fixed rates)' },
    calculate: { run: calculate, replayable: true, label: 'Calculate' },
    send_summary: { run: sendSummary, replayable: false, label: 'Send summary (side effect)' },
  };

  // ---- Built-in demo episodes ----

  const EPISODES = {
    'plan-trip': {
      title: 'Plan a weekend trip',
      steps: [
        { tool: 'search_flights', input: { from: 'BLR', to: 'GOI' } },
        { tool: 'get_weather', input: { city: 'goa' } },
        { tool: 'convert_currency', input: { amount: 120, from: 'USD', to: 'INR' } },
        { tool: 'calculate', input: { expression: '(3120 + 950) * 2' } },
        { tool: 'send_summary', input: { to: 'founder', text: 'Goa weekend: IndiGo 09:40, humid 31C, budget ~8140 INR.' } },
      ],
    },
    'launch-budget': {
      title: 'Price a launch weekend',
      steps: [
        { tool: 'calculate', input: { expression: '49 * 12 + 199' } },
        { tool: 'convert_currency', input: { amount: 787, from: 'EUR', to: 'INR' } },
        { tool: 'get_weather', input: { city: 'bengaluru' } },
        { tool: 'send_summary', input: { to: 'co-founder', text: 'Launch budget sealed: EUR 787 ~ 69,807 INR, weather mild in Bengaluru.' } },
      ],
    },
  };

  // ---- Receipt chain ----

  function receiptBody(r) {
    return { index: r.index, tool: r.tool, input: r.input, output: r.output, prev: r.prev };
  }

  async function buildChain(steps) {
    const receipts = [];
    let prev = GENESIS;
    for (let i = 0; i < steps.length; i++) {
      const spec = TOOLS[steps[i].tool];
      if (!spec) throw new Error('unknown tool: ' + steps[i].tool);
      const output = spec.run(steps[i].input);
      const body = { index: i, tool: steps[i].tool, input: steps[i].input, output, prev };
      const hash = await sha256Hex(stable(body));
      receipts.push(Object.assign({}, body, { hash, replayable: spec.replayable }));
      prev = hash;
    }
    return receipts;
  }

  // Recompute every hash from the stored fields. A receipt is only valid if its
  // stored hash matches the recomputation AND it links to the previous hash.
  async function verifyChain(receipts) {
    let prev = GENESIS;
    const results = [];
    let firstBad = -1;
    for (let i = 0; i < receipts.length; i++) {
      const r = receipts[i];
      let status = 'ok';
      if (r.index !== i) status = 'bad-index';
      else if (r.prev !== prev) status = 'broken-link';
      else {
        const hash = await sha256Hex(stable(receiptBody(r)));
        if (hash !== r.hash) status = 'tampered';
      }
      if (status !== 'ok' && firstBad === -1) firstBad = i;
      if (firstBad !== -1 && i > firstBad && status === 'ok') status = 'invalidated';
      results.push({ index: i, status });
      prev = r.hash;
    }
    return { ok: firstBad === -1, firstBad, results, seal: prev };
  }

  // Re-execute replayable tools and compare against the recorded outputs.
  function replay(receipts) {
    return receipts.map(r => {
      const spec = TOOLS[r.tool];
      if (!spec) return { index: r.index, status: 'unknown-tool' };
      if (!spec.replayable) return { index: r.index, status: 'receipt-only' };
      const got = spec.run(r.input);
      const match = stable(got) === stable(r.output);
      return { index: r.index, status: match ? 'replay-match' : 'replay-mismatch', got };
    });
  }

  function exportChain(title, receipts) {
    return {
      format: 'agent-receipts/1',
      title: title || 'untitled episode',
      exported_at: new Date().toISOString(),
      steps: receipts.map(r => ({ tool: r.tool, input: r.input })),
      receipts,
      seal: receipts.length ? receipts[receipts.length - 1].hash : GENESIS,
    };
  }

  return { GENESIS, TOOLS, EPISODES, sha256Hex, stable, buildChain, verifyChain, replay, exportChain };
});
