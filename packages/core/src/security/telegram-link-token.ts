import crypto from 'node:crypto';

import { AppError } from '../domain/errors.js';

export type TelegramLinkTokenPayload = {
  tenantId: string;
  guildId: string;
  exp: number;
};

function encodePayload(payload: TelegramLinkTokenPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodePayload(encoded: string): TelegramLinkTokenPayload {
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TelegramLinkTokenPayload;
}

function createSignature(encodedPayload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

export function signTelegramLinkToken(payload: TelegramLinkTokenPayload, secret: string): string {
  const encodedPayload = encodePayload(payload);
  const signature = createSignature(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function verifyTelegramLinkToken(token: string, secret: string): TelegramLinkTokenPayload {
  const [encodedPayload, receivedSignature] = token.split('.');
  if (!encodedPayload || !receivedSignature) {
    throw new AppError('INVALID_TELEGRAM_LINK_TOKEN', 'Malformed Telegram link token', 400);
  }

  const expectedSignature = createSignature(encodedPayload, secret);
  if (expectedSignature !== receivedSignature) {
    throw new AppError('INVALID_TELEGRAM_LINK_TOKEN', 'Invalid Telegram link token signature', 401);
  }

  const payload = decodePayload(encodedPayload);
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) {
    throw new AppError('EXPIRED_TELEGRAM_LINK_TOKEN', 'Telegram link token expired', 401);
  }

  return payload;
}
