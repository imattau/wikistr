import type { Event } from '@nostr/tools/pure';

import {
  fetchLatestEncryptedEvent,
  publishEncryptedEvent,
  readVersionedStore,
  writeVersionedStore
} from './encryptedNostrStore';
import { signer } from './nostr';

export type DashboardPinnedItem = {
  dTag: string;
  pubkey: string;
  title: string;
};

export type DashboardHistoryItem = {
  dTag: string;
  pubkey: string;
  title: string;
  timestamp: number;
};

const DASHBOARD_LIST_KIND = 30003;
const PINNED_STORAGE_KEY = 'wikistr:pinned';
const HISTORY_STORAGE_KEY = 'wikistr:history';
const PINNED_LIST_DTAG = 'wikistr-pinned';
const HISTORY_LIST_DTAG = 'wikistr-history';

function replaceStoredListIfNewer<T>(key: string, items: T[], updatedAt: number): boolean {
  const current = readVersionedStore<T>(key, []);
  if (updatedAt <= current.updatedAt) {
    return false;
  }
  writeVersionedStore(key, items, updatedAt);
  return true;
}

async function fetchLatestDashboardListEvents(pubkey: string): Promise<Map<string, Event>> {
  const latestByDTag = new Map<string, Event>();
  const [pinned, history] = await Promise.all([
    fetchLatestEncryptedEvent(pubkey, DASHBOARD_LIST_KIND, [PINNED_LIST_DTAG]),
    fetchLatestEncryptedEvent(pubkey, DASHBOARD_LIST_KIND, [HISTORY_LIST_DTAG])
  ]);

  if (pinned) latestByDTag.set(PINNED_LIST_DTAG, pinned);
  if (history) latestByDTag.set(HISTORY_LIST_DTAG, history);

  return latestByDTag;
}

async function syncEncryptedList<T>(
  pubkey: string,
  latestByDTag: Map<string, Event>,
  dTag: string,
  storageKey: string
): Promise<boolean> {
  const latest = latestByDTag.get(dTag);
  if (!latest || !latest.content) {
    return false;
  }

  try {
    const plaintext = await signer.decrypt(pubkey, latest.content);
    const parsed = JSON.parse(plaintext);
    const items = Array.isArray(parsed) ? (parsed as T[]) : [];
    const changed = replaceStoredListIfNewer(storageKey, items, latest.created_at * 1000);
    if (changed && typeof window !== 'undefined') {
      window.dispatchEvent(new Event('wikistr:dashboard-update'));
    }
    return changed;
  } catch (e) {
    console.error(`Failed to sync encrypted dashboard list ${dTag}`, e);
    return false;
  }
}

async function publishEncryptedList<T>(pubkey: string, dTag: string, storageKey: string): Promise<void> {
  const stored = readVersionedStore<T>(storageKey, []);
  await publishEncryptedEvent(pubkey, DASHBOARD_LIST_KIND, dTag, JSON.stringify(stored.items));
}

export function getPinnedDashboardItems(): DashboardPinnedItem[] {
  return readVersionedStore<DashboardPinnedItem>(PINNED_STORAGE_KEY, []).items;
}

export function getRecentDashboardItems(): DashboardHistoryItem[] {
  return readVersionedStore<DashboardHistoryItem>(HISTORY_STORAGE_KEY, []).items;
}

export function setPinnedDashboardItems(items: DashboardPinnedItem[], updatedAt?: number): void {
  writeVersionedStore(PINNED_STORAGE_KEY, items, updatedAt);
}

export function setRecentDashboardItems(items: DashboardHistoryItem[], updatedAt?: number): void {
  writeVersionedStore(HISTORY_STORAGE_KEY, items, updatedAt);
}

export async function syncDashboardListsFromRelays(pubkey: string): Promise<void> {
  try {
    const latestByDTag = await fetchLatestDashboardListEvents(pubkey);
    await Promise.all([
      syncEncryptedList<DashboardPinnedItem>(pubkey, latestByDTag, PINNED_LIST_DTAG, PINNED_STORAGE_KEY),
      syncEncryptedList<DashboardHistoryItem>(pubkey, latestByDTag, HISTORY_LIST_DTAG, HISTORY_STORAGE_KEY)
    ]);
  } catch (e) {
    console.error('Failed to sync dashboard lists from relays', e);
  }
}

export async function publishPinnedDashboardList(pubkey: string): Promise<void> {
  try {
    await publishEncryptedList<DashboardPinnedItem>(pubkey, PINNED_LIST_DTAG, PINNED_STORAGE_KEY);
  } catch (e) {
    console.error('Failed to publish pinned dashboard list', e);
  }
}

export async function publishRecentDashboardList(pubkey: string): Promise<void> {
  try {
    await publishEncryptedList<DashboardHistoryItem>(pubkey, HISTORY_LIST_DTAG, HISTORY_STORAGE_KEY);
  } catch (e) {
    console.error('Failed to publish recent dashboard list', e);
  }
}
