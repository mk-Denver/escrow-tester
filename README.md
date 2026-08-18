# PIP-01 Escrow Descriptor Tester

A web-based tool for discovering and validating [PIP-01](https://github.com/mk-Denver/protocol/blob/mk/escrow-invocation/PIP-01-escrow-descriptor.md) escrow descriptors from Nostr relays.

## Features

- **Discover** — queries Nostr relays for kind 30361 escrow descriptor events
- **Validate** — checks each descriptor against the PIP-01 specification (minimum content fields, escrow_type, networks, funding_rules m-of-n, dispute_rules timeout fallback, reference_format, service schema block, public/private boundary)
- **Schema Tests** — for descriptors that advertise a `service.schema`, applies PIP-01 schema fetch-safety checks (https only, no private/loopback/link-local/multicast destinations, bounded fetch, redirect limits, content-type, response-size) and validates the retrieved artifact against its declared `schema.type`

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
| `POST` | `/api/test-all` | Full discover + validate + schema tests |
| `POST` | `/api/test-one` | Validate + schema test a single descriptor entry |
| `GET`  | `/api/relays` | List configured relays |

## Architecture

```
escrow-tester/
  server.js          Express backend + static file serving
  lib/
    relay.js         Nostr relay WebSocket querying (kind 30361)
    validate.js      PIP-01 descriptor validation
    test-runner.js   Service-schema fetch-safety tests against live schema artifacts
  public/
    index.html       Web UI
    app.js           Frontend logic (discover → render cards)
    style.css        Dark theme styling
```

## Validation Coverage

- Minimum content fields (`version`, `escrow_type`, `networks`, `funding_rules`, `dispute_rules`, `reference_format`, `updated_at`)
- Escrow type: `lightning_hold_invoice`, `custodial_escrow`, `cashu_escrow`
- Networks: non-empty lowercase array (`bitcoin`, `lightning`, `cashu`, `liquid`); subtype requirements (`lightning` for hold invoices, `cashu` for Cashu escrow)
- Network tag cross-check: repeated `network` tags vs `content.networks`
- Funding rules: `funding_threshold` (m) and `participant_count` (n) cardinality, with partial-funding timeout/fallback warning
- Dispute rules: `policy` and `timeout_fallback`; rejects `mutual_consent`-only timeout paths with no fallback
- Service schema: `service` block must contain only `schema`, with `schema.type` (`openapi`/`asyncapi`) and `schema.url` (absolute `https://`)
- Public/private boundary: no wallet identifiers, custody backend identifiers, private credentials, routing state, API keys, payment instructions, raw invoices, raw Cashu tokens, settlement secrets, or internal notes

## License

MIT
