export function buildAndroidIntentUrl(targetUrl: string): string {
  const url = new URL(targetUrl);
  const scheme = url.protocol.replace(/:$/u, '');
  const hostAndPath = `${url.host}${url.pathname}${url.search}${url.hash}`;
  const fallbackUrl = encodeURIComponent(targetUrl);

  return `intent://${hostAndPath}#Intent;scheme=${scheme};action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;S.browser_fallback_url=${fallbackUrl};end`;
}
