<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { EventTemplate, NostrEvent } from '@nostr/tools/pure';
  import { pool } from '@nostr/gadgets/global';
  import { loadRelayList } from '@nostr/gadgets/lists';
  import { bareNostrUser, loadNostrUser, type NostrUser } from '@nostr/gadgets/metadata';
  import { naddrEncode } from '@nostr/tools/nip19';
  import { normalizeIdentifier } from '@nostr/tools/nip54';

  import { account, reactionKind, wikiKind, gitPatchKind, signer } from '$lib/nostr';
  import { formatDate, getA, getTagOr, next, unique } from '$lib/utils';
  import type { ArticleCard, SearchCard, Card } from '$lib/types';
  import UserLabel from '$components/UserLabel.svelte';
  import ArticleContent from '$components/ArticleContent.svelte';
  import RelayItem from '$components/RelayItem.svelte';
  import { diffLines } from '$lib/diff';

  interface Props {
    card: Card;
    createChild: (card: Card) => void;
    replaceSelf: (card: Card) => void;
    back: () => void;
  }

  let { card, createChild, replaceSelf, back }: Props = $props();
  let event = $state<NostrEvent | null>(null);
  let suggestions = $state<NostrEvent[]>([]);
  let showSuggestionsPanel = $state(false);
  let selectedSuggestion = $state<NostrEvent | null>(null);
  let merging = $state(false);
  let nOthers = $state<number | undefined>(undefined);
  let copied = $state(false);
  let likeStatus: 'liked' | 'disliked' | unknown;
  let canLike = $state<boolean | undefined>();
  let seenOn = $state<string[]>([]);
  let view = $state<'formatted' | 'asciidoc' | 'raw'>('formatted');

  // Wiki features state
  let activeTab = $state<'article' | 'discussion' | 'history'>('article');
  let comments = $state<NostrEvent[]>([]);
  let newCommentText = $state('');
  let publishingComment = $state(false);
  let historyEvents = $state<NostrEvent[]>([]);
  let backlinks = $state<NostrEvent[]>([]);

  interface Heading {
    title: string;
    level: number;
  }

  let headings = $derived.by<Heading[]>(() => {
    if (!event?.content) return [];
    const lines = event.content.split(/\r?\n/);
    const list: Heading[] = [];
    lines.forEach((line) => {
      const adMatch = line.match(/^(=+)\s+(.+)$/);
      if (adMatch) {
        list.push({ title: adMatch[2].trim(), level: adMatch[1].length });
        return;
      }
      const mdMatch = line.match(/^(#+)\s+(.+)$/);
      if (mdMatch) {
        list.push({ title: mdMatch[2].trim(), level: mdMatch[1].length });
      }
    });
    return list;
  });

  let contributors = $derived.by<string[]>(() => {
    const list: string[] = [pubkey];
    if (event?.tags) {
      event.tags.forEach(([tag, val]) => {
        if (tag === 'contributor' && val && !list.includes(val)) {
          list.push(val);
        }
      });
    }
    historyEvents.forEach((rev) => {
      if (rev.pubkey && !list.includes(rev.pubkey)) {
        list.push(rev.pubkey);
      }
    });
    return list;
  });

  function scrollToHeading(headingTitle: string) {
    const cardEl = document.getElementById(`wikicard-${card.id}`);
    if (!cardEl) return;
    const elements = cardEl.querySelectorAll('h1, h2, h3, h4, h5, h6');
    for (const el of Array.from(elements)) {
      if (el.textContent?.trim().toLowerCase() === headingTitle.toLowerCase()) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        break;
      }
    }
  }

  async function publishComment() {
    if (!newCommentText.trim() || !event) return;
    publishingComment = true;
    try {
      const commentTemplate: EventTemplate = {
        kind: 1111,
        tags: [
          ['a', `${wikiKind}:${pubkey}:${dTag}`, seenOn[0] || ''],
          ['e', event.id, seenOn[0] || '']
        ],
        content: newCommentText.trim(),
        created_at: Math.round(Date.now() / 1000)
      };

      const signed = await signer.signEvent(commentTemplate);
      const relays = unique(
        (await loadRelayList($account!.pubkey)).items.filter((ri) => ri.write).map((ri) => ri.url),
        seenOn
      );

      await Promise.all(
        relays.map(async (url: string) => {
          try {
            const r = await pool.ensureRelay(url);
            await r.publish(signed);
          } catch (err) {
            console.warn('Failed publishing comment to', url, err);
          }
        })
      );

      comments = [...comments, signed].sort((a, b) => a.created_at - b.created_at);
      newCommentText = '';
    } catch (err) {
      alert('Failed to publish comment: ' + err);
    } finally {
      publishingComment = false;
    }
  }

  const articleCard = card as ArticleCard;
  const dTag = articleCard.data[0];
  const pubkey = articleCard.data[1];

  let author = $state<NostrUser>(bareNostrUser(pubkey));

  let title = $derived(event?.tags?.find?.(([k]) => k === 'title')?.[1] || dTag);
  let summary = $derived(event?.tags?.find(([k]) => k === 'summary')?.[1]);
  let rawEvent = $derived(event ? JSON.stringify(event, null, 2) : '{...}');

  function edit() {
    replaceSelf({
      id: next(),
      type: 'editor',
      data: {
        title,
        summary: summary || '',
        content: event?.content || '',
        previous: card as ArticleCard
      }
    });
  }

  function shareCopy() {
    navigator.clipboard.writeText(
      `https://njump.me/${naddrEncode({
        kind: wikiKind,
        identifier: dTag,
        pubkey,
        relays: seenOn
      })}`
    );
    copied = true;
    setTimeout(() => {
      copied = false;
    }, 2500);
  }

  function seeOthers(ev: MouseEvent) {
    if (
      articleCard.back &&
      event &&
      normalizeIdentifier(articleCard.back.data) === getTagOr(event, 'd')
    ) {
      // just go back
      back();
      return;
    }

    let nextCard: SearchCard = {
      id: next(),
      type: 'find',
      data: dTag,
      preferredAuthors: [] // leave empty so we ensure the list of alternatives will be shown
    };
    if (ev.button === 1) createChild(nextCard);
    else replaceSelf(nextCard);
  }

  onMount(() => {
    // load this article
    if (articleCard.actualEvent) {
      event = articleCard.actualEvent;
      seenOn = articleCard.relayHints || [];
      return;
    }

    (async () => {
      let relays = await loadRelayList(pubkey);

      pool.subscribeMany(
        relays.items
          .filter((ri) => ri.write)
          .map((ri) => ri.url)
          .concat((card as ArticleCard).relayHints || []),
        [
          {
            authors: [pubkey],
            '#d': [dTag],
            kinds: [wikiKind]
          }
        ],
        {
          id: 'article',
          receivedEvent(relay, _id) {
            if (seenOn.indexOf(relay.url) === -1) {
              seenOn.push(relay.url);
              seenOn = seenOn;
            }
          },
          onevent(evt) {
            if (!event || event.created_at < evt.created_at) {
              event = evt;
              setupLikes();
            }
          }
        }
      );
    })();

    (async () => {
      let relays = await loadRelayList(pubkey);
      pool.subscribeMany(
        relays.items
          .filter((ri) => ri.read)
          .map((ri) => ri.url)
          .concat((card as ArticleCard).relayHints || []),
        [
          {
            kinds: [gitPatchKind],
            '#a': [`${wikiKind}:${pubkey}:${dTag}`]
          }
        ],
        {
          id: 'suggestions-' + dTag,
          onevent(evt) {
            if (!suggestions.some((s) => s.id === evt.id)) {
              suggestions = [...suggestions, evt].sort((a, b) => b.created_at - a.created_at);
            }
          }
        }
      );
    })();

    // load comments
    (async () => {
      let relays = await loadRelayList(pubkey);
      pool.subscribeMany(
        relays.items
          .filter((ri) => ri.read)
          .map((ri) => ri.url)
          .concat((card as ArticleCard).relayHints || []),
        [
          {
            kinds: [1, 1111],
            '#a': [`${wikiKind}:${pubkey}:${dTag}`]
          }
        ],
        {
          id: 'comments-' + dTag,
          onevent(evt) {
            if (!comments.some((c) => c.id === evt.id)) {
              comments = [...comments, evt].sort((a, b) => a.created_at - b.created_at);
            }
          }
        }
      );
    })();

    // load history revisions
    (async () => {
      let relays = await loadRelayList(pubkey);
      pool.subscribeMany(
        relays.items
          .filter((ri) => ri.read)
          .map((ri) => ri.url)
          .concat((card as ArticleCard).relayHints || []),
        [
          {
            kinds: [wikiKind],
            '#d': [dTag]
          }
        ],
        {
          id: 'history-' + dTag,
          onevent(evt) {
            if (!historyEvents.some((h) => h.id === evt.id)) {
              historyEvents = [...historyEvents, evt].sort((a, b) => b.created_at - a.created_at);
            }
          }
        }
      );
    })();

    // load backlinks
    (async () => {
      let relays = await loadRelayList(pubkey);
      pool.subscribeMany(
        relays.items
          .filter((ri) => ri.read)
          .map((ri) => ri.url)
          .concat((card as ArticleCard).relayHints || []),
        [
          {
            kinds: [wikiKind],
            '#a': [`${wikiKind}:${pubkey}:${dTag}`]
          }
        ],
        {
          id: 'backlinks-' + dTag,
          onevent(evt) {
            if (!backlinks.some((b) => b.id === evt.id)) {
              backlinks = [...backlinks, evt];
            }
          }
        }
      );
    })();

    (async () => {
      author = await loadNostrUser(pubkey);
    })();
  });

  onMount(() => {
    // redraw likes thing when we have a logged in user
    return account.subscribe(setupLikes);
  });

  onMount(() => {
    // help nostr stay by publishing articles from others into their write relays
    let to = setTimeout(async () => {
      if (event) {
        (await loadRelayList(event.pubkey)).items
          .filter((ri) => ri.write)
          .map((ri) => ri.url)
          .slice(0, 3)
          .forEach(async (url) => {
            let relay = await pool.ensureRelay(url);
            relay.publish(event!);
          });
      }
    }, 5000);

    return () => clearTimeout(to);
  });

  onMount(() => {
    // preemptively load other versions if necessary
    if (articleCard.versions) {
      nOthers = articleCard.versions.length;
      return;
    }
  });

  let cancelers: Array<() => void> = [];
  onDestroy(() => {
    cancelers.forEach((fn) => fn());
  });

  function setupLikes() {
    if (!event) return;
    if (!$account) return;

    if ($account.pubkey === event.pubkey) {
      canLike = false;
    }

    setTimeout(() => {
      if (canLike === undefined) {
        canLike = true;
      }
    }, 2500);

    //cancelers.push(
    //  cachingSub(
    //    `reaction-${eventId.slice(-8)}`,
    //    unique($userPreferredRelays.read, safeRelays),
    //    { authors: [$account.pubkey], ['#a']: [getA(event)] },
    //    (result) => {
    //      canLike = false;

    //      switch (result[0]?.content) {
    //        case '+':
    //          liked = true;
    //          break;
    //        case '-':
    //          disliked = true;
    //          break;
    //      }
    //    }
    //  )
    //);
  }

  async function vote(v: '+' | '-') {
    if (!event) return;
    if (!canLike) return;

    let eventTemplate: EventTemplate = {
      kind: reactionKind,
      tags: [
        ['a', getA(event), seenOn[0] || ''],
        ['e', event.id, seenOn[1] || seenOn[0] || '']
      ],
      content: v,
      created_at: Math.round(Date.now() / 1000)
    };

    let inboxRelays = (await loadRelayList(pubkey)).items
      .filter((ri) => ri.read)
      .map((ri) => ri.url);
    let relays = [...(card as ArticleCard).relayHints, ...inboxRelays, ...seenOn];

    let like: NostrEvent;
    try {
      like = await signer.signEvent(eventTemplate);
    } catch (err) {
      console.warn('failed to publish like', err);
      return;
    }

    relays.forEach(async (url) => {
      try {
        const r = await pool.ensureRelay(url);
        await r.publish(like);
      } catch (err) {
        console.warn('failed to publish like', event, 'to', url, err);
      }
    });
  }
</script>

<div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_missing_attribute -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  {#if event === null}
    Loading article {dTag} from {author.shortName}
  {:else}
    <div class="flex items-center">
      {#if $account}
        <div
          class="flex flex-col items-center space-y-2 mr-3"
          class:hidden={$account?.pubkey === event.pubkey}
        >
          <a
            aria-label="like"
            title={canLike ? '' : likeStatus === 'like' ? 'you considered this a good article' : ''}
            class:cursor-pointer={canLike}
            onclick={() => vote('+')}
          >
            <svg
              class:fill-stone-600={canLike}
              class:fill-cyan-500={likeStatus === 'like'}
              class:hidden={likeStatus === 'disliked'}
              width="18"
              height="18"
              viewBox="0 0 18 18"><path d="M1 12h16L9 4l-8 8Z"></path></svg
            >
          </a>
          <a
            aria-label="dislike"
            title={canLike
              ? 'this is a bad article'
              : likeStatus === 'disliked'
                ? 'you considered this a bad article'
                : ''}
            class:cursor-pointer={canLike}
            onclick={() => vote('-')}
          >
            <svg
              class:fill-stone-600={canLike}
              class:fill-rose-400={likeStatus === 'disliked'}
              class:hidden={likeStatus === 'liked'}
              width="18"
              height="18"
              viewBox="0 0 18 18"><path d="M1 6h16l-8 8-8-8Z"></path></svg
            >
          </a>
        </div>
      {/if}
      <div class="ml-2 mb-4">
        <div class="mt-2 font-bold text-4xl">{title || dTag}</div>
        <div>
          by <UserLabel pubkey={event.pubkey} {createChild} />
          {#if event.created_at}
            {formatDate(event.created_at)}
          {/if}
        </div>
        <div>
          <a class="cursor-pointer underline" onclick={edit}>
            {#if event?.pubkey === $account?.pubkey}
              Edit
            {:else}
              Fork / Suggest Edit
            {/if}
          </a>
          &nbsp;• &nbsp;
          <a class="cursor-pointer underline" onclick={shareCopy}>
            {#if copied}Copied!{:else}Share{/if}
          </a>
          &nbsp;• &nbsp;
          <a class="cursor-pointer underline" onmouseup={seeOthers}>{nOthers || ''} Versions</a>
          {#if suggestions.length > 0}
            &nbsp;• &nbsp;
            <a class="cursor-pointer underline text-emerald-600 hover:text-emerald-700 font-semibold" onclick={() => showSuggestionsPanel = !showSuggestionsPanel}>
              {suggestions.length} Suggestion{suggestions.length > 1 ? 's' : ''}
            </a>
          {/if}
        </div>
      </div>
    </div>

    <!-- Suggestions Panel -->
    {#if showSuggestionsPanel}
      <div class="mt-2 mb-4 p-4 border border-emerald-200 rounded-lg bg-emerald-50/30">
        <div class="flex justify-between items-center mb-3">
          <h3 class="font-bold text-lg text-emerald-800">Suggestions (Pull Requests)</h3>
          <button 
            onclick={() => { showSuggestionsPanel = false; selectedSuggestion = null; }}
            class="text-xs text-stone-500 hover:text-stone-700 bg-white border border-stone-200 px-2 py-0.5 rounded shadow-sm"
          >
            Hide
          </button>
        </div>

        {#if !selectedSuggestion}
          {#if suggestions.length === 0}
            <p class="text-stone-500 text-sm">No suggestions yet.</p>
          {:else}
            <div class="space-y-2">
              {#each suggestions as sug (sug.id)}
                <div class="p-3 bg-white border border-stone-200 rounded shadow-sm hover:border-emerald-500 transition-colors flex justify-between items-start">
                  <div>
                    <div class="font-semibold text-stone-900 text-sm">
                      {getTagOr(sug, 'title') || 'Proposed Edit'}
                    </div>
                    <div class="text-xs text-stone-500 mt-1">
                      by <UserLabel pubkey={sug.pubkey} {createChild} /> {formatDate(sug.created_at)}
                    </div>
                    {#if getTagOr(sug, 'summary')}
                      <div class="text-xs text-stone-600 mt-1 bg-stone-50 p-1.5 rounded italic">
                        "{getTagOr(sug, 'summary')}"
                      </div>
                    {/if}
                  </div>
                  <button
                    onclick={() => selectedSuggestion = sug}
                    class="ml-4 px-2.5 py-1 bg-emerald-600 text-white rounded text-xs hover:bg-emerald-700 font-semibold"
                  >
                    Review Diff
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        {:else}
          <!-- Reviewing a specific suggestion -->
          <div class="bg-white border border-emerald-100 rounded p-3 shadow-sm">
            <div class="flex justify-between items-center mb-3 border-b border-stone-100 pb-1.5">
              <div>
                <div class="text-xs text-stone-500">Reviewing suggestion from:</div>
                <div class="font-medium text-xs flex items-center gap-1">
                  <UserLabel pubkey={selectedSuggestion.pubkey} {createChild} />
                  <span class="text-[10px] text-stone-400">({formatDate(selectedSuggestion.created_at)})</span>
                </div>
              </div>
              <button 
                onclick={() => selectedSuggestion = null}
                class="text-xs text-indigo-600 hover:text-indigo-850 font-medium"
              >
                ← Back
              </button>
            </div>

            <!-- Diff Viewer -->
            <div class="mt-2 border border-stone-200 rounded overflow-hidden font-mono text-xs max-h-72 overflow-y-auto bg-stone-50">
              {#each diffLines(event?.content || '', selectedSuggestion.content) as line, idx}
                <div class="flex select-text {line.type === 'added' ? 'bg-emerald-50 text-emerald-900' : ''} {line.type === 'removed' ? 'bg-rose-50 text-rose-900' : ''}">
                  <div class="w-10 text-right text-stone-400 select-none border-r border-stone-200/50 pr-1.5 mr-1.5 bg-stone-100/50 text-[10px] py-0.5">
                    {idx + 1}
                  </div>
                  <div class="w-4 select-none text-center font-bold" class:text-emerald-600={line.type === 'added'} class:text-rose-600={line.type === 'removed'}>
                    {#if line.type === 'added'}+{/if}
                    {#if line.type === 'removed'}-{/if}
                    {#if line.type === 'unmodified'}&nbsp;{/if}
                  </div>
                  <div class="whitespace-pre-wrap py-0.5 break-all flex-1">{line.value}</div>
                </div>
              {/each}
            </div>

            <!-- Merge/Approve Actions -->
            <div class="mt-3 flex justify-end space-x-2 border-t border-stone-100 pt-2">
              {#if $account?.pubkey === event?.pubkey}
                <button
                  onclick={async () => {
                    if (!selectedSuggestion || !event) return;
                    merging = true;
                    try {
                      let eventTemplate: EventTemplate = {
                        kind: wikiKind,
                        tags: [
                          ['d', getTagOr(event, 'd')],
                          ['contributor', selectedSuggestion.pubkey]
                        ],
                        content: selectedSuggestion.content.trim(),
                        created_at: Math.round(Date.now() / 1000)
                      };

                      const propTitle = getTagOr(selectedSuggestion, 'title') || getTagOr(event, 'title');
                      if (propTitle && propTitle !== getTagOr(event, 'd')) {
                        eventTemplate.tags.push(['title', propTitle]);
                      }
                      const propSummary = getTagOr(selectedSuggestion, 'summary') || getTagOr(event, 'summary');
                      if (propSummary) {
                        eventTemplate.tags.push(['summary', propSummary]);
                      }

                      let signed = await signer.signEvent(eventTemplate);
                      let successes: string[] = [];
                      await Promise.all(
                        seenOn.map(async (url) => {
                          try {
                            const r = await pool.ensureRelay(url);
                            await r.publish(signed);
                            successes.push(url);
                          } catch (err) {
                            console.warn('Failed publishing merged event to', url, err);
                          }
                        })
                      );

                      if (successes.length) {
                        event = signed;
                        suggestions = suggestions.filter((s) => s.id !== selectedSuggestion!.id);
                        selectedSuggestion = null;
                        showSuggestionsPanel = false;
                      }
                    } catch (err) {
                      alert('Error merging suggestion: ' + err);
                    } finally {
                      merging = false;
                    }
                  }}
                  disabled={merging}
                  class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-semibold text-xs disabled:opacity-50"
                >
                  {#if merging}Merging...{:else}Accept & Merge{/if}
                </button>
              {/if}
              <button
                onclick={() => {
                  if (selectedSuggestion) {
                    suggestions = suggestions.filter((s) => s.id !== selectedSuggestion!.id);
                    selectedSuggestion = null;
                  }
                }}
                class="px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded font-semibold text-xs"
              >
                Ignore Suggestion
              </button>
            </div>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Tabs Header -->
    <div class="mt-4 border-b border-stone-250 flex items-center space-x-4">
      <button
        onclick={() => activeTab = 'article'}
        class="pb-2 text-sm font-bold border-b-2 transition-colors focus:outline-none"
        class:border-indigo-600={activeTab === 'article'}
        class:text-indigo-600={activeTab === 'article'}
        class:border-transparent={activeTab !== 'article'}
        class:text-stone-500={activeTab !== 'article'}
      >
        Article
      </button>
      <button
        onclick={() => activeTab = 'discussion'}
        class="pb-2 text-sm font-bold border-b-2 transition-colors focus:outline-none flex items-center gap-1.5"
        class:border-indigo-600={activeTab === 'discussion'}
        class:text-indigo-600={activeTab === 'discussion'}
        class:border-transparent={activeTab !== 'discussion'}
        class:text-stone-500={activeTab !== 'discussion'}
      >
        Discussion
        {#if comments.length > 0}
          <span class="bg-stone-200 text-stone-700 px-1.5 py-0.5 rounded-full text-[10px]">
            {comments.length}
          </span>
        {/if}
      </button>
      <button
        onclick={() => activeTab = 'history'}
        class="pb-2 text-sm font-bold border-b-2 transition-colors focus:outline-none"
        class:border-indigo-600={activeTab === 'history'}
        class:text-indigo-600={activeTab === 'history'}
        class:border-transparent={activeTab !== 'history'}
        class:text-stone-500={activeTab !== 'history'}
      >
        History
      </button>
    </div>

    <!-- Tab Contents -->
    {#if activeTab === 'article'}
      <!-- Info / Metadata Box (Wiki Sidebar) -->
      <div class="mt-4 p-3 bg-stone-50 border border-stone-200 rounded shadow-sm flex flex-col md:flex-row justify-between text-xs text-stone-600 gap-2 mb-4">
        <div>
          <span class="font-semibold text-stone-700">Page size:</span>
          {event.content.length} characters ({Math.round(event.content.length / 10.24) / 100} KB)
        </div>
        <div>
          <span class="font-semibold text-stone-700">Revisions:</span>
          {historyEvents.filter(h => h.pubkey === event?.pubkey).length || 1}
        </div>
        <div>
          <span class="font-semibold text-stone-700">Contributors:</span>
          {unique(historyEvents.map(h => h.pubkey)).length || 1}
        </div>
        <div>
          <span class="font-semibold text-stone-700">First published:</span>
          {#if historyEvents.length > 0}
            {formatDate(historyEvents[historyEvents.length - 1].created_at)}
          {:else}
            {formatDate(event.created_at)}
          {/if}
        </div>
      </div>

      <!-- Table of Contents -->
      {#if headings.length > 0}
        <div class="mt-2 mb-6 p-4 border border-stone-200 rounded-md bg-stone-50/50 w-full max-w-full sm:max-w-md lg:max-w-lg">
          <div class="text-xs font-bold text-stone-700 uppercase tracking-wider mb-2 border-b border-stone-200 pb-1 flex justify-between items-center">
            <span>Table of Contents</span>
          </div>
          <ul class="space-y-1.5 text-sm">
            {#each headings as heading}
              <li style:padding-left={`${(heading.level - 1) * 12}px`}>
                <a
                  href="javascript:void(0)"
                  onclick={() => scrollToHeading(heading.title)}
                  class="text-indigo-600 hover:text-indigo-850 hover:underline inline-block break-all"
                >
                  {heading.title}
                </a>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      <!-- Main Article Content -->
      {#if view === 'raw'}
        <div class="font-mono whitespace-pre-wrap text-sm border border-stone-200 p-3 bg-stone-50 rounded">{rawEvent}</div>
      {:else if view === 'asciidoc'}
        <div class="prose whitespace-pre-wrap text-sm border border-stone-200 p-3 bg-stone-50 rounded">{event.content}</div>
      {:else if view === 'formatted'}
        <div class="prose prose-p:my-0 prose-li:my-0">
          <ArticleContent {event} {createChild} />
        </div>
      {/if}

      <!-- Backlinks section ("What links here") -->
      <div class="mt-8 border-t border-stone-250 pt-4">
        <details class="group">
          <summary class="cursor-pointer text-xs font-semibold text-stone-500 hover:text-stone-850 focus:outline-none flex items-center select-none">
            <svg class="w-3.5 h-3.5 mr-1 transform group-open:rotate-90 transition-transform stroke-current" fill="none" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
            What links here ({backlinks.length})
          </summary>
          {#if backlinks.length === 0}
            <div class="mt-2 text-xs text-stone-400 italic pl-5">No other articles link to this article yet.</div>
          {:else}
            <ul class="mt-2 text-xs space-y-1 pl-5 list-disc text-indigo-600">
              {#each backlinks as link (link.id)}
                <li>
                  <a
                    href="javascript:void(0)"
                    onclick={() => {
                      createChild({
                        id: next(),
                        type: 'article',
                        data: [getTagOr(link, 'd'), link.pubkey],
                        actualEvent: link
                      } as ArticleCard);
                    }}
                    class="hover:underline"
                  >
                    {getTagOr(link, 'title') || getTagOr(link, 'd')}
                  </a>
                  <span class="text-stone-400">by <UserLabel pubkey={link.pubkey} {createChild} /></span>
                </li>
              {/each}
            </ul>
          {/if}
        </details>
      </div>

      <!-- Contributors -->
      <div class="mt-6 border-t border-stone-250 pt-4 text-xs text-stone-500">
        <span class="font-semibold text-stone-700">Contributors:</span>
        <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {#each contributors as cPubkey}
            <div class="inline-flex items-center">
              <UserLabel pubkey={cPubkey} {createChild} />
            </div>
          {/each}
        </div>
      </div>

    {:else if activeTab === 'discussion'}
      <!-- Comments / Discussion -->
      <div class="mt-4 space-y-3">
        {#if comments.length === 0}
          <div class="text-center py-6 text-stone-400 text-sm italic">
            No discussion on this article yet. Be the first to start the talk page!
          </div>
        {:else}
          {#each comments as comm (comm.id)}
            <div class="p-3 bg-stone-50 border border-stone-200 rounded shadow-sm">
              <div class="flex justify-between items-center border-b border-stone-200/50 pb-1 mb-2 text-xs">
                <span class="font-semibold text-stone-700">
                  <UserLabel pubkey={comm.pubkey} {createChild} />
                </span>
                <span class="text-stone-400">
                  {formatDate(comm.created_at)}
                </span>
              </div>
              <div class="text-stone-800 text-sm whitespace-pre-wrap select-text">{comm.content}</div>
            </div>
          {/each}
        {/if}

        <!-- Post a Comment -->
        {#if $account}
          <div class="mt-6 border-t border-stone-200 pt-4">
            <h4 class="text-sm font-semibold text-stone-700 mb-2">Add to the discussion:</h4>
            <textarea
              bind:value={newCommentText}
              placeholder="Provide constructive feedback, propose edits, or ask questions about the article..."
              class="w-full h-24 p-2 text-sm border border-stone-300 rounded focus:ring-indigo-500 focus:border-indigo-500 shadow-sm"
              disabled={publishingComment}
            ></textarea>
            <div class="mt-2 flex justify-end">
              <button
                onclick={publishComment}
                disabled={publishingComment || !newCommentText.trim()}
                class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
              >
                {#if publishingComment}Publishing...{:else}Post Comment{/if}
              </button>
            </div>
          </div>
        {:else}
          <div class="mt-6 border-t border-stone-200 pt-4 text-center text-xs text-stone-500 italic">
            Please log in with a Nostr extension to participate in the discussion.
          </div>
        {/if}
      </div>

    {:else if activeTab === 'history'}
      <!-- History Revisions -->
      <div class="mt-4 space-y-2">
        <h4 class="text-sm font-semibold text-stone-700 mb-3">Revision History:</h4>
        {#if historyEvents.length === 0}
          <div class="text-xs text-stone-400 italic">Loading revision history...</div>
        {:else}
          <div class="border border-stone-200 rounded divide-y divide-stone-200">
            {#each historyEvents as rev}
              <div class="p-3 bg-white hover:bg-stone-50 flex justify-between items-center text-xs">
                <div>
                  <span class="font-mono text-[10px] bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded mr-2">
                    {rev.id.substring(0, 8)}
                  </span>
                  <span class="text-stone-500 font-semibold">{formatDate(rev.created_at)}</span>
                  <span class="text-stone-400 mx-1.5">•</span>
                  <span>by <UserLabel pubkey={rev.pubkey} {createChild} /></span>
                  {#if getTagOr(rev, 'summary')}
                    <span class="text-stone-400 block mt-1 italic">"{getTagOr(rev, 'summary')}"</span>
                  {/if}
                </div>
                <button
                  onclick={() => {
                    event = rev;
                    activeTab = 'article';
                  }}
                  class="px-2 py-0.5 border border-stone-300 rounded bg-stone-50 hover:bg-stone-100 font-semibold"
                >
                  View Revision
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    {#if seenOn.length}
      <div class="mt-4 flex flex-wrap items-center">
        {#each seenOn as r (r)}
          <RelayItem url={r} {createChild} />
        {/each}
        <button
          onclick={() => {
            view = view === 'formatted' ? 'asciidoc' : view === 'asciidoc' ? 'raw' : 'formatted';
          }}
          class="font-normal text-xs px-1 py-0.5 mr-1 my-0.5 rounded cursor-pointer transition-colors bg-purple-300 hover:bg-purple-400 focus:outline-none"
          >see {#if view === 'formatted'}asciidoc source{:else if view === 'asciidoc'}raw event{:else}formatted{/if}</button
        >
      </div>
    {/if}
  {/if}
</div>
