'use strict';

const WebSocket = require('ws');

const KIND_ESCROW_DESCRIPTOR = 30361;
const DEFAULT_RELAYS = ['wss://nos.lol', 'wss://relay.damus.io'];
const TIMEOUT_MS = parseInt(process.env.RELAY_TIMEOUT_MS || '10000', 10);

/**
 * Query a single Nostr relay for kind 30361 events.
 * Returns { relay, events: [...] } with parsed descriptor events.
 */
function queryRelay(relayUrl) {
  return new Promise((resolve) => {
    const subId = `escrow-tester-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const events = [];
    let eose = false;
    let socket;

    const cleanup = () => {
      try { socket.close(); } catch {}
    };

    const timer = setTimeout(() => {
      resolve({ relay: relayUrl, events });
      cleanup();
    }, TIMEOUT_MS);

    try {
      socket = new WebSocket(relayUrl);
    } catch {
      clearTimeout(timer);
      resolve({ relay: relayUrl, events, error: 'connection failed' });
      return;
    }

    socket.on('open', () => {
      socket.send(JSON.stringify(['REQ', subId, { kinds: [KIND_ESCROW_DESCRIPTOR], limit: 50 }]));
    });

    socket.on('message', (data) => {
      let parsed;
      try { parsed = JSON.parse(data.toString()); } catch { return; }
      const [type, receivedSubId, event] = parsed;

      if (type === 'EVENT' && receivedSubId === subId) {
        events.push(event);
      }
      if (type === 'EOSE' && receivedSubId === subId) {
        eose = true;
        clearTimeout(timer);
        resolve({ relay: relayUrl, events });
        cleanup();
      }
    });

    socket.on('error', () => {
      if (!eose) {
        clearTimeout(timer);
        resolve({ relay: relayUrl, events });
      }
      cleanup();
    });

    socket.on('close', () => {
      if (!eose) {
        clearTimeout(timer);
        resolve({ relay: relayUrl, events });
      }
    });
  });
}

/**
 * Discover escrow descriptors from configured relays.
 * Returns { descriptors, relayResults }.
 */
async function discoverDescriptors(relayUrls) {
  const urls = (relayUrls && relayUrls.length > 0) ? relayUrls : DEFAULT_RELAYS;
  const relayResults = await Promise.all(urls.map(queryRelay));

  const descriptors = [];
  const seen = new Set();

  for (const result of relayResults) {
    for (const event of result.events) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);

      let content;
      try {
        content = JSON.parse(event.content);
      } catch {
        continue;
      }

      descriptors.push({
        eventId: event.id,
        pubkey: event.pubkey,
        created_at: event.created_at,
        tags: event.tags,
        descriptor: content,
        seenOn: [result.relay],
      });
    }
  }

  // Merge descriptors found on multiple relays
  const merged = [];
  const mergedSeen = new Map();
  for (const d of descriptors) {
    if (mergedSeen.has(d.eventId)) {
      mergedSeen.get(d.eventId).seenOn.push(d.seenOn[0]);
    } else {
      mergedSeen.set(d.eventId, d);
      merged.push(d);
    }
  }

  return { descriptors: merged, relayResults };
}

module.exports = { discoverDescriptors, KIND_ESCROW_DESCRIPTOR };