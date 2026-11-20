/* Agent Receipts, UI. Depends on receipts.js (window.AgentReceipts). */
'use strict';

const AR = window.AgentReceipts;
const $ = sel => document.querySelector(sel);

let receipts = [];          // current working copy (tamper mode edits this)
let originalSeal = null;    // seal at run time
let tamperMode = false;
let currentTitle = '';

const short = h => h.slice(0, 10) + '…' + h.slice(-6);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderPicker() {
  const picker = $('#episode-picker');
  picker.innerHTML = '';
  for (const [key, ep] of Object.entries(AR.EPISODES)) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.textContent = 'Run: ' + ep.title;
    btn.onclick = () => runEpisode(key);
    picker.appendChild(btn);
  }
}

async function runEpisode(key) {
  const ep = AR.EPISODES[key];
  currentTitle = ep.title;
  receipts = await AR.buildChain(ep.steps);
  originalSeal = receipts.length ? receipts[receipts.length - 1].hash : AR.GENESIS;
  tamperMode = false;
  updateTamperButton();
  $('#tamper-hint').hidden = true;
  $('#seal-panel').hidden = false;
  $('#toolbar').hidden = false;
  renderAll(await AR.verifyChain(receipts), null);
}

function statusBadge(status) {
  const map = {
    ok: ['ok', 'sealed'],
    tampered: ['bad', 'tampered'],
    'broken-link': ['bad', 'broken link'],
    'bad-index': ['bad', 'bad index'],
    invalidated: ['warn', 'invalidated'],
    'replay-match': ['ok', 'replay match'],
    'replay-mismatch': ['bad', 'replay mismatch'],
    'receipt-only': ['warn', 'receipt only'],
    'unknown-tool': ['bad', 'unknown tool'],
  };
  const [cls, text] = map[status] || ['warn', status];
  return `<span class="badge badge-${cls}">${text}</span>`;
}

function renderAll(verification, replayResults) {
  // seal panel
  $('#seal-value').textContent = originalSeal;
  const current = verification.seal;
  const sealStatus = $('#seal-status');
  if (verification.ok) {
    sealStatus.innerHTML = `<span class="badge badge-ok">chain intact</span>`;
  } else {
    sealStatus.innerHTML =
      `<span class="badge badge-bad">broken at step ${verification.firstBad}</span>` +
      (current !== originalSeal
        ? `<span class="badge badge-warn">seal changed: <code>${escapeHtml(short(current))}</code></span>`
        : '');
  }

  // chain
  const chain = $('#chain');
  chain.innerHTML = '';
  receipts.forEach((r, i) => {
    const vStatus = verification.results[i] ? verification.results[i].status : 'ok';
    const rp = replayResults ? replayResults.find(x => x.index === i) : null;
    const card = document.createElement('article');
    card.className = 'receipt ' + (vStatus === 'ok' ? '' : vStatus === 'invalidated' ? 'is-warn' : 'is-bad');

    const outputJson = JSON.stringify(r.output, null, 2);
    const outputBlock = tamperMode
      ? `<textarea class="output-edit" data-index="${i}" rows="${Math.min(8, outputJson.split('\n').length + 1)}">${escapeHtml(outputJson)}</textarea>`
      : `<pre>${escapeHtml(outputJson)}</pre>`;

    card.innerHTML = `
      <header>
        <span class="step-num">#${i}</span>
        <span class="tool-name">${escapeHtml(r.tool)}</span>
        <span class="tool-label">${escapeHtml((AR.TOOLS[r.tool] || {}).label || '')}</span>
        <span class="badges">${statusBadge(vStatus)}${rp ? statusBadge(rp.status) : ''}${r.replayable ? '' : '<span class="badge badge-ghost">side effect</span>'}</span>
      </header>
      <div class="io">
        <div><p class="label">input</p><pre>${escapeHtml(JSON.stringify(r.input, null, 2))}</pre></div>
        <div><p class="label">output</p>${outputBlock}</div>
      </div>
      <footer>
        <span class="hash">prev <code>${escapeHtml(short(r.prev))}</code></span>
        <span class="arrow">→</span>
        <span class="hash">receipt <code>${escapeHtml(short(r.hash))}</code></span>
      </footer>`;
    chain.appendChild(card);
  });

  if (tamperMode) {
    chain.querySelectorAll('.output-edit').forEach(ta => {
      ta.addEventListener('change', async () => {
        const idx = Number(ta.dataset.index);
        try {
          receipts[idx].output = JSON.parse(ta.value);
          ta.classList.remove('invalid');
        } catch (e) {
          ta.classList.add('invalid');
          return;
        }
        renderAll(await AR.verifyChain(receipts), null);
      });
    });
  }
}

function updateTamperButton() {
  $('#btn-tamper').textContent = 'Tamper mode: ' + (tamperMode ? 'on' : 'off');
}

$('#btn-verify').addEventListener('click', async () => {
  renderAll(await AR.verifyChain(receipts), null);
});

$('#btn-replay').addEventListener('click', async () => {
  const verification = await AR.verifyChain(receipts);
  renderAll(verification, AR.replay(receipts));
});

$('#btn-tamper').addEventListener('click', async () => {
  tamperMode = !tamperMode;
  updateTamperButton();
  $('#tamper-hint').hidden = !tamperMode;
  renderAll(await AR.verifyChain(receipts), null);
});

$('#btn-export').addEventListener('click', () => {
  const data = AR.exportChain(currentTitle, receipts);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'agent-receipts.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

$('#import-file').addEventListener('change', async ev => {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.format !== 'agent-receipts/1' || !Array.isArray(data.receipts)) throw new Error('bad format');
    receipts = data.receipts;
    currentTitle = data.title || 'imported episode';
    originalSeal = data.seal;
    tamperMode = false;
    updateTamperButton();
    $('#seal-panel').hidden = false;
    $('#toolbar').hidden = false;
    renderAll(await AR.verifyChain(receipts), AR.replay(receipts));
  } catch (e) {
    alert('That file is not a valid agent-receipts export.');
  }
  ev.target.value = '';
});

renderPicker();
