import {
  fetchLatestEncryptedEvent,
  publishEncryptedEvent,
  readVersionedStore,
  writeVersionedStore
} from './encryptedNostrStore';
import { hasActiveSigner, signer, wikiKind } from './nostr';

type PrivateTagsMap = { [key: string]: string[] };
type PrivateTagsEntry = { key: string; tags: string[] };

const STORAGE_KEY = 'wikistr:private-tags';
const PRIVATE_TAGS_DTAG = 'wikistr-private-tags';
const PRIVATE_TAGS_KIND = 30003;

function normalizeMap(map: PrivateTagsMap): PrivateTagsMap {
  const normalized: PrivateTagsMap = {};
  Object.entries(map).forEach(([key, list]) => {
    if (!Array.isArray(list)) return;
    const cleaned = [...new Set(list.filter((tag) => typeof tag === 'string' && tag.trim()))].sort();
    if (cleaned.length > 0) {
      normalized[key] = cleaned;
    }
  });
  return normalized;
}

function storeToMap(items: PrivateTagsEntry[]): PrivateTagsMap {
  const map: PrivateTagsMap = {};
  items.forEach((item) => {
    if (!item || typeof item.key !== 'string' || !Array.isArray(item.tags)) return;
    map[item.key] = [...new Set(item.tags.filter((tag) => typeof tag === 'string' && tag.trim()))];
  });
  return normalizeMap(map);
}

function parseLegacyEntries(value: unknown): PrivateTagsEntry[] {
  const map: PrivateTagsMap = {};

  if (Array.isArray(value)) {
    value.forEach((tagArray) => {
      if (!Array.isArray(tagArray) || tagArray[0] !== 'a') return;
      const coord = tagArray[1];
      const label = tagArray[3];
      if (typeof coord !== 'string' || typeof label !== 'string' || !coord.startsWith(`${wikiKind}:`)) return;
      const key = coord.substring(`${wikiKind}:`.length);
      if (!map[key]) map[key] = [];
      if (!map[key].includes(label)) map[key].push(label);
    });
  } else if (value && typeof value === 'object') {
    Object.entries(value as Record<string, unknown>).forEach(([key, tags]) => {
      if (!Array.isArray(tags)) return;
      map[key] = tags.filter((tag): tag is string => typeof tag === 'string');
    });
  }

  return Object.entries(normalizeMap(map)).map(([key, tags]) => ({ key, tags }));
}

function readStoredMap(): PrivateTagsMap {
  const store = readVersionedStore<PrivateTagsEntry>(STORAGE_KEY, [], parseLegacyEntries).items;
  return storeToMap(store);
}

function writeStoredMap(map: PrivateTagsMap): void {
  writeVersionedStore<PrivateTagsEntry>(
    STORAGE_KEY,
    Object.entries(normalizeMap(map)).map(([key, tags]) => ({ key, tags }))
  );
}

function decryptAndParsePrivateTags(content: string): PrivateTagsMap {
  const parsed = JSON.parse(content);
  if (Array.isArray(parsed)) {
    return storeToMap(parseLegacyEntries(parsed));
  }
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown }).items)) {
    return storeToMap((parsed as { items: PrivateTagsEntry[] }).items);
  }
  return storeToMap(parseLegacyEntries(parsed));
}

export function getPrivateTagsMap(): PrivateTagsMap {
  return readStoredMap();
}

export function getPrivateTagsForArticle(pubkey: string, dTag: string): string[] {
  return getPrivateTagsMap()[`${pubkey}:${dTag}`] || [];
}

export function setPrivateTagsForArticle(pubkey: string, dTag: string, tags: string[]): void {
  const key = `${pubkey}:${dTag}`;
  const map = getPrivateTagsMap();
  const nextTags = [...new Set(tags.filter((tag) => typeof tag === 'string' && tag.trim().length > 0))].sort();
  if (nextTags.length > 0) {
    map[key] = nextTags;
  } else {
    delete map[key];
  }
  writeStoredMap(map);
}

export async function fetchPrivateTagsFromRelays(pubkey: string): Promise<void> {
  if (!hasActiveSigner()) {
    return;
  }
  try {
    const latestEvent = await fetchLatestEncryptedEvent(pubkey, PRIVATE_TAGS_KIND, [PRIVATE_TAGS_DTAG]);
    if (!latestEvent?.content) return;

    const plaintext = await signer.decrypt(pubkey, latestEvent.content);
    const nextMap = decryptAndParsePrivateTags(plaintext);
    writeStoredMap(nextMap);
    window.dispatchEvent(new Event('wikistr:dashboard-update'));
  } catch (e) {
    console.error('Failed to sync private tags from relays', e);
  }
}

export async function publishPrivateTagsToRelays(pubkey: string): Promise<void> {
  try {
    const store = readVersionedStore<PrivateTagsEntry>(STORAGE_KEY, [], parseLegacyEntries);
    await publishEncryptedEvent(pubkey, PRIVATE_TAGS_KIND, PRIVATE_TAGS_DTAG, JSON.stringify(store));
  } catch (e) {
    console.error('Failed to publish private tags to relays', e);
  }
}
