'use strict';

/**
 * Run service-schema interop tests against a discovered PIP-01 descriptor.
 *
 * PIP-01 declares only `service.schema` (type + url). This module applies the
 * schema fetch-safety checks from PIP-01 before dereferencing the URL:
 *   - https only
 *   - no private / loopback / link-local / multicast destinations
 *   - bounded fetches, redirect limits, content-type checks, response-size limits
 * and then validates that the retrieved artifact matches its declared type.
 */

const dns = require('dns').promises;
const net = require('net');

const MAX_REDIRECTS = 5;
const MAX_SCHEMA_BYTES = 5 * 1024 * 1024; // 5 MiB
const FETCH_TIMEOUT_MS = parseInt(process.env.SCHEMA_TIMEOUT_MS || '10000', 10);

const JSON_CONTENT_TYPES = [
  'application/json',
  'application/openapi+json',
  'application/vnd.oai.openapi+json',
  'application/asyncapi+json',
  'text/json',
];

function isPrivateHostname(hostname) {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local');
}

/** Return true when an IP literal is a non-public destination. */
function isUnsafeIp(ip) {
  if (!net.isIP(ip)) return false;

  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    if (a === 0) return true;                 // 0.0.0.0/8
    if (a === 10) return true;                // 10.0.0.0/8
    if (a === 127) return true;               // 127.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a === 169 && b === 254) return true;  // 169.254.0.0/16 link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true;  // 192.168.0.0/16
    if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmark
    if (a >= 224 && a <= 239) return true;    // multicast
    if (a >= 240) return true;                // reserved
    return false;
  }

  // IPv6
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 unique-local
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
    return true; // fe80::/10 link-local
  }
  if (lower.startsWith('ff')) return true; // ff00::/8 multicast
  return false;
}

async function checkHostSafety(url) {
  const hostname = url.hostname;

  if (isPrivateHostname(hostname)) {
    throw new Error(`private hostname: ${hostname}`);
  }

  if (net.isIP(hostname)) {
    if (isUnsafeIp(hostname)) {
      throw new Error(`unsafe IP literal: ${hostname}`);
    }
    return;
  }

  const addrs = await dns.lookup(hostname, { all: true });
  for (const addr of addrs) {
    if (isUnsafeIp(addr.address)) {
      throw new Error(`host "${hostname}" resolves to unsafe address: ${addr.address}`);
    }
  }
}

/**
 * Fetch a schema artifact with PIP-01 fetch-safety checks.
 * Returns { status, contentType, size, body }.
 */
async function fetchSchemaSafely(urlString) {
  let current = urlString;

  for (let redirects = 0; ; redirects++) {
    if (redirects > MAX_REDIRECTS) {
      throw new Error(`too many redirects (>${MAX_REDIRECTS})`);
    }

    let url;
    try {
      url = new URL(current);
    } catch {
      throw new Error(`invalid URL: ${current}`);
    }

    if (url.protocol !== 'https:') {
      throw new Error(`non-https schema URL: ${url.protocol}`);
    }

    await checkHostSafety(url);

    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), url).toString();
      continue;
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_SCHEMA_BYTES) {
      throw new Error(`response too large (${buf.length} bytes > ${MAX_SCHEMA_BYTES})`);
    }

    return { status: res.status, contentType, size: buf.length, body: buf.toString('utf8'), url: url.toString() };
  }
}

const SCHEMA_TESTS = {
  schema_url_https: {
    label: 'Schema URL uses https',
    run: async (schemaUrl) => {
      try {
        const url = new URL(schemaUrl);
        if (url.protocol !== 'https:') return { pass: false, detail: `got ${url.protocol}` };
        return { pass: true, detail: schemaUrl };
      } catch {
        return { pass: false, detail: 'invalid URL' };
      }
    },
  },
  schema_dns_safety: {
    label: 'Schema host is not private/loopback/link-local',
    run: async (schemaUrl) => {
      try {
        const url = new URL(schemaUrl);
        await checkHostSafety(url);
        return { pass: true, detail: url.hostname };
      } catch (err) {
        return { pass: false, detail: err.message };
      }
    },
  },
  schema_fetch: {
    label: 'Schema artifact fetches safely (bounded, redirect-limited)',
    run: async (schemaUrl) => {
      try {
        const { status, size } = await fetchSchemaSafely(schemaUrl);
        return { pass: true, detail: `HTTP ${status}, ${size} bytes` };
      } catch (err) {
        return { pass: false, detail: err.message };
      }
    },
  },
  schema_content_type: {
    label: 'Schema content-type is JSON-based',
    run: async (schemaUrl) => {
      try {
        const { contentType } = await fetchSchemaSafely(schemaUrl);
        const ok = JSON_CONTENT_TYPES.includes(contentType) || contentType.endsWith('+json');
        return { pass: ok, detail: ok ? contentType : `unexpected content-type "${contentType}"` };
      } catch (err) {
        return { pass: false, detail: err.message };
      }
    },
  },
  schema_artifact_valid: {
    label: 'Schema artifact parses and matches declared type',
    run: async (schemaUrl, descriptor) => {
      try {
        const { body } = await fetchSchemaSafely(schemaUrl);
        const artifact = JSON.parse(body);
        const declared = descriptor.service?.schema?.type;

        if (declared === 'openapi') {
          if (typeof artifact.openapi === 'string') {
            return { pass: true, detail: `OpenAPI ${artifact.openapi}` };
          }
          return { pass: false, detail: 'missing top-level "openapi" version field' };
        }
        if (declared === 'asyncapi') {
          if (typeof artifact.asyncapi === 'string') {
            return { pass: true, detail: `AsyncAPI ${artifact.asyncapi}` };
          }
          return { pass: false, detail: 'missing top-level "asyncapi" version field' };
        }
        return { pass: false, detail: `unsupported declared type "${declared}"` };
      } catch (err) {
        return { pass: false, detail: err.message };
      }
    },
  },
};

/**
 * Run schema tests against a descriptor's service.schema pointer.
 */
async function runSchemaTests(descriptorEntry) {
  const schemaUrl = descriptorEntry.descriptor?.service?.schema?.url;

  if (!schemaUrl || schemaUrl.includes('example.com')) {
    return {
      schemaUrl: schemaUrl || '(none)',
      skip: true,
      reason: schemaUrl ? 'Template schema URL (example.com)' : 'No service.schema.url',
      results: [],
    };
  }

  const descriptor = descriptorEntry.descriptor;
  const results = [];

  for (const [key, test] of Object.entries(SCHEMA_TESTS)) {
    try {
      const result = await test.run(schemaUrl, descriptor);
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

  return { schemaUrl, skip: false, results };
}

/**
 * Run validation + schema tests against all discovered descriptors.
 */
async function runAllTests(descriptors) {
  const { validateDescriptor } = require('./validate');
  const tested = [];

  for (const entry of descriptors) {
    const { valid, results: validationResults } = validateDescriptor(entry.descriptor, entry.tags);

    let serviceReport = null;
    if (entry.descriptor?.service?.schema?.url) {
      serviceReport = await runSchemaTests(entry);
    }

    tested.push({
      ...entry,
      validation: { valid, results: validationResults },
      serviceReport,
    });
  }

  return tested;
}

module.exports = { SCHEMA_TESTS, runSchemaTests, runAllTests, fetchSchemaSafely };
