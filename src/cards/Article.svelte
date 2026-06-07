<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { EventTemplate, NostrEvent } from '@nostr/tools/pure';
  import { pool } from '@nostr/gadgets/global';
  import { loadRelayList } from '@nostr/gadgets/lists';
  import { bareNostrUser, loadNostrUser, type NostrUser } from '@nostr/gadgets/metadata';
  import { naddrEncode } from '@nostr/tools/nip19';
  import { normalizeIdentifier } from '@nostr/tools/nip54';

  import { account, reactionKind, wikiKind, gitPatchKind, signer } from '$lib/nostr';
  import { formatDate, getA, getTagOr, next } from '$lib/utils';
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

    <!-- Content -->
    {#if view === 'raw'}
      <div class="font-mono whitespace-pre-wrap">{rawEvent}</div>
    {:else if view === 'asciidoc'}
      <div class="prose whitespace-pre-wrap">{event.content}</div>
    {:else if view === 'formatted'}
      <div class="prose prose-p:my-0 prose-li:my-0">
        <ArticleContent {event} {createChild} />
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
