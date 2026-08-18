'use strict';

const express = require('express');
const path = require('path');
const { discoverDescriptors } = require('./lib/relay');
const { validateDescriptor } = require('./lib/validate');
const { runSchemaTests } = require('./lib/test-runner');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3001;
const NOSTR_RELAYS = (process.env.NOSTR_RELAYS || 'wss://nos.lol,wss://relay.damus.io')
  .split(',').map(s => s.trim()).filter(Boolean);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ───────────────────────────────────────────────────────────────

/** POST /api/discover — Query relays for kind 30361 descriptors */
app.post('/api/discover', async (req, res) => {
  try {
    const relays = req.body.relays || NOSTR_RELAYS;
    const result = await discoverDescriptors(relays);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/validate — Validate a single descriptor against PIP-01 */
app.post('/api/validate', (req, res) => {
  try {
    const descriptor = req.body.descriptor;
    if (!descriptor) return res.status(400).json({ error: 'descriptor body required' });
    const report = validateDescriptor(descriptor);
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/validate-all — Validate all discovered descriptors */
app.post('/api/validate-all', async (req, res) => {
  try {
    const relays = req.body.relays || NOSTR_RELAYS;
    const { descriptors, relayResults } = await discoverDescriptors(relays);

    const validated = descriptors.map(entry => ({
      ...entry,
      validation: validateDescriptor(entry.descriptor, entry.tags),
    }));

    res.json({ descriptors: validated, relayResults });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/test-all — Full discover + validate + service tests */
app.post('/api/test-all', async (req, res) => {
  try {
    const relays = req.body.relays || NOSTR_RELAYS;
    const { descriptors, relayResults } = await discoverDescriptors(relays);
    const { runAllTests } = require('./lib/test-runner');
    const results = await runAllTests(descriptors);
    res.json({ descriptors: results, relayResults });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/test-one — Validate + service test a single descriptor entry */
app.post('/api/test-one', async (req, res) => {
  try {
    const descriptor = req.body.descriptor;
    const pubkey = req.body.pubkey;
    const eventId = req.body.eventId;

    if (!descriptor) return res.status(400).json({ error: 'descriptor required' });

    const validation = validateDescriptor(descriptor, req.body.tags);

    let serviceReport = null;
    if (descriptor?.service?.schema?.url) {
      serviceReport = await runSchemaTests({ descriptor, pubkey, eventId, tags: req.body.tags });
    }

    res.json({ validation, serviceReport });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/relays — Return configured relays */
app.get('/api/relays', (req, res) => {
  res.json({ relays: NOSTR_RELAYS });
});

// ── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\nescrow-tester running at http://localhost:${PORT}`);
  console.log(`Relays: ${NOSTR_RELAYS.join(', ')}\n`);
});