export function buildDashboardGuildUrl(currentHref: string, guildId: string): string {
  const url = new URL(currentHref);
  url.pathname = '/dashboard';
  url.searchParams.set('guildId', guildId);
  url.searchParams.delete('authError');
  return `${url.pathname}${url.search}${url.hash}`;
}
