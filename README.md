# PIP-01 Escrow Descriptor Tester

A web-based tool for discovering and validating [PIP-01](https://github.com/mk-Denver/protocol/blob/mk/escrow-invocation/PIP-01-escrow-descriptor.md) standalone escrow descriptors from Nostr relays.

## Features

- **Discover** — queries Nostr relays for kind 30361 escrow descriptor events
- **Validate** — checks each descriptor against the PIP-01 specification (minimum content fields, escrow_type, networks, funding_rules, release_rules, dispute_rules, service block, decision_signers, schema_url, etc.)
- **Service Tests** — for standalone descriptors, tests the live endpoint (descriptor reachable, schema_url resolves, health check, cache-control headers, CORS, auth required)

## Quick Start

```bash
npm install
cp .env.example .env   # edit relays if desired
npm start              # http://localhost:3001
```

Set `NOSTR_RELAYS` in `.env` to customize which relays to query (default: `wss://nos.lol,wss://relay.damus.io`).

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/discover` | Query relays for kind 30361 events |
| `POST` | `/api/validate` | Validate a single descriptor |
| `POST` | `/api/validate-all` | Discover + validate all at once |
| `POST` | `/api/test-all` | Full discover + validate + service tests |
| `GET`  | `/api/relays` | List configured relays |

## Architecture

```
escrow-tester/
  server.js          Express backend + static file serving
  lib/
    relay.js         Nostr relay WebSocket querying (kind 30361)
    validate.js      PIP-01 descriptor validation (40+ checks)
    test-runner.js   Service-level interop tests against live endpoints
  public/
    index.html       Web UI
    app.js           Frontend logic (discover → render cards)
    style.css        Dark theme styling
```

## Validation Coverage

- Minimum content fields (version, escrow_type, networks, funding_rules, release_rules, dispute_rules, reference_format, updated_at)
- Escrow type: `lightning_hold_invoice`, `custodial_escrow`, `cashu_escrow`
- Networks: bitcoin, lightning, cashu, liquid
- Funding rules: required_confirmation, funding_timeout, funding_timeout_resolution
- Release rules: release_trigger, refund_trigger, timeout_fallback
- Service block: transport, interface, endpoint, auth, operations, funding_model, release_decisions, schema_url
- Decision signers: operator_pubkey, application_pubkeys, oracle_pubkeys
- Custodial subtype: custody_authority, release_authority, refund_authority, implementations
- Cashu subtype: mint_url, lock_mechanism (p2pk_timelock)
- Standalone sufficiency: service block completeness
- Refund deadlock: mutual_consent-only refund with no fallback
- Public/private boundary: no wallet_id, api_key, or bearer_token leaks
- Schema URL: must be https://, must resolve
- Split operation consistency: split in operations requires split_decision in release_decisions

## License

MIT