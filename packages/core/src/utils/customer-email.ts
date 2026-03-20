import type { OrderSessionRecord } from '../repositories/order-repository.js';
import { parsePlatformScopedId } from './platform-ids.js';

const INTERNAL_PLACEHOLDER_DOMAINS = new Set(['voodoo-services.com', 'voodoopaybot.online']);
const INTERNAL_PLACEHOLDER_LOCAL_PARTS = new Set(['discord']);
const INTERNAL_PLACEHOLDER_LOCAL_PREFIXES = ['discord-', 'order-'];

export function isInternalPlaceholderCustomerEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  const [localPart = '', domain = ''] = normalized.split('@');

  if (!localPart || !domain || !INTERNAL_PLACEHOLDER_DOMAINS.has(domain)) {
    return false;
  }

  return (
    INTERNAL_PLACEHOLDER_LOCAL_PARTS.has(localPart) ||
    INTERNAL_PLACEHOLDER_LOCAL_PREFIXES.some((prefix) => localPart.startsWith(prefix))
  );
}

export function resolveOrderSessionCustomerEmail(
  orderSession: Pick<OrderSessionRecord, 'customerEmailNormalized' | 'customerDiscordId' | 'ticketChannelId'>,
): string | null {
  const normalized = orderSession.customerEmailNormalized?.trim().toLowerCase() ?? null;
  if (!normalized) {
    return null;
  }

  const customerPlatform = parsePlatformScopedId(orderSession.customerDiscordId).platform;
  const ticketPlatform = parsePlatformScopedId(orderSession.ticketChannelId).platform;
  const isTelegramOrder = customerPlatform === 'telegram' || ticketPlatform === 'telegram';

  if (isTelegramOrder && isInternalPlaceholderCustomerEmail(normalized)) {
    return null;
  }

  return normalized;
}
