<script lang="ts">
  import { type Block } from '@asciidoctor/core';

  import { safeMediaUrl, safeLinkUrl } from '$lib/security';

  export interface Props {
    node: Block;
  }

  let { node }: Props = $props();
  let src = $derived.by(() => safeMediaUrl(node.getImageUri(node.getAttribute('target'))));
  let link = $derived.by(() => safeLinkUrl(node.getAttribute('link')));
</script>

{#if src}
  <div
    class={`imageblock ${
      node.hasAttribute('align') ? 'text-' + node.getAttribute('align') : ''
    } ${node.hasAttribute('float') ? node.getAttribute('float') : ''}`}
  >
    <div class="content">
      {#if link}
        <a class="image" href={link} rel="noopener noreferrer">
          <img
            src={src}
            alt={node.getAttribute('alt')}
            width={node.getAttribute('width')}
            height={node.getAttribute('height')}
          />
        </a>
      {:else}
        <img
          src={src}
          alt={node.getAttribute('alt')}
          width={node.getAttribute('width')}
          height={node.getAttribute('height')}
        />
      {/if}
    </div>
  </div>
{:else}
  <div class="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
    Insecure image blocked on secure pages.
  </div>
{/if}
