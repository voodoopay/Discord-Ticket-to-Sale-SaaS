import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1).default('MISSING_DISCORD_TOKEN'),
  DISCORD_CLIENT_ID: z.string().min(1).default('MISSING_DISCORD_CLIENT_ID'),
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_BOT_USERNAME: z.string().default(''),
  NUKE_DISCORD_TOKEN: z.string().default(''),
  NUKE_DISCORD_CLIENT_ID: z.string().default(''),
  NUKE_POLL_INTERVAL_MS: z.coerce.number().int().min(5_000).default(30_000),
  DATABASE_URL: z.string().min(1).default('mysql://root:root@localhost:3306/voodoo'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  DISCORD_CLIENT_SECRET: z.string().default(''),
  DISCORD_REDIRECT_URI: z
    .string()
    .url()
    .default('http://localhost:3000/api/auth/discord/callback'),
  SESSION_SECRET: z
    .string()
    .min(32)
    .default('dev-session-secret-change-me-dev-session-secret-change-me'),
  ENCRYPTION_KEY: z
    .string()
    .min(32)
    .default('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='),
  CHECKOUT_SIGNING_SECRET: z
    .string()
    .min(32)
    .default('dev-checkout-signing-secret-change-me-1234567890'),
  SUPER_ADMIN_DISCORD_IDS: z.string().default(''),
  BOT_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  DISCORD_API_BASE_URL: z.string().url().default('https://discord.com/api/v10'),
  VOODOO_PAY_API_BASE_URL: z.string().url().default('https://api.voodoo-pay.uk'),
  VOODOO_PAY_CHECKOUT_BASE_URL: z.string().url().default('https://checkout.voodoo-pay.uk'),
});

export type AppEnv = z.infer<typeof envSchema> & {
  superAdminDiscordIds: string[];
};

let cachedEnv: AppEnv | null = null;
let envBootstrapped = false;

function normalizeEnvKeys(): void {
  const bomPrefix = /^\uFEFF+/;

  for (const key of Object.keys(process.env)) {
    if (!bomPrefix.test(key)) {
      continue;
    }

    const normalizedKey = key.replace(bomPrefix, '');
    if (!normalizedKey) {
      continue;
    }

    if (process.env[normalizedKey] == null) {
      process.env[normalizedKey] = process.env[key];
    }

    delete process.env[key];
  }
}

function bootstrapEnv(): void {
  if (envBootstrapped) {
    return;
  }

  const explicitEnvPath = process.env.VOODOO_ENV_FILE?.trim();
  const candidatePaths = explicitEnvPath
    ? [explicitEnvPath]
    : [
        resolve(process.cwd(), '.env'),
        resolve(process.cwd(), '..', '.env'),
        resolve(process.cwd(), '..', '..', '.env'),
        resolve(process.cwd(), '..', '..', '..', '.env'),
      ];

  for (const candidatePath of candidatePaths) {
    if (!existsSync(candidatePath)) {
      continue;
    }

    process.loadEnvFile(candidatePath);
    normalizeEnvKeys();
    envBootstrapped = true;
    return;
  }

  envBootstrapped = true;
}

export function getEnv(): AppEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  bootstrapEnv();

  const parsed = envSchema.parse(process.env);
  cachedEnv = {
    ...parsed,
    superAdminDiscordIds: parsed.SUPER_ADMIN_DISCORD_IDS.split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  };

  return cachedEnv;
}

export function resetEnvForTests(): void {
  cachedEnv = null;
}
