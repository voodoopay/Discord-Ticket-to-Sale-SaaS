import { parsePlatformScopedId } from '../utils/platform-ids.js';

export function getOrderSourceLabel(ticketChannelId: string): 'Telegram Order' | 'Discord Order' {
  return parsePlatformScopedId(ticketChannelId).platform === 'telegram'
    ? 'Telegram Order'
    : 'Discord Order';
}
