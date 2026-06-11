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
  <div class="videoblock">
    <div class="content">
      <!-- svelte-ignore a11y_media_has_caption -->
      <video
        src={src}
        autoPlay={node.isOption('autoplay')}
        controls={!node.isOption('nocontrols')}
        loop={node.isOption('loop')}
      >
        Your browser does not support the video tag.
      </video>
    </div>
  </div>
{:else}
  <div class="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
    Insecure video blocked on secure pages.
  </div>
{/if}
