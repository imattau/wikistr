<script lang="ts">
  import {
    signer,
    account,
    userWikiRelays,
    completePasskeySession,
    logout,
    hasActiveSigner
  } from '$lib/nostr';
  import {
    hasStoredPasskeyIdentity,
    registerPasskeyIdentity,
    importPasskeyIdentityFromNsec,
    unlockPasskeyIdentity,
    clearPasskeyIdentity,
    isPRFSupported
  } from '$lib/passkeyIdentity';
  import type { ArticleCard, Card } from '$lib/types';
  import { next, urlWithoutScheme } from '$lib/utils';
  import { safeImageUrl } from '$lib/security';
  import { onMount } from 'svelte';
  import New from './New.svelte';
  import {
    fetchPrivateTagsFromRelays,
    getPrivateTagsMap
  } from '$lib/privateTagsSync';
  import {
    getPinnedDashboardItems,
    getRecentDashboardItems,
    syncDashboardListsFromRelays
  } from '$lib/dashboardListsSync';

  interface Props {
    createChild: (card: Card) => void;
  }

  let { createChild }: Props = $props();

  let pinnedList = $state<{ dTag: string; pubkey: string; title: string }[]>([]);
  let historyList = $state<{ dTag: string; pubkey: string; title: string; timestamp: number }[]>([]);
  let showRelays = $state(false);
  let privateTagsMap = $state<{ [tag: string]: { dTag: string; pubkey: string; title: string }[] }>({});
  let activePrivateTag = $state<string | null>(null);
  let syncingFromRelays = $state(false);

  function loadPrivateTagsMap() {
    try {
      const allPrivateTags = getPrivateTagsMap();

      const allItems = [...getPinnedDashboardItems(), ...getRecentDashboardItems()];
      
      const map: typeof privateTagsMap = {};
      
      Object.entries(allPrivateTags).forEach(([key, tags]) => {
        const [pubkey, dTag] = key.split(':');
        const match = allItems.find((x) => x.dTag === dTag && x.pubkey === pubkey);
        const title = match ? match.title : dTag;
        
        if (Array.isArray(tags)) {
          tags.forEach((tag) => {
            if (!map[tag]) map[tag] = [];
            map[tag].push({ dTag, pubkey, title });
          });
        }
      });
      
      privateTagsMap = map;
    } catch (e) {
      console.error(e);
    }
  }

  function loadDashboardData() {
    try {
      pinnedList = getPinnedDashboardItems();
      historyList = getRecentDashboardItems();

      loadPrivateTagsMap();
    } catch (e) {
      console.error(e);
    }
  }

  function openArticleByCoordinate(dTag: string, pubkey: string) {
    createChild({
      id: next(),
      type: 'article',
      data: [dTag, pubkey],
      relayHints: []
    } as ArticleCard);
  }

  let passkeySupported = $state(false);
  let hasStoredPasskey = $state(false);
  let showImportInput = $state(false);
  let importNsecValue = $state('');
  let signerReady = $state(hasActiveSigner());

  $effect(() => {
    if ($account && signerReady) {
      void syncDashboardListsFromRelays($account.pubkey);
      void fetchPrivateTagsFromRelays($account.pubkey);
    }
  });

  onMount(() => {
    signerReady = hasActiveSigner();
    loadDashboardData();
    window.addEventListener('storage', loadDashboardData);
    window.addEventListener('wikistr:dashboard-update', loadDashboardData);
    
    isPRFSupported().then((supported) => {
      passkeySupported = supported;
    });
    hasStoredPasskey = hasStoredPasskeyIdentity();

    return () => {
      window.removeEventListener('storage', loadDashboardData);
      window.removeEventListener('wikistr:dashboard-update', loadDashboardData);
    };
  });

  async function doLogin() {
    signerReady = true;
    try {
      await signer.getPublicKey();
    } catch (e) {
      signerReady = hasActiveSigner();
      console.error(e);
      alert(e instanceof Error ? e.message : 'Extension login failed');
    }
  }

  async function handlePasskeyRegister() {
    try {
      signerReady = true;
      const { secretKey, pubkey } = await registerPasskeyIdentity();
      await completePasskeySession(secretKey, pubkey);
      hasStoredPasskey = hasStoredPasskeyIdentity();
    } catch (e) {
      signerReady = hasActiveSigner();
      console.error(e);
      alert(e instanceof Error ? e.message : 'Passkey registration failed');
    }
  }

  async function handlePasskeyUnlock() {
    try {
      signerReady = true;
      const { secretKey, pubkey } = await unlockPasskeyIdentity();
      await completePasskeySession(secretKey, pubkey);
    } catch (e) {
      signerReady = hasActiveSigner();
      console.error(e);
      alert(e instanceof Error ? e.message : 'Passkey unlock failed');
    }
  }

  async function handlePasskeyImport() {
    if (!importNsecValue) return;
    try {
      signerReady = true;
      const { secretKey, pubkey } = await importPasskeyIdentityFromNsec(importNsecValue);
      await completePasskeySession(secretKey, pubkey);
      hasStoredPasskey = hasStoredPasskeyIdentity();
      showImportInput = false;
      importNsecValue = '';
    } catch (e) {
      signerReady = hasActiveSigner();
      console.error(e);
      alert(e instanceof Error ? e.message : 'Passkey import failed');
    }
  }

  function handlePasskeyClear() {
    if (confirm('Are you sure you want to remove the passkey record from this browser? The private key will remain on the Nostr network, but you will no longer be able to unlock it on this device unless you import it again.')) {
      clearPasskeyIdentity();
      hasStoredPasskey = false;
    }
  }

  async function handleLogout() {
    await logout();
    signerReady = false;
  }

  async function handleSyncFromRelays() {
    if (!$account?.pubkey || syncingFromRelays) return;
    if (!signerReady) {
      alert('Unlock the passkey or connect a Nostr extension before syncing from relays.');
      return;
    }
    syncingFromRelays = true;
    try {
      await syncDashboardListsFromRelays($account.pubkey);
      await fetchPrivateTagsFromRelays($account.pubkey);
      loadDashboardData();
    } finally {
      syncingFromRelays = false;
    }
  }

  function replaceNewCard(newCard: Card) {
    createChild(newCard);
  }
</script>

<div class="font-bold text-3xl text-stone-850">Account</div>
<div class="mb-6 mt-3">
  {#if $account}
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between p-4 bg-white border border-stone-200 rounded-xl shadow-sm">
      <div class="flex items-start gap-3 min-w-0">
        {#if safeImageUrl($account.image)}
          <img class="h-12 w-12 rounded-full object-cover border border-stone-200" src={safeImageUrl($account.image)!} alt="user avatar" />
        {:else}
          <div class="h-12 w-12 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 font-bold uppercase">
            {$account.shortName?.slice(0, 2) || 'US'}
          </div>
        {/if}
        <div class="min-w-0">
          <p class="font-semibold text-stone-900 leading-tight break-words">{$account.shortName || 'Nostr User'}</p>
          <p class="text-xs text-stone-500 font-mono mt-1 break-all max-w-full sm:max-w-64">{$account.npub}</p>
        </div>
      </div>
      <button
        onclick={handleLogout}
        type="button"
        class="inline-flex w-full sm:w-auto justify-center items-center px-3 py-2 border border-stone-200 hover:border-red-200 text-xs font-semibold rounded-lg bg-white hover:bg-red-50 text-stone-700 hover:text-red-700 transition-all focus:outline-none shadow-sm cursor-pointer sm:mt-0"
      >
        Logout
      </button>
    </div>
    <div class="mt-3 flex justify-end">
      <button
        onclick={handleSyncFromRelays}
        type="button"
        disabled={syncingFromRelays || !signerReady}
        class="inline-flex items-center justify-center px-3 py-2 border border-stone-200 hover:border-indigo-200 disabled:opacity-60 disabled:cursor-wait text-xs font-semibold rounded-lg bg-white hover:bg-indigo-50 text-stone-700 hover:text-indigo-700 transition-all focus:outline-none shadow-sm cursor-pointer"
      >
        {syncingFromRelays ? 'Syncing...' : signerReady ? 'Sync from Relays' : 'Unlock to Sync'}
      </button>
    </div>
  {:else}
    <div class="bg-stone-50/50 border border-stone-200 rounded-xl p-4 sm:p-5 shadow-sm">
      <div class="flex flex-col gap-3">
        <button
          onclick={doLogin}
          type="button"
          class="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-transparent text-sm font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow transition-all focus:outline-none cursor-pointer whitespace-normal text-center"
        >
          <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
          </svg>
          Connect Nostr Extension
        </button>

        {#if passkeySupported}
          {#if hasStoredPasskey}
            <button
              onclick={handlePasskeyUnlock}
              type="button"
              class="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-stone-300 rounded-lg bg-white hover:bg-stone-50 text-stone-700 font-medium shadow-sm transition-all focus:outline-none cursor-pointer whitespace-normal text-center"
            >
              <svg class="w-4 h-4 shrink-0 text-emerald-600" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M18 8a6 6 0 01-7.743 5.743L10 14l-1 1-1 1H6v-2l2-2 1.257-1.257A6 6 0 1118 8zm-6-4a1 1 0 100 2 1 1 0 000-2z" clip-rule="evenodd" />
              </svg>
              Unlock with Passkey
            </button>
          {:else}
            <button
              onclick={handlePasskeyRegister}
              type="button"
              class="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-stone-300 rounded-lg bg-white hover:bg-stone-50 text-stone-700 font-medium shadow-sm transition-all focus:outline-none cursor-pointer whitespace-normal text-center"
            >
              <svg class="w-4 h-4 shrink-0 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
              Sign up with Passkey
            </button>
          {/if}
        {/if}
      </div>

      {#if passkeySupported}
        <div class="mt-4 pt-4 border-t border-stone-200 flex flex-wrap items-center justify-between text-xs text-stone-500 gap-2">
          {#if !hasStoredPasskey}
            <button
              onclick={() => showImportInput = !showImportInput}
              class="text-indigo-600 hover:text-indigo-800 hover:underline focus:outline-none cursor-pointer"
            >
              Or import existing key (nsec) with Passkey
            </button>
          {:else}
            <span class="text-stone-400">Passkey registered on this device</span>
            <button
              onclick={handlePasskeyClear}
              class="text-red-600 hover:text-red-800 hover:underline focus:outline-none cursor-pointer"
            >
              Remove passkey from device
            </button>
          {/if}
        </div>

        {#if showImportInput && !hasStoredPasskey}
          <form
            onsubmit={(e) => { e.preventDefault(); handlePasskeyImport(); }}
            class="mt-3 p-3 bg-white border border-stone-200 rounded-lg shadow-inner"
          >
            <label class="block text-xs font-semibold text-stone-600 mb-1" for="nsec-input">
              Nostr Secret Key (nsec1... or 64-char hex)
            </label>
            <div class="flex flex-col sm:flex-row gap-2">
              <input
                id="nsec-input"
                type="password"
                bind:value={importNsecValue}
                placeholder="nsec1..."
                class="w-full flex-1 px-3 py-1.5 border border-stone-300 rounded-lg text-sm font-mono focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none min-w-0"
              />
              <button
                type="submit"
                class="w-full sm:w-auto px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium shadow-sm transition-all cursor-pointer"
              >
                Import
              </button>
            </div>
            <p class="mt-1 text-[10px] text-stone-400">
              The key will be encrypted and stored locally. It never leaves your browser.
            </p>
          </form>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<div class="my-6 p-4 border border-stone-200 rounded-lg bg-stone-50/50">
  <New {replaceNewCard} />
</div>

{#if pinnedList.length > 0}
  <div class="my-6 p-4 border border-stone-200 rounded-lg bg-stone-50/50">
    <h2 class="font-bold text-lg text-stone-700 mb-3 flex items-center space-x-2">
      <svg xmlns="http://www.w3.org/2000/svg" fill="#eab308" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 text-amber-500">
        <path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
      </svg>
      <span>Pinned Pages</span>
    </h2>
    <div class="space-y-2">
      {#each pinnedList as pin}
        <button 
          onclick={() => openArticleByCoordinate(pin.dTag, pin.pubkey)}
          class="w-full text-left p-2 rounded bg-white border border-stone-100 hover:border-indigo-300 hover:shadow-sm transition-all text-sm font-medium text-stone-800 flex items-center justify-between"
        >
          <span class="truncate">{pin.title}</span>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4 text-stone-400">
            <path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      {/each}
    </div>
  </div>
{/if}

{#if historyList.length > 0}
  <div class="my-6 p-4 border border-stone-200 rounded-lg bg-stone-50/50">
    <h2 class="font-bold text-lg text-stone-700 mb-3 flex items-center space-x-2">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 text-indigo-500">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
      <span>Recently Viewed</span>
    </h2>
    <div class="space-y-2">
      {#each historyList as hist}
        <button 
          onclick={() => openArticleByCoordinate(hist.dTag, hist.pubkey)}
          class="w-full text-left p-2 rounded bg-white border border-stone-100 hover:border-indigo-300 hover:shadow-sm transition-all text-sm font-medium text-stone-800 flex items-center justify-between"
        >
          <span class="truncate">{hist.title}</span>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4 text-stone-400">
            <path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      {/each}
    </div>
  </div>
{/if}

{#if Object.keys(privateTagsMap).length > 0}
  <div class="my-6 p-4 border border-stone-200 rounded-lg bg-stone-50/50">
    <h2 class="font-bold text-lg text-stone-700 mb-3 flex items-center space-x-2">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5 text-amber-500">
        <path fill-rule="evenodd" d="M12 1.5a5.25 5.25 0 0 0-5.25 5.25v3a3 3 0 0 0-3 3v6.75a3 3 0 0 0 3 3h10.5a3 3 0 0 0 3-3v-6.75a3 3 0 0 0-3-3v-3c0-2.9-2.35-5.25-5.25-5.25Zm3.75 8.25v-3a3.75 3.75 0 1 0-7.5 0v3h7.5Z" clip-rule="evenodd" />
      </svg>
      <span>Your Private Tags</span>
    </h2>
    <div class="flex flex-wrap gap-1.5 mb-3">
      {#each Object.keys(privateTagsMap) as tag}
        <button 
          onclick={() => activePrivateTag = activePrivateTag === tag ? null : tag}
          class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border transition-all {activePrivateTag === tag ? 'bg-amber-100 text-amber-800 border-amber-300 shadow-sm' : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50'}"
        >
          #{tag} ({privateTagsMap[tag].length})
        </button>
      {/each}
    </div>
    
    {#if activePrivateTag && privateTagsMap[activePrivateTag]}
      <div class="space-y-2 border-t border-stone-200/60 pt-3">
        {#each privateTagsMap[activePrivateTag] as item}
          <button 
            onclick={() => openArticleByCoordinate(item.dTag, item.pubkey)}
            class="w-full text-left p-2 rounded bg-white border border-stone-100 hover:border-indigo-300 hover:shadow-sm transition-all text-xs font-medium text-stone-700 flex items-center justify-between"
          >
            <span class="truncate">{item.title}</span>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3.5 h-3.5 text-stone-400">
              <path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<div class="my-6 p-4 border border-stone-200 rounded-lg bg-stone-50/50">
  <button 
    onclick={() => showRelays = !showRelays}
    class="flex items-center justify-between w-full font-bold text-lg text-stone-700 focus:outline-none"
  >
    <span class="flex items-center space-x-2">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 text-indigo-500">
        <path stroke-linecap="round" stroke-linejoin="round" d="M15.59 14.37a6 6 0 0 1-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 0 0 6.16-12.12A14.98 14.98 0 0 0 9.631 8.41m5.96 5.96a14.926 14.926 0 0 1-5.841 2.58m-.119-8.54a6 6 0 0 0-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 0 0-2.58 5.84m2.699-2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 0 1-2.448-2.448 14.9 14.9 0 0 1 .06-.312m-2.24 2.39a4.493 4.493 0 0 0-1.757 4.306 4.493 4.493 0 0 0 4.306-1.758M16.5 9a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" />
      </svg>
      <span>Relays ({$userWikiRelays.length})</span>
    </span>
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 transform transition-transform {showRelays ? 'rotate-180' : ''}">
      <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
    </svg>
  </button>
  
  {#if showRelays}
    <div class="mt-4 space-y-2 max-h-48 overflow-y-auto scrollbar-thin">
      {#each $userWikiRelays as url}
        <div class="flex items-center justify-between p-2 rounded bg-white border border-stone-100 hover:bg-stone-50 text-sm">
          <span class="font-mono text-stone-600 truncate mr-2">{urlWithoutScheme(url)}</span>
          <div class="flex items-center space-x-1.5 flex-shrink-0">
            <span class="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm" title="Connected"></span>
            <button 
              onclick={() => createChild({ id: next(), type: 'relay', data: url })}
              class="text-xs text-indigo-600 hover:underline"
            >
              Details
            </button>
          </div>
        </div>
      {/each}
      <button 
        onclick={() => createChild({ id: next(), type: 'settings' })}
        class="w-full text-center py-1.5 mt-2 text-xs font-semibold text-indigo-600 hover:text-indigo-800 border border-dashed border-indigo-200 rounded hover:border-indigo-400 bg-indigo-50/20 transition-all"
      >
        Configure Relays
      </button>
    </div>
  {/if}
</div>
