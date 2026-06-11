import { derived, readable } from 'svelte/store';
import * as idbkv from 'idb-keyval';

import type { EventTemplate, Event } from '@nostr/tools/pure';
import type { PasskeySignerShim } from './passkeyIdentity';
import { buildPasskeySignerShim, hexToBytes, bytesToHex, isPasskeyShim } from './passkeyIdentity';

let passkeySignerShim: PasskeySignerShim | null = null;
let restoredPasskeyPubkey: string | null = null;
let nostrBridgePromise: Promise<void> | null = null;

function hasActivePasskeySession(): boolean {
  if (passkeySignerShim) {
    return true;
  }
  if (typeof window === 'undefined') {
    return false;
  }
  return (
    sessionStorage.getItem('wikistr:passkey_session_nsec') !== null &&
    sessionStorage.getItem('wikistr:passkey_session_pubkey') !== null
  );
}

async function ensureWindowNostrBridge(): Promise<void> {
  if (typeof window === 'undefined' || (window as any).nostr || hasActivePasskeySession()) {
    return;
  }

  if (!nostrBridgePromise) {
    nostrBridgePromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/window.nostr.js/dist/window.nostr.js';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load window.nostr.js'));
      document.head.appendChild(script);
    }).finally(() => {
      nostrBridgePromise = null;
    });
  }

  await nostrBridgePromise;
}

function getActiveSigner(): PasskeySignerShim | null {
  if (passkeySignerShim) {
    return passkeySignerShim;
  }
  if (typeof window === 'undefined') {
    return null;
  }
  const nostr = (window as any).nostr;
  return nostr && typeof nostr.getPublicKey === 'function' && typeof nostr.signEvent === 'function'
    ? (nostr as PasskeySignerShim)
    : null;
}

export function hasActiveSigner(): boolean {
  return getActiveSigner() !== null;
}

if (typeof window !== 'undefined') {
  const sessionNsec = sessionStorage.getItem('wikistr:passkey_session_nsec');
  if (sessionNsec) {
    try {
      const secretKey = hexToBytes(sessionNsec);
      passkeySignerShim = buildPasskeySignerShim(secretKey);
      (window as any).nostr = passkeySignerShim;
      restoredPasskeyPubkey = sessionStorage.getItem('wikistr:passkey_session_pubkey');
    } catch (e) {
      sessionStorage.removeItem('wikistr:passkey_session_nsec');
      sessionStorage.removeItem('wikistr:passkey_session_pubkey');
      console.error('Failed to restore passkey session', e);
    }
  }
}
import { DEFAULT_WIKI_RELAYS } from './defaults';
import { unique } from './utils';
import { filterSecureRelays } from './security';
import {
  loadFollowsList,
  loadRelayList,
  loadWikiAuthors,
  loadWikiRelays,
  type Result
} from '@nostr/gadgets/lists';
import { loadNostrUser, type NostrUser } from '@nostr/gadgets/metadata';

const startTime = Math.round(Date.now() / 1000);

export const reactionKind = 7;
export const wikiKind = 30818;
export const gitPatchKind = 1617;

export const signer = {
  getPublicKey: async () => {
    let nostr = getActiveSigner();
    if (!nostr && typeof window !== 'undefined') {
      await ensureWindowNostrBridge();
      nostr = getActiveSigner();
    }
    if (!nostr) {
      throw new Error('No Nostr signer is available.')
    }
    const pubkey = await nostr.getPublicKey();
    setAccount(pubkey);
    return pubkey;
  },
  signEvent: async (event: EventTemplate): Promise<Event> => {
    let nostr = getActiveSigner();
    if (!nostr && typeof window !== 'undefined') {
      await ensureWindowNostrBridge();
      nostr = getActiveSigner();
    }
    if (!nostr) {
      throw new Error('No Nostr signer is available.')
    }
    const se: Event = await nostr.signEvent(event);
    setAccount(se.pubkey);
    return se;
  },
  encrypt: async (pubkey: string, plaintext: string): Promise<string> => {
    let nostr = getActiveSigner();
    if (!nostr && typeof window !== 'undefined') {
      await ensureWindowNostrBridge();
      nostr = getActiveSigner();
    }
    if (!nostr) {
      throw new Error('No Nostr signer is available.')
    }
    return await nostr.nip04.encrypt(pubkey, plaintext);
  },
  decrypt: async (pubkey: string, ciphertext: string): Promise<string> => {
    let nostr = getActiveSigner();
    if (!nostr && typeof window !== 'undefined') {
      await ensureWindowNostrBridge();
      nostr = getActiveSigner();
    }
    if (!nostr) {
      throw new Error('No Nostr signer is available.')
    }
    return await nostr.nip04.decrypt(pubkey, ciphertext);
  }
};

let setWOT: (_: string) => Promise<void>;
export const wot = readable<{ [pubkey: string]: number }>({}, (set) => {
  setWOT = async (pubkey) => {
    const cached = await idbkv.get('wikistr:wot');
    if (cached && cached.when > startTime - 7 * 24 * 60 * 60) {
      set(cached.scoremap);
      return;
    }

    const scoremap: { [pubkey: string]: number } = {};
    await Promise.all([
      recurse(loadFollowsList, 10, pubkey, 30),
      recurse(loadWikiAuthors, 6, pubkey, 30)
    ]);
    idbkv.set(`wikistr:wot`, { when: startTime, scoremap });
    set(scoremap);

    async function recurse(
      fetch: (srcpk: string) => Promise<Result<string>>,
      degrade: number,
      src: string,
      score: number
    ) {
      scoremap[src] = (scoremap[src] || 0) + score;

      if (score <= degrade) return;

      const nextkeys = await fetch(src);
      await Promise.all(
        nextkeys.items.map(async (next) => {
          return recurse(fetch, degrade, next, score - degrade);
        })
      );
    }
  };
});

let setAccount: (_: string | null) => Promise<void>;
export const account = readable<NostrUser | null>(null, (set) => {
  setAccount = async (pubkey: string | null) => {
    if (!pubkey) {
      await idbkv.del('wikistr:loggedin');
      set(null);
      return;
    }
    const account = await loadNostrUser(pubkey);
    idbkv.set('wikistr:loggedin', account);
    set(account);
  };

  if (restoredPasskeyPubkey) {
    setAccount(restoredPasskeyPubkey);
    restoredPasskeyPubkey = null;
    return;
  }

  // try to load account from local storage on startup
  setTimeout(async () => {
    const data = await idbkv.get('wikistr:loggedin');
    if (data) set(data);
  }, 700);
});

export async function completePasskeySession(secretKey: Uint8Array, pubkey: string): Promise<void> {
  sessionStorage.setItem('wikistr:passkey_session_nsec', bytesToHex(secretKey));
  sessionStorage.setItem('wikistr:passkey_session_pubkey', pubkey);
  passkeySignerShim = buildPasskeySignerShim(secretKey);
  (window as any).nostr = passkeySignerShim;
  await setAccount(pubkey);
}

export async function logout(): Promise<void> {
  sessionStorage.removeItem('wikistr:passkey_session_nsec');
  sessionStorage.removeItem('wikistr:passkey_session_pubkey');
  passkeySignerShim = null;
  if (typeof window !== 'undefined') {
    if (isPasskeyShim((window as any).nostr)) {
      delete (window as any).nostr;
    }
  }
  await setAccount(null);
}

const unsub = account.subscribe((account) => {
  if (account) {
    setTimeout(() => {
      setWOT(account.pubkey);
      unsub();
    }, 300);
  }
});

// ensure these subscriptions are always on
account.subscribe(() => {});
wot.subscribe(() => {});

export const userWikiRelays = derived(
  account,
  (account, set) => {
    if (account) {
      getBasicUserWikiRelays(account.pubkey).then(set);
    } else {
      let customRelays: string[] = [];
      if (typeof window !== 'undefined') {
        const customStored = localStorage.getItem('wikistr:custom-relays');
        if (customStored) {
          try {
            customRelays = filterSecureRelays(JSON.parse(customStored));
          } catch (e) {}
        }
      }
      set(filterSecureRelays(unique(customRelays, DEFAULT_WIKI_RELAYS)));
    }
  },
  DEFAULT_WIKI_RELAYS
);

export async function getBasicUserWikiRelays(pubkey: string): Promise<string[]> {
  let customRelays: string[] = [];
  if (typeof window !== 'undefined') {
    const customStored = localStorage.getItem('wikistr:custom-relays');
    if (customStored) {
      try {
        customRelays = filterSecureRelays(JSON.parse(customStored));
      } catch (e) {}
    }
  }

  const [rl1, rl2, rl3] = await Promise.all([
    loadWikiRelays(pubkey).then((rl) => filterSecureRelays(rl.items)).catch(() => []),
    Promise.all((await loadWikiAuthors(pubkey).catch(() => ({ items: [] }))).items.map((pk) => loadRelayList(pk).catch(() => null))).then((rll) =>
      rll
        .filter((rl): rl is Exclude<typeof rl, null> => rl !== null)
        .map((rl) => rl.items)
        .flat()
        .filter((ri) => ri.write)
        .map((ri) => ri.url)
        .filter((url) => filterSecureRelays([url]).length > 0)
    ).catch(() => []),
    loadRelayList(pubkey).then((rl) =>
      filterSecureRelays(rl.items.filter((ri) => ri.write).map((ri) => ri.url))
    ).catch(() => [])
  ]);

  let list = unique(customRelays, rl1, rl2, rl3);
  if (list.length < 2) {
    list = unique(list, DEFAULT_WIKI_RELAYS);
  }

  return list;
}
