<script lang="ts">
  import debounce from 'debounce';
  import { onDestroy } from 'svelte';
  import type { SubCloser } from '@nostr/tools/abstract-pool';
  import type { AbstractRelay } from '@nostr/tools/abstract-relay';
  import type { Event, NostrEvent } from '@nostr/tools/pure';

  import {
    signer,
    wikiKind,
    account,
    wot,
    getBasicUserWikiRelays,
    userWikiRelays
  } from '$lib/nostr';
  import type { ArticleCard, Card } from '$lib/types';
  import { addUniqueTaggedReplaceable, getTagOr, next } from '$lib/utils';
  import { subscribeAllOutbox } from '$lib/outbox';
  import ArticleListItem from '$components/ArticleListItem.svelte';
  import { onMount } from 'svelte';
  import RelayItem from '$components/RelayItem.svelte';
  import { DEFAULT_WIKI_RELAYS } from '$lib/defaults';
  import { pool } from '@nostr/gadgets/global';
  import { urlWithoutScheme } from '$lib/utils';
  import New from './New.svelte';

  interface Props {
    createChild: (card: Card) => void;
  }

  let { createChild }: Props = $props();
  let seenCache: { [id: string]: string[] } = {};

  let pinnedList = $state<{ dTag: string; pubkey: string; title: string }[]>([]);
  let historyList = $state<{ dTag: string; pubkey: string; title: string; timestamp: number }[]>([]);
  let showRelays = $state(false);

  function loadDashboardData() {
    try {
      const storedPinned = localStorage.getItem('wikistr:pinned');
      pinnedList = storedPinned ? JSON.parse(storedPinned) : [];
      if (!Array.isArray(pinnedList)) pinnedList = [];

      const storedHistory = localStorage.getItem('wikistr:history');
      historyList = storedHistory ? JSON.parse(storedHistory) : [];
      if (!Array.isArray(historyList)) historyList = [];
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

  onMount(() => {
    loadDashboardData();
    window.addEventListener('storage', loadDashboardData);
    return () => {
      window.removeEventListener('storage', loadDashboardData);
    };
  });

  let results = $state<Event[]>([]);
  const feeds = [normalFeed, followsFeed];
  let current = $state(0);

  const update = debounce(() => {
    // sort by an average of newness and wotness
    results.sort((a, b) => {
      const wotA = $wot[a.pubkey] || 0;
      const wotB = $wot[b.pubkey] || 0;
      let wotAvg = (wotA + wotB) / 2 || 1;
      let tsAvg = (a.created_at + b.created_at) / 2;
      return wotB / wotAvg + b.created_at / tsAvg - (wotA / wotAvg + a.created_at / tsAvg);
    });
    results = results;
    seenCache = seenCache;
  }, 500);

  let close = () => {};

  onDestroy(() => {
    close();
  });

  function doLogin() {
    signer.getPublicKey();
  }

  function openArticle(result: Event) {
    createChild({
      id: next(),
      type: 'article',
      data: [getTagOr(result, 'd'), result.pubkey],
      actualEvent: result,
      relayHints: seenCache[result.id] || []
    } as ArticleCard);
  }

  function replaceNewCard(newCard: Card) {
    createChild(newCard);
  }

  function restart() {
    close();
    results = [];
    close = feeds[current]();
  }

  setTimeout(restart, 400);

  function normalFeed() {
    let sub: SubCloser | undefined;
    let cancel = account.subscribe(async (account) => {
      if (sub) sub.close();

      sub = pool.subscribeMany(
        account ? await getBasicUserWikiRelays(account.pubkey) : DEFAULT_WIKI_RELAYS,
        [
          {
            kinds: [wikiKind],
            limit: 15
          }
        ],
        {
          id: 'recent',
          onevent,
          receivedEvent
        }
      );
    });

    return () => {
      if (sub) sub.close();
      cancel();
    };
  }

  function followsFeed() {
    let exited = false;

    let subc: SubCloser;
    let wotsubclose = wot.subscribe((wot) => {
      if (exited) {
        return;
      }

      const eligibleKeys = Object.entries(wot)
        .filter(([_, v]) => v > 170)
        .map(([k]) => k);

      subc = subscribeAllOutbox(
        eligibleKeys,
        { kinds: [wikiKind], limit: 20 },
        { id: 'alloutbox', onevent, receivedEvent }
      );
    });

    return () => {
      exited = true;
      wotsubclose();
      subc?.close?.();
    };
  }

  function onevent(evt: NostrEvent) {
    if (addUniqueTaggedReplaceable(results, evt)) update();
  }

  function receivedEvent(relay: AbstractRelay, id: string) {
    if (!(id in seenCache)) seenCache[id] = [];
    if (seenCache[id].indexOf(relay.url) === -1) seenCache[id].push(relay.url);
  }
</script>

<div class="font-bold text-4xl">Account</div>
<div class="mb-4 mt-2">
  {#if $account}
    <div class="flex h-12">
      {#if $account.image}
        <img class="full-h" src={$account.image} alt="user avatar" />
      {/if}
      <div class="ml-2">
        <p class="w-64 text-ellipsis overflow-hidden">{$account.npub}</p>
        <p>{$account.shortName}</p>
      </div>
    </div>
    <div class="mt-2">
      <button
        onclick={() => {
          current = (current + 1) % feeds.length;
          restart();
        }}
        type="submit"
        class="inline-flex items-center space-x-2 px-3 py-2 border border-gray-300 text-sm font-medium rounded-md bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-white"
      >
        {#if feeds[current] === normalFeed}
          Browse articles from contacts
        {:else if feeds[current] === followsFeed}
          Browse articles from your relays
        {/if}
      </button>
    </div>
  {:else}
    <button
      onclick={doLogin}
      type="submit"
      class="inline-flex items-center space-x-2 px-3 py-2 border border-gray-300 text-sm font-medium rounded-md bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-white"
      >Login</button
    >
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

<div class="mb-2 font-bold text-4xl">
  {#if feeds[current] === normalFeed}
    Recent Articles
    <div class="flex items-center flex-wrap">
      <div class="mr-1 font-normal text-xs">from</div>
      {#each $userWikiRelays as url}
        <RelayItem {url} {createChild} />
      {/each}
    </div>
  {:else if feeds[current] === followsFeed}
    Articles from Contacts
  {/if}
</div>
{#each results as result (result.id)}
  <ArticleListItem event={result} {openArticle} />
{/each}
