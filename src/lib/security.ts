export function isSecurePage(): boolean {
  return typeof window !== 'undefined' && window.location.protocol === 'https:'
}

export function isSecureRelayUrl(url: string): boolean {
  if (!isSecurePage()) return true
  return !url.trim().startsWith('ws://')
}

export function filterSecureRelays(relays: string[]): string[] {
  return relays.filter((url) => isSecureRelayUrl(url))
}

export function safeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const trimmed = url.trim()
  if (!trimmed) return null
  if (!isSecurePage()) return trimmed
  if (trimmed.startsWith('http://')) return null
  return trimmed
}
