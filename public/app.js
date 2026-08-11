const $ = (sel) => document.querySelector(sel);

const DISCOVER_API = '/api/discover';
const TEST_ONE_API = '/api/test-one';
const TEST_ALL_API = '/api/test-all';

const state = { descriptors: [], testResults: {} };

function showLoading() { $('#loading').style.display = 'block'; }
function hideLoading() { $('#loading').style.display = 'none'; }
function hideEmpty() { $('#empty').style.display = 'none'; }

function updateStats(descriptors) {
  $('#status-bar').style.display = descriptors.length > 0 ? 'flex' : 'none';
  if (descriptors.length === 0) return;

  const standalone = descriptors.filter(d => d.descriptor?.service);
  let tested = 0, passed = 0, failed = 0;
  for (const d of descriptors) {
    const tr = state.testResults[d.eventId];
    if (tr) {
      tested++;
      if (tr.validation?.valid) passed++; else failed++;
    }
  }

  $('#stat-total').textContent = descriptors.length;
  $('#stat-standalone').textContent = standalone.length;
  $('#stat-discovery').textContent = descriptors.length - standalone.length;
  $('#stat-tested').textContent = tested;
  $('#stat-pass').textContent = passed;
  $('#stat-fail').textContent = failed;
}

function renderDiscoveryResults(descriptors) {
  const container = $('#results');
  container.innerHTML = descriptors.map((d, idx) => renderCard(d, idx)).join('');

  // Card header click toggles body
  document.querySelectorAll('.card-header').forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.closest('.test-btn')) return;
      const card = header.parentElement;
      const body = card.querySelector('.card-body');
      const icon = header.querySelector('.toggle-icon');
      body.classList.toggle('open');
      if (icon) icon.textContent = body.classList.contains('open') ? '\u2212' : '+';
    });
  });

  // Test button click
  document.querySelectorAll('.test-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const card = btn.closest('.descriptor-card');
      const eventId = card.dataset.eventId;
      await runSingleTest(eventId, card);
    });
  });

  // Test All button
  document.querySelectorAll('.test-all-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await runAllTests();
    });
  });
}

function renderCard(entry, idx) {
  const desc = entry.descriptor || {};
  const type = desc.escrow_type || 'unknown';
  const pubkey = (entry.pubkey || '').slice(0, 12) + '...';
  const networks = Array.isArray(desc.networks) ? desc.networks.join(', ') : '?';
  const version = desc.version ?? '?';
  const relays = (entry.seenOn || []).join(', ') || '?';
  const hasService = !!(desc.service);
  const endpoint = desc.service?.endpoint || '';

  const existingResult = state.testResults[entry.eventId];
  let statusBadge = '';
  let bodyHtml = '';

  if (existingResult) {
    const isPass = existingResult.validation?.valid;
    const fCount = existingResult.validation?.results?.filter(r => r.status === 'fail').length || 0;
    statusBadge = isPass
      ? '<span class="badge badge-pass">PASS</span>'
      : `<span class="badge badge-fail">${fCount} FAILURE${fCount !== 1 ? 'S' : ''}</span>`;

    bodyHtml = renderTestResults(existingResult);
  }

  const standaloneBadge = hasService
    ? '<span class="badge badge-standalone">STANDALONE</span>'
    : '<span class="badge badge-discovery">DISCOVERY-ONLY</span>';

  const isTested = !!existingResult;
  const isTesting = cardIsTesting(entry.eventId);

  return `<div class="descriptor-card" data-event-id="${escapeHtml(entry.eventId)}">
    <div class="card-header">
      <div style="display:flex;align-items:center;gap:10px">
        <span class="toggle-icon" style="color:#8b949e;font-size:16px;width:20px;text-align:center">+</span>
        <div class="card-title">
          <span class="type">${escapeHtml(type)}</span>
          ${statusBadge} ${standaloneBadge}
        </div>
      </div>
      <div class="card-meta">
        <span>v${version}</span>
        <span>${escapeHtml(networks)}</span>
        <span class="pubkey">${pubkey}</span>
        ${isTesting
          ? '<span class="spinner" style="width:16px;height:16px;border-width:2px;margin:0 4px"></span>'
          : `<button class="test-btn${hasService ? ' primary' : ''}" style="padding:4px 10px;font-size:11px;margin-left:8px" ${isTested ? '' : ''}>${isTested ? 'Re-Test' : 'Test'}</button>`}
      </div>
    </div>
    <div class="card-body${isTested ? ' open' : ''}">
      <div class="section-title">Descriptor Info</div>
      <div class="result-row">
        <span class="result-field">Event ID</span>
        <span class="result-message">${escapeHtml(entry.eventId || '?')}</span>
      </div>
      <div class="result-row">
        <span class="result-field">Published at</span>
        <span class="result-message">${entry.created_at ? new Date(entry.created_at * 1000).toISOString() : '?'}</span>
      </div>
      <div class="result-row">
        <span class="result-field">Seen on</span>
        <span class="result-message">${escapeHtml(relays)}</span>
      </div>
      ${endpoint ? `<div class="result-row"><span class="result-field">Endpoint</span><span class="result-message">${escapeHtml(endpoint)}</span></div>` : ''}
      ${bodyHtml}
    </div>
  </div>`;
}

function renderTestResults(result) {
  let html = '';
  const val = result.validation || {};
  const svc = result.serviceReport;

  if (val.results && val.results.length > 0) {
    html += '<div class="section-title">PIP-01 Validation</div>';
    html += val.results.map(r => {
      const icon = r.status === 'pass' ? '\u2713' : r.status === 'fail' ? '\u2717' : '\u26A0';
      return `<div class="result-row">
        <span class="result-icon ${r.status}">${icon}</span>
        <span class="result-field">${escapeHtml(r.field)}</span>
        <span class="result-message">${escapeHtml(r.message)}</span>
      </div>`;
    }).join('');
  }

  if (svc && !svc.skip && svc.results.length > 0) {
    html += `<div class="section-title">Service Tests \u2014 ${escapeHtml(svc.endpoint)}</div>`;
    html += svc.results.map(r => {
      const icon = r.pass ? '\u2713' : '\u2717';
      return `<div class="service-test-result">
        <span class="result-icon ${r.pass ? 'pass' : 'fail'}">${icon}</span>
        <span class="service-test-label">${escapeHtml(r.label)}</span>
        <span class="service-test-detail">${escapeHtml(r.detail || '')}</span>
      </div>`;
    }).join('');
  } else if (svc && svc.skip) {
    html += '<div class="section-title">Service Tests</div>';
    html += `<div class="result-row"><span class="result-message" style="color:#8b949e">Skipped: ${escapeHtml(svc.reason)}</span></div>`;
  }

  if (!html) {
    html = '<div class="result-row"><span class="result-message" style="color:#8b949e">No test results yet</span></div>';
  }

  return html;
}

function escapeHtml(str) {
  const s = String(str);
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const _testingCards = new Set();
function cardIsTesting(eventId) { return _testingCards.has(eventId); }
function setCardTesting(eventId, val) {
  if (val) _testingCards.add(eventId); else _testingCards.delete(eventId);
}

function updateSingleCard(eventId) {
  const card = document.querySelector(`.descriptor-card[data-event-id="${CSS.escape(eventId)}"]`);
  if (!card) return;
  const entry = state.descriptors.find(d => d.eventId === eventId);
  if (!entry) return;
  card.outerHTML = renderCard(entry, state.descriptors.indexOf(entry));
  // Re-attach event listeners
  renderDiscoveryResults(state.descriptors);
}

async function runSingleTest(eventId, cardElement) {
  const entry = state.descriptors.find(d => d.eventId === eventId);
  if (!entry) return;

  setCardTesting(eventId, true);
  updateSingleCard(eventId);

  try {
    const res = await fetch(TEST_ONE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        descriptor: entry.descriptor,
        pubkey: entry.pubkey,
        eventId: entry.eventId,
      }),
    });
    const data = await res.json();

    state.testResults[eventId] = data;
  } catch (err) {
    state.testResults[eventId] = {
      validation: { valid: false, results: [{ field: 'error', status: 'fail', message: err.message }] },
      serviceReport: null,
    };
  } finally {
    setCardTesting(eventId, false);
    updateSingleCard(eventId);
    updateStats(state.descriptors);
  }
}

async function runAllTests() {
  for (const entry of state.descriptors) {
    const card = document.querySelector(`.descriptor-card[data-event-id="${CSS.escape(entry.eventId)}"]`);
    await runSingleTest(entry.eventId, card);
  }
}

async function discoverEscrows() {
  hideEmpty();
  showLoading();
  $('#results').innerHTML = '';
  $('#status-bar').style.display = 'none';
  $('#btn-discover').disabled = true;
  state.testResults = {};

  try {
    const res = await fetch(DISCOVER_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();

    state.descriptors = data.descriptors || [];
    renderDiscoveryResults(state.descriptors);
    updateStats(state.descriptors);

    // Show Test All if we found descriptors
    if (state.descriptors.length > 0) {
      $('#btn-test-all').style.display = 'inline-block';
    }
  } catch (err) {
    $('#results').innerHTML = `<div class="empty-state"><h2>Error</h2><p>${escapeHtml(err.message)}</p></div>`;
  } finally {
    hideLoading();
    $('#btn-discover').disabled = false;
  }
}

function clearResults() {
  state.descriptors = [];
  state.testResults = {};
  $('#results').innerHTML = '';
  $('#status-bar').style.display = 'none';
  $('#empty').style.display = 'block';
  $('#btn-test-all').style.display = 'none';
}

document.addEventListener('DOMContentLoaded', () => {
  $('#btn-discover').addEventListener('click', discoverEscrows);
  $('#btn-clear').addEventListener('click', clearResults);
  $('#btn-test-all').addEventListener('click', async () => {
    $('#btn-test-all').disabled = true;
    await runAllTests();
    $('#btn-test-all').disabled = false;
  });
});