import { AppError } from '../domain/errors.js';

const TELEGRAM_API_BASE_URL = 'https://api.telegram.org';

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
};

async function callTelegramApi<T>(input: {
  botToken: string;
  method: string;
  body: Record<string, unknown>;
}): Promise<T> {
  const response = await fetch(`${TELEGRAM_API_BASE_URL}/bot${input.botToken}/${input.method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input.body),
  });

  const body = await response.text();
  let parsed: TelegramApiResponse<T> | null = null;

  try {
    parsed = JSON.parse(body) as TelegramApiResponse<T>;
  } catch {
    parsed = null;
  }

  if (!response.ok || !parsed?.ok || parsed.result == null) {
    throw new AppError(
      'TELEGRAM_API_ERROR',
      parsed?.description ?? `Telegram API request failed (${response.status})`,
      response.status,
      {
        body,
        method: input.method,
        telegramStatus: response.status,
      },
    );
  }

  return parsed.result;
}

export async function postMessageToTelegramChat(input: {
  botToken: string;
  chatId: string;
  content: string;
  replyMarkup?: Record<string, unknown>;
}): Promise<{ messageId: number }> {
  const result = await callTelegramApi<{ message_id: number }>({
    botToken: input.botToken,
    method: 'sendMessage',
    body: {
      chat_id: input.chatId,
      text: input.content,
      disable_web_page_preview: true,
      ...(input.replyMarkup ? { reply_markup: input.replyMarkup } : {}),
    },
  });

  return {
    messageId: result.message_id,
  };
}

export async function sendDirectMessageToTelegramUser(input: {
  botToken: string;
  userId: string;
  content: string;
}): Promise<{ messageId: number }> {
  return postMessageToTelegramChat({
    botToken: input.botToken,
    chatId: input.userId,
    content: input.content,
  });
}
