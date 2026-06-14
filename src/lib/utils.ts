import { normalizeIdentifier } from '@nostr/tools/nip54';
import type { NostrEvent } from '@nostr/tools/pure';
import { decode } from '@nostr/tools/nip19';

export function formatDate(unixtimestamp: number) {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec'
  ];

  const date = new Date(unixtimestamp * 1000);
  const dateday = date.toISOString().split('T')[0];

  const now = Date.now();

  const today = new Date(now).toISOString().split('T')[0];
  if (dateday === today) return 'today';

  const yesterday = new Date(now - 24 * 3600 * 1000).toISOString().split('T')[0];
  if (dateday === yesterday) return 'yesterday';

  if (unixtimestamp > now / 1000 - 24 * 3600 * 90) {
    return Math.round((now / 1000 - unixtimestamp) / (24 * 3600)) + ' days ago';
  }

  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();

  const formattedDate = `${day} ${month} ${year}`;
  return 'on ' + formattedDate;
}

let serial = 1;

export function next(): number {
  return serial++;
}

export function scrollCardIntoView(el: number | string | HTMLElement, wait: boolean) {
  function scrollCard() {
    const element =
      el instanceof HTMLElement ? el : document.querySelector(`[id^="wikicard-${el}"]`);
    if (!element) return;

    element.scrollIntoView({
      behavior: 'smooth',
      inline: 'start'
    });
  }

  if (wait) {
    setTimeout(() => {
      scrollCard();
    }, 1);
  } else {
    scrollCard();
  }
}

export function isElementInViewport(el: number | string | HTMLElement) {
  const element = el instanceof HTMLElement ? el : document.querySelector(`[id^="wikicard-${el}"]`);
  if (!element) return;

  const rect = element.getBoundingClientRect();

  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}

export function getParentCard(el: HTMLElement): HTMLElement | null {
  let curr: HTMLElement | null = el;
  while (curr && !curr.id?.startsWith('wikicard')) {
    curr = curr.parentElement;
  }
  return curr;
}

export function getA(event: NostrEvent) {
  const dTag = event.tags.find(([t, v]) => t === 'd' && v)?.[1] || '';
  return `${event.kind}:${event.pubkey}:${dTag}`;
}

export function hashbow(input: string, lightness: number): string {
  let value = 0;
  for (let i = 0; i < input.length; i++) {
    value += input.charCodeAt(i);
  }
  value **= 17;
  return `hsla(${value % 360}, 76%, ${lightness}%, 1)`;
}

export function getTagOr(event: NostrEvent, tagName: string, dflt: string = '') {
  return event.tags.find(([t]) => t === tagName)?.[1] || dflt;
}

export function isHex32(input: string): boolean {
  return Boolean(input.match(/^[a-f0-9]{64}$/));
}

export function isATag(input: string): boolean {
  return Boolean(input.match(/^\d+:[0-9a-f]{64}:[^:]+$/));
}

export function urlWithoutScheme(url: string): string {
  return url.replace('wss://', '').replace(/\/+$/, '');
}

export function unique<A>(...arrs: A[][]): A[] {
  const result = [];
  for (let i = 0; i < arrs.length; i++) {
    const arr = arrs[i];
    for (let j = 0; j < arr.length; j++) {
      const item = arr[j];
      if (result.indexOf(item) !== -1) continue;
      result.push(item);
    }
  }
  return result;
}

export function addUniqueTaggedReplaceable(haystack: NostrEvent[], needle: NostrEvent): boolean {
  const idx = haystack.findIndex(
    (evt) => evt.pubkey === needle.pubkey && getTagOr(evt, 'd') === getTagOr(needle, 'd')
  );
  if (idx === -1) {
    haystack.push(needle);
    return true;
  }
  if (haystack[idx].created_at < needle.created_at) {
    haystack[idx] = needle;
    return true;
  }

  return false;
}

export function turnWikilinksIntoAsciidocLinks(content: string): string {
  return content.replace(/\[\[(.*?)\]\]/g, (_: any, content: any) => {
    let [target, display] = content.split('|');
    display = display || target;
    target = normalizeIdentifier(target);
    return `link:wikilink:${target}[${display}]`;
  });
}

export function appendLinkMacroToNostrLinks(content: string): string {
  return content.replace(/nostr:/g, 'link:nostr:');
}

export function cleanArticlePreview(content: string): string {
  if (!content) return '';

  const lines = content.slice(0, 2000).split(/\r?\n/);
  const cleanedLines: string[] = [];
  let inCodeBlock = false;

  for (let line of lines) {
    const trimmed = line.trim();

    // Toggle and skip block delimiters (e.g., ----, ====, ****, ...., ++++, etc. or --)
    if (/^[-=.*~+]{4,}$/.test(trimmed) || trimmed === '--') {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) {
      continue;
    }
    // Skip block attributes [source,...]
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      continue;
    }
    // Skip block titles starting with . (but not followed by space, e.g. .Title)
    if (trimmed.startsWith('.') && trimmed.length > 1 && !/\s/.test(trimmed[1])) {
      continue;
    }
    // Skip attribute entries like :author: Matt
    if (/^:[a-zA-Z0-9_-]+:/.test(trimmed)) {
      continue;
    }

    // Process headers: e.g. "== My Header" -> "My Header", or "# My Header" -> "My Header"
    let processed = line;
    const headerMatch = trimmed.match(/^(?:={1,6}|#{1,6})\s+(.+)$/);
    if (headerMatch) {
      processed = headerMatch[1];
    } else {
      // Process list items: strip "*" or "-" or "." bullets, but keep the text
      // e.g. "* Item" -> "Item", "** Subitem" -> "Subitem"
      const listMatch = trimmed.match(/^[*.-]+\s+(.+)$/);
      if (listMatch) {
        processed = listMatch[1];
      }
    }

    cleanedLines.push(processed);
  }

  let text = cleanedLines.join(' ');

  // 2. Replace inline formatting
  // Wikilinks: [[target|label]] -> label, [[target]] -> target
  text = text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, display) => {
    return display || target;
  });

  // Asciidoc/Markdown Links: link:url[label] or http://url[label] -> label (or url if label is empty)
  text = text.replace(/(?:link:|https?:\/\/)[^\s\[]+\[([^\]]*)\]/g, (_, label) => {
    return label || '';
  });

  // Asciidoc/Markdown image/video/audio macros: image:url[alt] -> alt
  text = text.replace(/(?:image|video|audio)::?[^\s\[]+\[([^\]]*)\]/g, (_, alt) => {
    return alt || '';
  });

  // Inline formatting:
  // Bold: *bold* -> bold
  text = text.replace(/\*([^*]+)\*/g, '$1');
  // Italic: _italic_ -> italic
  text = text.replace(/_([^_]+)_/g, '$1');
  // Monospace: `mono` -> mono, +mono+ -> mono
  text = text.replace(/`([^`]+)`/g, '$1');
  text = text.replace(/\+([^+]+)\+/g, '$1');

  // Double quotes / smart quotes/formatting
  text = text.replace(/``([^`]+)''/g, '"$1"');
  text = text.replace(/`([^`]+)'/g, "'$1'");

  // Collapse multiple spaces into one and trim
  return text.replace(/\s+/g, ' ').trim();
}

export function extractATags(content: string, authorPubkey: string, wikiKind: number = 30023): string[][] {
  const tags: string[][] = [];
  const seen = new Set<string>();

  // 1. Parse wikilinks: [[target]] or [[target|display]]
  const wikilinkRegex = /\[\[(.*?)\]\]/g;
  let match;
  while ((match = wikilinkRegex.exec(content)) !== null) {
    const rawTarget = match[1].split('|')[0].trim();
    if (!rawTarget) continue;

    // Check if the wikilink target is an naddr or contains a nostr: link
    if (rawTarget.startsWith('nostr:naddr1') || rawTarget.startsWith('naddr1')) {
      const naddrStr = rawTarget.replace('nostr:', '');
      try {
        const decoded = decode(naddrStr);
        if (decoded.type === 'naddr') {
          const aTagValue = `${decoded.data.kind}:${decoded.data.pubkey}:${decoded.data.identifier}`;
          if (!seen.has(aTagValue)) {
            seen.add(aTagValue);
            tags.push(['a', aTagValue, decoded.data.relays?.[0] || '']);
          }
        }
      } catch (e) {
        console.warn('Failed to decode naddr in wikilink:', e);
      }
    } else {
      // Standard wikilink, relative to the author
      const normalized = normalizeIdentifier(rawTarget);
      const aTagValue = `${wikiKind}:${authorPubkey}:${normalized}`;
      if (!seen.has(aTagValue)) {
        seen.add(aTagValue);
        tags.push(['a', aTagValue, '']);
      }
    }
  }

  // 2. Parse raw or markdown nostr:naddr1... links in content
  const naddrRegex = /(?:nostr:)?(naddr1[a-zA-Z0-9]+)/g;
  while ((match = naddrRegex.exec(content)) !== null) {
    const naddrStr = match[1];
    try {
      const decoded = decode(naddrStr);
      if (decoded.type === 'naddr') {
        const aTagValue = `${decoded.data.kind}:${decoded.data.pubkey}:${decoded.data.identifier}`;
        if (!seen.has(aTagValue)) {
          seen.add(aTagValue);
          tags.push(['a', aTagValue, decoded.data.relays?.[0] || '']);
        }
      }
    } catch (e) {
      // Ignore invalid decodes from random strings matching pattern
    }
  }

  return tags;
}

