import type { Event, EventTemplate } from '@nostr/tools/pure';
import { pool } from '@nostr/gadgets/global';

import { getBasicUserWikiRelays, signer } from './nostr';

export type VersionedStore<T> = {
  version: 1;
  updatedAt: number;
  items: T[];
};

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

export async function fetchLatestEncryptedEvent(pubkey: string, kind: number, dTags: string[]): Promise<Event | null> {
  const relays = await getBasicUserWikiRelays(pubkey);
  let latestEvent: Event | null = null;

  await new Promise<void>((resolve) => {
    const sub = pool.subscribeMany(
      relays,
      [
        {
          kinds: [kind],
          authors: [pubkey],
          '#d': dTags
        }
      ],
      {
        id: `fetch-encrypted-${kind}`,
        onevent(evt) {
          const dTag = evt.tags.find((tag) => tag[0] === 'd')?.[1];
          if (!dTag || !dTags.includes(dTag)) return;
          if (!latestEvent || evt.created_at > latestEvent.created_at) {
            latestEvent = evt;
          }
        },
        oneose() {
          sub.close();
          resolve();
        }
      }
    );

    setTimeout(() => {
      sub.close();
      resolve();
    }, 3500);
  });

  return latestEvent;
}

export async function publishEncryptedEvent(
  pubkey: string,
  kind: number,
  dTag: string,
  payload: string
): Promise<void> {
  const relays = await getBasicUserWikiRelays(pubkey);
  const content = await signer.encrypt(pubkey, payload);
  const eventTemplate: EventTemplate = {
    kind,
    tags: [['d', dTag]],
    content,
    created_at: Math.round(Date.now() / 1000)
  };

  const signedEvent = await signer.signEvent(eventTemplate);

  await Promise.all(
    relays.map(async (url) => {
      try {
        const relay = await pool.ensureRelay(url);
        await relay.publish(signedEvent);
      } catch (err) {
        console.error(`Failed to publish encrypted event ${kind}:${dTag} to relay ${url}`, err);
      }
    })
  );
}
