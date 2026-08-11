const API = '/api/test-all';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const state = { descriptors: [] };

function showLoading() { $('#loading').style.display = 'block'; }
function hideLoading() { $('#loading').style.display = 'none'; }
function hideEmpty() { $('#empty').style.display = 'none'; }

function updateStats(descriptors) {
  $('#status-bar').style.display = descriptors.length > 0 ? 'flex' : 'none';
  if (descriptors.length === 0) return;

  const standalone = descriptors.filter(d => d.descriptor?.service);
  const passed = descriptors.filter(d => d.validation?.valid);
  const failed = descriptors.filter(d => !d.validation?.valid);

  $('#stat-total').textContent = descriptors.length;
  $('#stat-relays').textContent = new Set(descriptors.flatMap(d => d.seenOn || [])).size;
  $('#stat-standalone').textContent = standalone.length;
  $('#stat-discovery').textContent = descriptors.length - standalone.length;
  $('#stat-pass').textContent = passed.length;
  $('#stat-fail').textContent = failed.length;
}

function renderResults(descriptors) {
  const container = $('#results');
  container.innerHTML = descriptors.map((d, idx) => renderCard(d, idx)).join('');

  document.querySelectorAll('.card-header').forEach(header => {
    header.addEventListener('click', () => {
      const card = header.parentElement;
      const body = card.querySelector('.card-body');
      const icon = header.querySelector('.toggle-icon');
      body.classList.toggle('open');
      if (icon) icon.textContent = body.classList.contains('open') ? '−' : '+';
    });
  });
}

function renderCard(entry, idx) {
  const desc = entry.descriptor || {};
  const val = entry.validation || {};
  const svc = entry.serviceReport;
  const hasService = !!(desc.service);
  const hasSvcTests = svc && !svc.skip;

  const type = desc.escrow_type || 'unknown';
  const pubkey = (entry.pubkey || '').slice(0, 12) + '...';
  const networks = Array.isArray(desc.networks) ? desc.networks.join(', ') : '?';
  const version = desc.version ?? '?';
  const relays = (entry.seenOn || []).join(', ') || '?';

  let statusBadge = '';
  if (val.valid) {
    statusBadge = '<span class="badge badge-pass">PASS</span>';
  } else if (val.results && val.results.length > 0) {
    const fCount = val.results.filter(r => r.status === 'fail').length;
    statusBadge = `<span class="badge badge-fail">${fCount} FAILURES</span>`;
  }

  const standaloneBadge = hasService
    ? '<span class="badge badge-standalone">STANDALONE</span>'
    : '<span class="badge badge-discovery">DISCOVERY-ONLY</span>';

  let svcBadge = '';
  if (hasSvcTests) {
    const svcPass = svc.results.every(r => r.pass);
    svcBadge = svcPass
      ? '<span class="badge badge-pass">SVC PASS</span>'
      : '<span class="badge badge-fail">SVC FAIL</span>';
  }

  let bodyHtml = '';
  if (val.results) {
    bodyHtml += `<div class="section-title">PIP-01 Validation</div>`;
    bodyHtml += val.results.map(r => {
      const icon = r.status === 'pass' ? '✓' : r.status === 'fail' ? '✗' : '⚠';
      return `<div class="result-row">
        <span class="result-icon ${r.status}">${icon}</span>
        <span class="result-field">${escapeHtml(r.field)}</span>
        <span class="result-message">${escapeHtml(r.message)}</span>
      </div>`;
    }).join('');
  }

  if (hasSvcTests) {
    bodyHtml += `<div class="section-title">Service Tests — ${escapeHtml(svc.endpoint)}</div>`;
    bodyHtml += svc.results.map(r => {
      const icon = r.pass ? '✓' : '✗';
      return `<div class="service-test-result">
        <span class="result-icon ${r.pass ? 'pass' : 'fail'}">${icon}</span>
        <span class="service-test-label">${escapeHtml(r.label)}</span>
        <span class="service-test-detail">${escapeHtml(r.detail || '')}</span>
      </div>`;
    }).join('');
  } else if (svc && svc.skip) {
    bodyHtml += `<div class="section-title">Service Tests</div>`;
    bodyHtml += `<div class="result-row"><span class="result-message" style="color:#8b949e">Skipped: ${escapeHtml(svc.reason)}</span></div>`;
  }

  return `<div class="descriptor-card">
    <div class="card-header">
      <div style="display:flex;align-items:center;gap:10px">
        <span class="toggle-icon" style="color:#8b949e;font-size:16px;width:20px;text-align:center">+</span>
        <div class="card-title">
          <span class="type">${escapeHtml(type)}</span>
          ${statusBadge} ${standaloneBadge} ${svcBadge}
        </div>
      </div>
      <div class="card-meta">
        <span>v${version}</span>
        <span>${escapeHtml(networks)}</span>
        <span class="pubkey">${pubkey}</span>
      </div>
    </div>
    <div class="card-body">
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
      ${bodyHtml}
    </div>
  </div>`;
}

function escapeHtml(str) {
  const s = String(str);
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function runDiscovery() {
  hideEmpty();
  showLoading();
  $('#results').innerHTML = '';
  $('#status-bar').style.display = 'none';
  $('#btn-discover').disabled = true;

  try {
    const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const data = await res.json();

    state.descriptors = data.descriptors || [];
    renderResults(state.descriptors);
    updateStats(state.descriptors);
  } catch (err) {
    $('#results').innerHTML = `<div class="empty-state"><h2>Error</h2><p>${escapeHtml(err.message)}</p></div>`;
  } finally {
    hideLoading();
    $('#btn-discover').disabled = false;
  }
}

function clearResults() {
  state.descriptors = [];
  $('#results').innerHTML = '';
  $('#status-bar').style.display = 'none';
  $('#empty').style.display = 'block';
}

document.addEventListener('DOMContentLoaded', () => {
  $('#btn-discover').addEventListener('click', runDiscovery);
  $('#btn-clear').addEventListener('click', clearResults);
});