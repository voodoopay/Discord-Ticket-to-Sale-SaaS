import { AppError } from '../domain/errors.js';

export async function postMessageToDiscordChannel(input: {
  botToken: string;
  channelId: string;
  content: string;
  components?: Array<Record<string, unknown>>;
  allowedMentions?: {
    parse?: Array<'roles' | 'users' | 'everyone'>;
    users?: string[];
    roles?: string[];
    replied_user?: boolean;
  };
}): Promise<void> {
  const response = await fetch(`https://discord.com/api/v10/channels/${input.channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${input.botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: input.content,
      components: input.components ?? [],
      allowed_mentions: input.allowedMentions ?? {
        parse: [],
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new AppError(
      'DISCORD_LOG_POST_FAILED',
      `Failed to post paid-order log message (${response.status})`,
      502,
      { body, discordStatus: response.status },
    );
  }
}

async function createDmChannel(input: {
  botToken: string;
  userId: string;
}): Promise<string> {
  const response = await fetch('https://discord.com/api/v10/users/@me/channels', {
    method: 'POST',
    headers: {
      Authorization: `Bot ${input.botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      recipient_id: input.userId,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new AppError(
      'DISCORD_DM_CHANNEL_CREATE_FAILED',
      `Failed to create DM channel (${response.status})`,
      502,
      { body, discordStatus: response.status },
    );
  }

  const payload = (await response.json()) as { id?: unknown };
  if (typeof payload.id !== 'string' || payload.id.length === 0) {
    throw new AppError(
      'DISCORD_DM_CHANNEL_CREATE_FAILED',
      'Discord returned an invalid DM channel payload',
      502,
    );
  }

  return payload.id;
}

export async function sendDirectMessageToDiscordUser(input: {
  botToken: string;
  userId: string;
  content: string;
}): Promise<void> {
  const dmChannelId = await createDmChannel({
    botToken: input.botToken,
    userId: input.userId,
  });

  await postMessageToDiscordChannel({
    botToken: input.botToken,
    channelId: dmChannelId,
    content: input.content,
    allowedMentions: {
      parse: [],
      users: [input.userId],
    },
  });
}
