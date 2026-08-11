'use strict';

const KNOWN_ESCROW_TYPES = [
  'lightning_hold_invoice',
  'custodial_escrow',
  'cashu_escrow',
];

const KNOWN_DECISION_TYPES = [
  'mutual_consent',
  'operator_decision',
  'oracle_signature',
  'application_signed_result',
  'threshold_participant_signatures',
  'split_decision',
];

const KNOWN_FUNDING_MODELS = [
  'single_funder',
  'two_party',
  'm_of_n',
];

const KNOWN_FUNDING_TIMEOUT_RESOLUTIONS = [
  'cancel_and_refund_funded_sides',
  'cancel_without_refund',
  'operator_decision',
  'mutual_consent',
];

const KNOWN_DISPUTE_POLICIES = [
  'operator_resolved',
  'oracle_resolved',
  'participant_resolved',
];

const KNOWN_NETWORKS = [
  'bitcoin',
  'lightning',
  'cashu',
  'liquid',
];

const KNOWN_AUTH_METHODS = ['nostr_http_auth'];

const REQUIRED_CONTENT_FIELDS = [
  'version',
  'escrow_type',
  'networks',
  'funding_rules',
  'release_rules',
  'dispute_rules',
  'reference_format',
  'updated_at',
];

const SERVICE_REQUIRED_FIELDS = [
  'transport',
  'interface',
  'endpoint',
  'auth',
  'operations',
  'funding_model',
  'release_decisions',
  'schema_url',
];

const CANONICAL_OPERATIONS = [
  'create',
  'funding_instructions',
  'fund_status',
  'release',
  'refund',
  'cancel',
];

const CUSTODIAL_REQUIRED_FIELDS = [
  'custody_authority',
  'release_authority',
  'refund_authority',
  'implementations',
];

const VALID_HEX64 = /^[0-9a-f]{64}$/i;

/** Check if a field is a valid 64-char hex pubkey or null */
function isValidPubkeyOrNull(val) {
  return val === null || (typeof val === 'string' && VALID_HEX64.test(val));
}

/**
 * Validate a single descriptor against the PIP-01 spec.
 * Returns { valid: boolean, results: [{ field, status, message }] }
 */
function validateDescriptor(descriptor) {
  const results = [];
  const pass = (field, msg) => results.push({ field, status: 'pass', message: msg || `✓ ${field}` });
  const warn = (field, msg) => results.push({ field, status: 'warn', message: msg });
  const fail = (field, msg) => results.push({ field, status: 'fail', message: msg });

  if (!descriptor || typeof descriptor !== 'object') {
    fail('descriptor', 'Descriptor content is not a valid JSON object');
    return { valid: false, results };
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
    fail('networks', 'networks must be a non-empty array');
  } else {
    const unknowns = descriptor.networks.filter(n => !KNOWN_NETWORKS.includes(n));
    if (unknowns.length) {
      warn('networks', `Unknown network(s): ${unknowns.join(', ')}`);
    }
    pass('networks', `networks: [${descriptor.networks.join(', ')}]`);
  }

  // funding_rules
  if (descriptor.funding_rules && typeof descriptor.funding_rules === 'object') {
    if (descriptor.funding_rules.required_confirmation) {
      pass('funding_rules.required_confirmation', `required_confirmation: ${descriptor.funding_rules.required_confirmation}`);
    } else {
      warn('funding_rules', 'funding_rules.required_confirmation is missing or empty');
    }
    if (descriptor.funding_rules.funding_timeout) {
      pass('funding_rules.funding_timeout', `funding_timeout: ${descriptor.funding_rules.funding_timeout}`);
    }
    if (descriptor.funding_rules.funding_timeout_resolution) {
      const resolution = descriptor.funding_rules.funding_timeout_resolution;
      if (KNOWN_FUNDING_TIMEOUT_RESOLUTIONS.includes(resolution)) {
        pass('funding_rules.funding_timeout_resolution', resolution);
      } else {
        warn('funding_rules.funding_timeout_resolution', `Unknown resolution: "${resolution}"`);
      }
    }
  } else {
    fail('funding_rules', 'funding_rules must be an object');
  }

  // release_rules
  if (descriptor.release_rules && typeof descriptor.release_rules === 'object') {
    if (descriptor.release_rules.release_trigger) {
      pass('release_rules.release_trigger', `trigger: ${descriptor.release_rules.release_trigger}`);
    } else {
      warn('release_rules', 'release_rules.release_trigger is missing or empty');
    }
    if (descriptor.release_rules.refund_trigger) {
      pass('release_rules.refund_trigger', `trigger: ${descriptor.release_rules.refund_trigger}`);
    } else {
      warn('release_rules', 'release_rules.refund_trigger is missing or empty');
    }
    if (descriptor.release_rules.timeout_fallback) {
      pass('release_rules.timeout_fallback', `fallback: ${descriptor.release_rules.timeout_fallback}`);
    }
  } else {
    fail('release_rules', 'release_rules must be an object');
  }

  // dispute_rules
  if (descriptor.dispute_rules && typeof descriptor.dispute_rules === 'object') {
    if (descriptor.dispute_rules.policy) {
      const policy = descriptor.dispute_rules.policy;
      if (KNOWN_DISPUTE_POLICIES.includes(policy)) {
        pass('dispute_rules.policy', policy);
      } else {
        warn('dispute_rules.policy', `Unknown policy: "${policy}"`);
      }
    }
  } else {
    fail('dispute_rules', 'dispute_rules must be an object');
  }

  // reference_format
  if (typeof descriptor.reference_format === 'string') {
    pass('reference_format', descriptor.reference_format);
  } else {
    fail('reference_format', 'reference_format must be a string');
  }

  // updated_at
  if (typeof descriptor.updated_at === 'number') {
    pass('updated_at', `Timestamp: ${new Date(descriptor.updated_at * 1000).toISOString()}`);
  } else {
    fail('updated_at', 'updated_at must be a Unix timestamp number');
  }

  // ── Custodial escrow subtype checks ──
  if (descriptor.escrow_type === 'custodial_escrow' || descriptor.escrow_type === 'cashu_escrow') {
    for (const field of CUSTODIAL_REQUIRED_FIELDS) {
      if (!(field in descriptor)) {
        fail(field, `Missing required ${descriptor.escrow_type} field: ${field}`);
      }
    }
    if (descriptor.implementations && Array.isArray(descriptor.implementations)) {
      if (descriptor.implementations.length === 0) {
        fail('implementations', 'implementations must be non-empty');
      }
      for (let i = 0; i < descriptor.implementations.length; i++) {
        const impl = descriptor.implementations[i];
        if (!impl.network || !descriptor.networks.includes(impl.network)) {
          warn(`implementations[${i}].network`, `Network "${impl.network}" not in top-level networks`);
        }
        if (descriptor.escrow_type === 'cashu_escrow') {
          if (!impl.mint_url) {
            fail(`implementations[${i}].mint_url`, 'cashu_escrow requires mint_url');
          } else {
            try { new URL(impl.mint_url); pass(`implementations[${i}].mint_url`, impl.mint_url); }
            catch { fail(`implementations[${i}].mint_url`, `Invalid URL: ${impl.mint_url}`); }
          }
          if (impl.lock_mechanism && impl.lock_mechanism !== 'p2pk_timelock') {
            warn(`implementations[${i}].lock_mechanism`, `Expected p2pk_timelock, got ${impl.lock_mechanism}`);
          } else if (impl.lock_mechanism) {
            pass(`implementations[${i}].lock_mechanism`, impl.lock_mechanism);
          }
        }
      }
    }
  }

  // ── Service Block (standalone) ──
  const hasService = !!(descriptor.service && typeof descriptor.service === 'object');

  if (hasService) {
    const svc = descriptor.service;

    for (const field of SERVICE_REQUIRED_FIELDS) {
      if (!(field in svc)) {
        fail(`service.${field}`, `Missing required service field: ${field}`);
      }
    }

    // transport
    if (Array.isArray(svc.transport)) {
      if (!svc.transport.includes('https')) {
        warn('service.transport', 'https is not in transport array (recommended for standalone)');
      }
      pass('service.transport', `[${svc.transport.join(', ')}]`);
    }

    // interface
    if (typeof svc.interface === 'string') {
      pass('service.interface', svc.interface);
    }

    // endpoint
    if (typeof svc.endpoint === 'string') {
      try {
        const url = new URL(svc.endpoint);
        if (url.protocol !== 'https:') {
          warn('service.endpoint', `Endpoint should use https://, got ${url.protocol}`);
        }
        pass('service.endpoint', svc.endpoint);
      } catch {
        fail('service.endpoint', `Invalid URL: ${svc.endpoint}`);
      }
    }

    // auth
    if (Array.isArray(svc.auth)) {
      if (!svc.auth.includes('nostr_http_auth')) {
        warn('service.auth', 'nostr_http_auth is recommended for standalone HTTP services');
      }
      pass('service.auth', `[${svc.auth.join(', ')}]`);
    }

    // operations
    if (Array.isArray(svc.operations)) {
      const missing = CANONICAL_OPERATIONS.filter(op => !svc.operations.includes(op));
      if (missing.length) {
        fail('service.operations', `Missing canonical operations: ${missing.join(', ')}`);
      } else {
        pass('service.operations', `All ${CANONICAL_OPERATIONS.length} canonical operations present`);
      }
      if (svc.operations.includes('split') && !svc.release_decisions.includes('split_decision')) {
        fail('service', 'operations includes "split" but release_decisions does not include "split_decision"');
      }
    }

    // funding_model
    if (Array.isArray(svc.funding_model)) {
      const unknowns = svc.funding_model.filter(m => !KNOWN_FUNDING_MODELS.includes(m));
      if (unknowns.length) warn('service.funding_model', `Unknown models: ${unknowns.join(', ')}`);
      pass('service.funding_model', `[${svc.funding_model.join(', ')}]`);
    }

    // release_decisions
    if (Array.isArray(svc.release_decisions)) {
      const unknowns = svc.release_decisions.filter(d => !KNOWN_DECISION_TYPES.includes(d));
      if (unknowns.length) warn('service.release_decisions', `Unknown decisions: ${unknowns.join(', ')}`);
      pass('service.release_decisions', `[${svc.release_decisions.join(', ')}]`);
    }

    // decision_signers
    if (svc.decision_signers && typeof svc.decision_signers === 'object') {
      const ds = svc.decision_signers;
      if ('operator_pubkey' in ds) {
        if (isValidPubkeyOrNull(ds.operator_pubkey)) {
          pass('service.decision_signers.operator_pubkey', ds.operator_pubkey || 'null');
        } else {
          fail('service.decision_signers.operator_pubkey', 'Must be 64-char hex or null');
        }
      }
      if ('application_pubkeys' in ds) {
        if (ds.application_pubkeys === null) {
          pass('service.decision_signers.application_pubkeys', 'null (no allowlist — any valid signature accepted)');
        } else if (Array.isArray(ds.application_pubkeys)) {
          const valid = ds.application_pubkeys.filter(k => VALID_HEX64.test(k));
          if (valid.length !== ds.application_pubkeys.length) {
            warn('service.decision_signers.application_pubkeys', `${ds.application_pubkeys.length - valid.length} key(s) not valid hex`);
          }
          pass('service.decision_signers.application_pubkeys', `${valid.length} key(s)`);
        }
      }
      if ('oracle_pubkeys' in ds && Array.isArray(ds.oracle_pubkeys)) {
        pass('service.decision_signers.oracle_pubkeys', `${ds.oracle_pubkeys.length} oracle(s)`);
      }
    } else if (hasService) {
      warn('service.decision_signers', 'decision_signers block not present (recommended for standalone)');
    }

    // schema_url
    if (typeof svc.schema_url === 'string') {
      try {
        const url = new URL(svc.schema_url);
        if (url.protocol !== 'https:') {
          fail('service.schema_url', `schema_url must use https://, got ${url.protocol}`);
        }
        pass('service.schema_url', svc.schema_url);
      } catch {
        fail('service.schema_url', `Invalid URL: ${svc.schema_url}`);
      }
    }

    // standalone sufficiency check
    const standaloneIssues = results.filter(r =>
      r.status === 'fail' && r.field.startsWith('service.'));
    if (standaloneIssues.length > 0) {
      results.push({ field: 'standalone_sufficient', status: 'fail',
        message: `NOT standalone-sufficient: ${standaloneIssues.length} service field issue(s)` });
    } else {
      results.push({ field: 'standalone_sufficient', status: 'pass',
        message: 'Service block is complete — descriptor is standalone-sufficient' });
    }
  } else {
    results.push({ field: 'standalone_sufficient', status: 'warn',
      message: 'No service block — discovery-only, not standalone-sufficient' });
  }

  // ── Refund trigger fallback check ──
  if (descriptor.release_rules && hasService) {
    const refundTrigger = descriptor.release_rules.refund_trigger || '';
    const hasMutualOnly = /mutual_consent/.test(refundTrigger) && !/oracle|operator|threshold|application/.test(refundTrigger);
    if (hasMutualOnly) {
      const fallback = descriptor.release_rules.timeout_fallback ||
        (descriptor.service && descriptor.service.decision_signers && 'operator_pubkey' in descriptor.service.decision_signers
          ? 'operator_decision' : null);
      if (!fallback) {
        fail('refund_trigger.deadlock', 'Refund trigger resolves only to mutual_consent with no declared fallback — deadlock risk');
      } else {
        pass('refund_trigger.fallback', `Fallback: ${fallback}`);
      }
    }
  }

  // ── Public/Private boundary check ──
  const forbiddenKeys = ['wallet_id', 'api_key', 'bearer_token', 'payment_credentials', 'routing_state', 'account_id'];
  for (const key of forbiddenKeys) {
    if (key in descriptor) {
      fail('private_boundary', `Descriptor exposes private field: "${key}" (violates public/private boundary)`);
    }
  }

  const valid = results.every(r => r.status !== 'fail');
  return { valid: results.every(r => r.status !== 'fail'), results };
}

module.exports = { validateDescriptor, KNOWN_ESCROW_TYPES, KNOWN_DECISION_TYPES, KNOWN_FUNDING_MODELS };