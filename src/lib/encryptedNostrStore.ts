import type { EventTemplate } from '@nostr/tools/pure';
import type { NostrEvent } from 'applesauce-core/helpers/event';
import { EventStore } from 'applesauce-core';
import { createAddressLoader } from 'applesauce-loaders/loaders';
import { RelayPool } from 'applesauce-relay';

import { getBasicUserWikiRelays, hasActiveSigner, signer } from './nostr';

export type VersionedStore<T> = {
  version: 1;
  updatedAt: number;
  items: T[];
};

const relayPool = new RelayPool();
const eventStore = new EventStore();
const addressLoader = createAddressLoader(relayPool, {
  eventStore,
  followRelayHints: true
});

function getStorage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

export function readVersionedStore<T>(
  key: string,
  fallback: T[] = [],
  parseLegacy?: (value: unknown) => T[]
): VersionedStore<T> {
  const storage = getStorage();
  if (!storage) {
    return { version: 1, updatedAt: 0, items: fallback };
  }

  const raw = storage.getItem(key);
  if (!raw) {
    return { version: 1, updatedAt: 0, items: fallback };
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Partial<VersionedStore<T>> & { items?: unknown };
      if (record.version === 1 && typeof record.updatedAt === 'number' && Array.isArray(record.items)) {
        return {
          version: 1,
          updatedAt: record.updatedAt,
          items: record.items as T[]
        };
      }
    }
    if (parseLegacy) {
      return { version: 1, updatedAt: 0, items: parseLegacy(parsed) };
    }
  } catch (e) {
    console.error(e);
  }

  return { version: 1, updatedAt: 0, items: fallback };
}

export function writeVersionedStore<T>(key: string, items: T[], updatedAt: number = Date.now()): void {
  const storage = getStorage();
  if (!storage) return;
  const payload: VersionedStore<T> = { version: 1, updatedAt, items };
  storage.setItem(key, JSON.stringify(payload));
}

export async function fetchLatestEncryptedEvent(pubkey: string, kind: number, dTags: string[]): Promise<NostrEvent | null> {
  const relays = await getBasicUserWikiRelays(pubkey);
  const pointer = {
    kind,
    pubkey,
    identifier: dTags[0],
    relays
  };
  let latestEvent: NostrEvent | null = null;

  await new Promise<void>((resolve) => {
    const sub = addressLoader(pointer).subscribe({
      next(evt) {
        const dTag = evt.tags.find((tag) => tag[0] === 'd')?.[1];
        if (!dTag || !dTags.includes(dTag)) return;
        const stored = eventStore.getReplaceable(kind, pubkey, dTag);
        latestEvent = stored ?? evt;
      },
      error(err) {
        console.error(`Failed to fetch encrypted event ${kind}:${dTags[0]}`, err);
        resolve();
      },
      complete() {
        resolve();
      }
    });

    setTimeout(() => {
      sub.unsubscribe();
      resolve();
    }, 3500);
  });

  return latestEvent ?? eventStore.getReplaceable(kind, pubkey, dTags[0]) ?? null;
}

export async function publishEncryptedEvent(
  pubkey: string,
  kind: number,
  dTag: string,
  payload: string
): Promise<void> {
  if (!hasActiveSigner()) {
    throw new Error('Unlock the passkey or connect a Nostr extension before syncing relays.');
  }
  const relays = await getBasicUserWikiRelays(pubkey);
  const content = await signer.encrypt(pubkey, payload);
  const eventTemplate: EventTemplate = {
    kind,
    tags: [['d', dTag]],
    content,
    created_at: Math.round(Date.now() / 1000)
  };

  const signedEvent = await signer.signEvent(eventTemplate);

  await relayPool.publish(relays, signedEvent);
}
