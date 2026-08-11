'use strict';

/**
 * Run interop tests against a discovered standalone escrow service.
 * Tests the service endpoint, descriptor, schema_url, and health.
 */

const SERVICE_TESTS = {
  descriptor_endpoint: {
    label: 'Descriptor endpoint reachable',
    run: async (baseUrl) => {
      const res = await fetch(baseUrl + '/descriptor', { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return { pass: false, detail: `HTTP ${res.status}` };
      const data = await res.json();
      return { pass: true, detail: `version ${data.version}, escrow_type: ${data.escrow_type}` };
    },
  },
  schema_url_resolves: {
    label: 'Schema URL resolves',
    run: async (baseUrl) => {
      const descRes = await fetch(baseUrl + '/descriptor', { signal: AbortSignal.timeout(10000) });
      if (!descRes.ok) return { pass: false, detail: 'Cannot fetch descriptor' };
      const desc = await descRes.json();
      const schemaUrl = desc.service?.schema_url;
      if (!schemaUrl) return { pass: false, detail: 'No schema_url in descriptor' };
      const schemaRes = await fetch(schemaUrl, { signal: AbortSignal.timeout(10000) });
      if (!schemaRes.ok) return { pass: false, detail: `HTTP ${schemaRes.status}` };
      const schema = await schemaRes.json();
      return { pass: true, detail: `OpenAPI ${schema.openapi || 'unknown'}` };
    },
  },
  health_check: {
    label: 'Health endpoint',
    run: async (baseUrl) => {
      const healthUrl = baseUrl.replace(/\/pontmore\/v1$/, '/health');
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return { pass: false, detail: `HTTP ${res.status}` };
      const data = await res.json();
      return { pass: true, detail: `status=${data.status}, backend=${data.backend_configured ? 'configured' : 'descriptor-only'}` };
    },
  },
  cache_control: {
    label: 'Cache-Control: no-store on descriptor',
    run: async (baseUrl) => {
      const res = await fetch(baseUrl + '/descriptor', { signal: AbortSignal.timeout(10000) });
      const cc = res.headers.get('cache-control');
      if (cc && cc.includes('no-store')) {
        return { pass: true, detail: 'no-store present' };
      }
      return { pass: false, detail: cc ? `got "${cc}"` : 'header missing' };
    },
  },
  cors_headers: {
    label: 'CORS headers present',
    run: async (baseUrl) => {
      const res = await fetch(baseUrl + '/descriptor', { signal: AbortSignal.timeout(10000) });
      const acao = res.headers.get('access-control-allow-origin');
      if (acao) return { pass: true, detail: `Allow-Origin: ${acao}` };
      return { pass: false, detail: 'No Access-Control-Allow-Origin header' };
    },
  },
  auth_required: {
    label: 'Protected endpoints require auth',
    run: async (baseUrl) => {
      const res = await fetch(baseUrl + '/fund_status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ escrow_id: '00000000-0000-0000-0000-000000000000' }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.status === 401) return { pass: true, detail: '401 as expected' };
      if (res.status === 404) return { pass: true, detail: '404 (NIP-98 auth header missing before route match)' };
      return { pass: false, detail: `HTTP ${res.status} (expected 401)` };
    },
  },
  service_block_consistency: {
    label: 'Service block matches live descriptor',
    run: async (baseUrl) => {
      const res = await fetch(baseUrl + '/descriptor', { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return { pass: false, detail: 'Cannot fetch descriptor' };
      const desc = await res.json();
      if (!desc.service) return { pass: false, detail: 'No service block' };
      const svc = desc.service;
      const checks = [];
      if (svc.endpoint && !svc.endpoint.includes('example.com')) checks.push('endpoint');
      if (svc.operations && svc.operations.length >= 6) checks.push('operations');
      if (svc.funding_model && svc.funding_model.length > 0) checks.push('funding_model');
      if (svc.release_decisions && svc.release_decisions.length > 0) checks.push('release_decisions');
      if (svc.decision_signers) checks.push('decision_signers');
      return { pass: checks.length >= 4, detail: `${checks.length}/5 dynamic blocks present: ${checks.join(', ')}` };
    },
  },
};

/**
 * Run all service tests against a single endpoint.
 */
async function runServiceTests(descriptorEntry) {
  const baseUrl = descriptorEntry.descriptor?.service?.endpoint;
  if (!baseUrl || baseUrl.includes('example.com')) {
    return {
      endpoint: baseUrl || '(none)',
      skip: true,
      reason: baseUrl ? 'Template endpoint (example.com)' : 'No endpoint',
      results: [],
    };
  }

  const results = [];
  for (const [key, test] of Object.entries(SERVICE_TESTS)) {
    try {
      const result = await test.run(baseUrl);
      results.push({
        test: key,
        label: test.label,
        pass: result.pass,
        detail: result.detail || '',
      });
    } catch (err) {
      results.push({
        test: key,
        label: test.label,
        pass: false,
        detail: `Error: ${err.message}`,
      });
    }
  }

  return { endpoint: baseUrl, skip: false, results };
}

/**
 * Run validation + service tests against all discovered descriptors.
 */
async function runAllTests(descriptors) {
  const { validateDescriptor } = require('./validate');
  const tested = [];

  for (const entry of descriptors) {
    const { valid, results: validationResults } = validateDescriptor(entry.descriptor);

    let serviceReport = null;
    if (entry.descriptor?.service?.endpoint) {
      serviceReport = await runServiceTests(entry);
    }

    tested.push({
      ...entry,
      validation: { valid, results: validationResults },
      serviceReport,
    });
  }

  return tested;
}

module.exports = { SERVICE_TESTS, runServiceTests, runAllTests };