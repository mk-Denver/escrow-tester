'use strict';

const KNOWN_ESCROW_TYPES = [
  'lightning_hold_invoice',
  'custodial_escrow',
  'cashu_escrow',
];

const KNOWN_NETWORKS = [
  'bitcoin',
  'lightning',
  'cashu',
  'liquid',
];

const KNOWN_DISPUTE_POLICIES = [
  'operator_resolved',
  'oracle_resolved',
  'participant_resolved',
];

const KNOWN_SCHEMA_TYPES = [
  'openapi',
  'asyncapi',
];

// Minimum content fields per PIP-01.
const REQUIRED_CONTENT_FIELDS = [
  'version',
  'escrow_type',
  'networks',
  'funding_rules',
  'dispute_rules',
  'reference_format',
  'updated_at',
];

// Public/private boundary: keys that MUST NOT appear anywhere in a descriptor.
const FORBIDDEN_KEYS = [
  'wallet_id',
  'wallet_identifier',
  'wallet_identifiers',
  'custody_backend',
  'custody_backend_id',
  'custody_backend_identifier',
  'api_key',
  'apikey',
  'bearer_token',
  'access_token',
  'client_secret',
  'secret',
  'payment_credentials',
  'payment_credential',
  'payment_instruction',
  'payment_instructions',
  'private_payment',
  'private_payout',
  'routing_state',
  'internal_account',
  'account_id',
  'account_details',
  'settlement_secret',
  'preimage',
  'invoice',
  'raw_invoice',
  'bolt11',
  'cashu_token',
  'cashu_tokens',
  'token_string',
  'mint_credentials',
  'review_notes',
  'internal_notes',
  'internal_review',
];

// Private payload value patterns that MUST NOT appear as string values.
const FORBIDDEN_VALUE_PATTERNS = [
  { name: 'raw Bolt11 invoice', regex: /\blnbc[a-z0-9]{20,}/i },
  { name: 'raw Lightning testnet invoice', regex: /\blntb[a-z0-9]{20,}/i },
  { name: 'raw Cashu token', regex: /\bcashu[A-Z][a-zA-Z0-9_-]{20,}/ },
];

const VALID_HEX64 = /^[0-9a-f]{64}$/i;

/**
 * Recursively scan a descriptor for private-boundary violations.
 * Returns an array of { path, message } issues.
 */
function scanPrivateBoundary(value, path, issues) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      scanPrivateBoundary(value[i], `${path}[${i}]`, issues);
    }
    return issues;
  }

  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      const keyPath = path ? `${path}.${key}` : key;
      if (FORBIDDEN_KEYS.includes(key)) {
        issues.push({ path: keyPath, message: `private field "${key}" violates public/private boundary` });
      }
      scanPrivateBoundary(value[key], keyPath, issues);
    }
    return issues;
  }

  if (typeof value === 'string') {
    for (const pattern of FORBIDDEN_VALUE_PATTERNS) {
      if (pattern.regex.test(value)) {
        issues.push({ path, message: `value at "${path}" looks like a ${pattern.name} (must stay out of the public descriptor)` });
        pattern.regex.lastIndex = 0;
      }
    }
  }

  return issues;
}

function isPrivateHostname(hostname) {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local');
}

/**
 * Validate a single descriptor against the PIP-01 spec.
 *
 * Optional `tags` (the Nostr event tags array) enables a cross-check of the
 * repeated `network` tags against content.networks.
 *
 * Returns { valid, results, useLevel }.
 */
function validateDescriptor(descriptor, tags) {
  const results = [];
  const pass = (field, msg) => results.push({ field, status: 'pass', message: msg || `✓ ${field}` });
  const warn = (field, msg) => results.push({ field, status: 'warn', message: msg });
  const fail = (field, msg) => results.push({ field, status: 'fail', message: msg });

  if (!descriptor || typeof descriptor !== 'object') {
    fail('descriptor', 'Descriptor content is not a valid JSON object');
    return { valid: false, results, useLevel: 'unknown' };
  }

  // ── Minimum Content Fields ──
  for (const field of REQUIRED_CONTENT_FIELDS) {
    if (!(field in descriptor)) {
      fail(field, `Missing required field: ${field}`);
    }
  }

  // version
  if (typeof descriptor.version !== 'number' || descriptor.version < 1) {
    fail('version', `version must be a positive integer, got ${JSON.stringify(descriptor.version)}`);
  } else {
    pass('version', `version: ${descriptor.version}`);
  }

  // escrow_type
  if (typeof descriptor.escrow_type !== 'string') {
    fail('escrow_type', 'escrow_type must be a string');
  } else if (!KNOWN_ESCROW_TYPES.includes(descriptor.escrow_type)) {
    warn('escrow_type', `Unknown escrow_type: "${descriptor.escrow_type}" (known: ${KNOWN_ESCROW_TYPES.join(', ')})`);
  } else {
    pass('escrow_type', `escrow_type: ${descriptor.escrow_type}`);
  }

  // networks
  if (!Array.isArray(descriptor.networks) || descriptor.networks.length === 0) {
    fail('networks', 'networks must be a non-empty array of lowercase network identifiers');
  } else {
    const nonLower = descriptor.networks.filter(n => typeof n !== 'string' || n !== n.toLowerCase());
    if (nonLower.length) {
      warn('networks', `Network identifiers should be lowercase: ${nonLower.join(', ')}`);
    }
    const unknowns = descriptor.networks.filter(n => typeof n === 'string' && !KNOWN_NETWORKS.includes(n));
    if (unknowns.length) {
      warn('networks', `Unknown network(s): ${unknowns.join(', ')}`);
    }
    pass('networks', `networks: [${descriptor.networks.join(', ')}]`);

    // Subtype network requirements
    if (descriptor.escrow_type === 'lightning_hold_invoice' && !descriptor.networks.includes('lightning')) {
      fail('networks', 'lightning_hold_invoice requires "lightning" in networks');
    }
    if (descriptor.escrow_type === 'cashu_escrow' && !descriptor.networks.includes('cashu')) {
      fail('networks', 'cashu_escrow requires "cashu" in networks');
    }
  }

  // ── funding_rules (m of n cardinality) ──
  if (descriptor.funding_rules && typeof descriptor.funding_rules === 'object') {
    const fr = descriptor.funding_rules;

    // funding_threshold = m
    if (Number.isInteger(fr.funding_threshold) && fr.funding_threshold >= 1) {
      pass('funding_rules.funding_threshold', `funding_threshold (m): ${fr.funding_threshold}`);
    } else {
      fail('funding_rules.funding_threshold',
        `funding_threshold must be an integer >= 1, got ${JSON.stringify(fr.funding_threshold)}`);
    }

    // participant_count = n
    if (Number.isInteger(fr.participant_count) && fr.participant_count >= 1) {
      if (fr.participant_count >= fr.funding_threshold) {
        pass('funding_rules.participant_count', `participant_count (n): ${fr.participant_count}`);
      } else {
        fail('funding_rules.participant_count',
          `participant_count (${fr.participant_count}) must be >= funding_threshold (${fr.funding_threshold})`);
      }
    } else {
      fail('funding_rules.participant_count',
        `participant_count must be an integer >= funding_threshold, got ${JSON.stringify(fr.participant_count)}`);
    }

    if (Number.isInteger(fr.funding_threshold) && Number.isInteger(fr.participant_count)) {
      pass('funding_rules.cardinality', `${fr.funding_threshold} of ${fr.participant_count} funding rule`);
    }

    // Optional compatibility facts (from the spec example).
    if (fr.required_confirmation) {
      pass('funding_rules.required_confirmation', `required_confirmation: ${fr.required_confirmation}`);
    }
    if (fr.funding_timeout) {
      pass('funding_rules.funding_timeout', `funding_timeout: ${fr.funding_timeout}`);
    }

    // Partially funded escrow must have a timeout/fallback path.
    if (fr.participant_count > 1) {
      const hasSchema = !!(descriptor.service && descriptor.service.schema);
      const hasFallback = !!fr.funding_timeout || !!(descriptor.dispute_rules && descriptor.dispute_rules.timeout_fallback);
      if (!hasSchema && !hasFallback) {
        warn('funding_rules.partial_refund',
          'participant_count > 1: descriptor or referenced service schema must define how partially funded escrows are canceled/refunded after timeout');
      } else {
        pass('funding_rules.partial_refund', 'partial-funding timeout path declared (timeout fallback or service schema)');
      }
    }
  } else {
    fail('funding_rules', 'funding_rules must be an object');
  }

  // ── dispute_rules ──
  if (descriptor.dispute_rules && typeof descriptor.dispute_rules === 'object') {
    const dr = descriptor.dispute_rules;

    if (typeof dr.policy === 'string' && dr.policy.length > 0) {
      if (KNOWN_DISPUTE_POLICIES.includes(dr.policy)) {
        pass('dispute_rules.policy', `policy: ${dr.policy}`);
      } else {
        warn('dispute_rules.policy', `Unknown policy: "${dr.policy}" (known: ${KNOWN_DISPUTE_POLICIES.join(', ')})`);
      }
    } else {
      warn('dispute_rules.policy', 'dispute_rules.policy is missing or empty');
    }

    // Timeout fallback must identify a PIP-03-compatible fallback resolution.
    if (typeof dr.timeout_fallback === 'string' && dr.timeout_fallback.length > 0) {
      if (dr.timeout_fallback === 'mutual_consent') {
        fail('dispute_rules.timeout_fallback',
          'mutual_consent-only timeout path with no fallback is not a valid terminal policy (PIP-03)');
      } else {
        pass('dispute_rules.timeout_fallback', `timeout_fallback: ${dr.timeout_fallback}`);
      }
    } else {
      warn('dispute_rules.timeout_fallback',
        'dispute_rules.timeout_fallback is missing — a descriptor that advertises a timeout class must identify its PIP-03 fallback resolution');
    }
  } else {
    fail('dispute_rules', 'dispute_rules must be an object');
  }

  // ── reference_format ──
  if (typeof descriptor.reference_format === 'string' && descriptor.reference_format.length > 0) {
    pass('reference_format', `reference_format: ${descriptor.reference_format}`);
  } else {
    fail('reference_format', 'reference_format must be a non-empty string');
  }

  // ── updated_at ──
  if (typeof descriptor.updated_at === 'number') {
    pass('updated_at', `Timestamp: ${new Date(descriptor.updated_at * 1000).toISOString()}`);
  } else {
    fail('updated_at', 'updated_at must be a Unix timestamp number');
  }

  // ── Service Schema Discovery ──
  const hasService = !!(descriptor.service && typeof descriptor.service === 'object');

  if (hasService) {
    const svc = descriptor.service;

    // The service block MUST contain only `schema`.
    const extraFields = Object.keys(svc).filter(k => k !== 'schema');
    if (extraFields.length) {
      fail('service', `service block MUST contain only "schema", found extra field(s): ${extraFields.join(', ')}`);
    }

    if (svc.schema && typeof svc.schema === 'object') {
      const schema = svc.schema;

      if (typeof schema.type === 'string' && KNOWN_SCHEMA_TYPES.includes(schema.type)) {
        pass('service.schema.type', `schema type: ${schema.type}`);
      } else if (typeof schema.type === 'string') {
        fail('service.schema.type',
          `unsupported schema type: "${schema.type}" (supported: ${KNOWN_SCHEMA_TYPES.join(', ')})`);
      } else {
        fail('service.schema.type', 'service.schema.type is required (openapi or asyncapi)');
      }

      if (typeof schema.url === 'string') {
        let url;
        try {
          url = new URL(schema.url);
        } catch {
          url = null;
        }
        if (!url) {
          fail('service.schema.url', `Invalid URL: ${schema.url}`);
        } else if (url.protocol !== 'https:') {
          fail('service.schema.url', `schema.url must use https://, got ${url.protocol}`);
        } else if (isPrivateHostname(url.hostname)) {
          fail('service.schema.url', `schema.url must not point to a private hostname: ${url.hostname}`);
        } else {
          pass('service.schema.url', schema.url);
        }
      } else {
        fail('service.schema.url', 'service.schema.url is required (absolute https:// URL)');
      }
    } else {
      fail('service.schema', 'service.schema must be an object containing type and url');
    }
  } else {
    warn('service', 'No service block — compatibility/discovery only, no service schema pointer');
  }

  // ── Network tags cross-check (event-level) ──
  if (Array.isArray(tags) && Array.isArray(descriptor.networks)) {
    const tagNetworks = tags
      .filter(t => Array.isArray(t) && t[0] === 'network' && t[1])
      .map(t => t[1]);

    for (const net of tagNetworks) {
      if (!descriptor.networks.includes(net)) {
        warn('tags.network', `repeated "network" tag "${net}" is not declared in content.networks (tag is not canonical)`);
      }
    }
    for (const net of descriptor.networks) {
      if (!tagNetworks.includes(net)) {
        warn('tags.network', `content.networks value "${net}" has no matching "network" tag (SHOULD be emitted for relay filtering)`);
      }
    }
  }

  // ── Public/Private boundary ──
  const boundaryIssues = scanPrivateBoundary(descriptor, '', []);
  for (const issue of boundaryIssues) {
    fail('private_boundary', issue.message);
  }

  const valid = results.every(r => r.status !== 'fail');
  const useLevel = hasService && descriptor.service && descriptor.service.schema
    ? 'service_schema_discovery'
    : 'compatibility_discovery';

  return { valid, results, useLevel };
}

module.exports = {
  validateDescriptor,
  KNOWN_ESCROW_TYPES,
  KNOWN_NETWORKS,
  KNOWN_SCHEMA_TYPES,
  KNOWN_DISPUTE_POLICIES,
};
