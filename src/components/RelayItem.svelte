<script lang="ts">
  import type { RelayCard, Card } from '$lib/types';
  import { next, urlWithoutScheme } from '$lib/utils';
  import { sanitizeRelayUrl } from '$lib/security';

  interface Props {
    url: string;
    createChild: (card: Card) => void;
  }

  let { url, createChild }: Props = $props();
  let safeUrl = $derived(sanitizeRelayUrl(url));

  function openRelay(relay: string) {
    let relayCard: RelayCard = { id: next(), type: 'relay', data: relay };
    createChild(relayCard);
  }
</script>

{#if safeUrl}
  <button
    class="font-normal text-xs px-1 py-0.5 mr-1 my-0.5 rounded bg-emerald-200 cursor-pointer hover:bg-emerald-400 transition-colors"
    onmouseup={openRelay.bind(null, safeUrl)}
  >
    {urlWithoutScheme(safeUrl)}
  </button>
{/if}
