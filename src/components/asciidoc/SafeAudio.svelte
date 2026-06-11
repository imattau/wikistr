<script lang="ts">
  import { type AbstractBlock } from '@asciidoctor/core';

  import { safeMediaUrl } from '$lib/security';

  export interface Props {
    node: AbstractBlock;
  }

  let { node }: Props = $props();
  let src = $derived.by(() => {
    const startTime = node.getAttribute('start');
    const endTime = node.getAttribute('start');
    const timeAnchor = startTime || endTime ? `#t=${startTime || ''}${endTime ? `,${endTime}` : ''}` : '';
    return safeMediaUrl(`${node.getMediaUri(node.getAttribute('target'))}${timeAnchor}`);
  });
</script>

{#if src}
  <div class="audioblock">
    <div class="content">
      <audio
        src={src}
        autoPlay={node.isOption('autoplay')}
        controls={!node.isOption('nocontrols')}
        loop={node.isOption('loop')}
      >
        Your browser does not support the audio tag.
      </audio>
    </div>
  </div>
{:else}
  <div class="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
    Insecure audio blocked on secure pages.
  </div>
{/if}
