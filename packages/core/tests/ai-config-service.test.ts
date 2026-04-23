import { getTableConfig } from 'drizzle-orm/mysql-core';
import { afterEach, describe, expect, it } from 'vitest';

import { getEnv, resetEnvForTests } from '../src/config/env.js';
import {
  aiAuthorizedUsers,
  aiGuildConfigs,
  aiReplyChannels,
  aiRoleRules,
  aiWebsiteSources,
  aiKnowledgeDocuments,
  aiCustomQas,
} from '../src/index.js';

const ORIGINAL_VOODOO_ENV_FILE = process.env.VOODOO_ENV_FILE;
const ORIGINAL_AI_DISCORD_TOKEN = process.env.AI_DISCORD_TOKEN;
const ORIGINAL_AI_DISCORD_CLIENT_ID = process.env.AI_DISCORD_CLIENT_ID;
const ORIGINAL_AI_DISCORD_CLIENT_SECRET = process.env.AI_DISCORD_CLIENT_SECRET;
const ORIGINAL_AI_DISCORD_REDIRECT_URI = process.env.AI_DISCORD_REDIRECT_URI;
const ORIGINAL_AI_WEB_PUBLIC_URL = process.env.AI_WEB_PUBLIC_URL;
const ORIGINAL_OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ORIGINAL_OPENAI_MODEL = process.env.OPENAI_MODEL;

function restoreEnv(key: string, value: string | undefined): void {
  if (value == null) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

describe('AI env and schema foundation', () => {
  afterEach(() => {
    resetEnvForTests();
    restoreEnv('VOODOO_ENV_FILE', ORIGINAL_VOODOO_ENV_FILE);
    restoreEnv('AI_DISCORD_TOKEN', ORIGINAL_AI_DISCORD_TOKEN);
    restoreEnv('AI_DISCORD_CLIENT_ID', ORIGINAL_AI_DISCORD_CLIENT_ID);
    restoreEnv('AI_DISCORD_CLIENT_SECRET', ORIGINAL_AI_DISCORD_CLIENT_SECRET);
    restoreEnv('AI_DISCORD_REDIRECT_URI', ORIGINAL_AI_DISCORD_REDIRECT_URI);
    restoreEnv('AI_WEB_PUBLIC_URL', ORIGINAL_AI_WEB_PUBLIC_URL);
    restoreEnv('OPENAI_API_KEY', ORIGINAL_OPENAI_API_KEY);
    restoreEnv('OPENAI_MODEL', ORIGINAL_OPENAI_MODEL);
  });

  it('parses AI worker and OpenAI env values', () => {
    process.env.VOODOO_ENV_FILE = '__missing_env_file__.env';
    process.env.AI_DISCORD_TOKEN = 'ai-token';
    process.env.AI_DISCORD_CLIENT_ID = 'ai-client';
    process.env.AI_DISCORD_CLIENT_SECRET = 'ai-client-secret';
    process.env.AI_DISCORD_REDIRECT_URI = 'http://localhost:3100/api/auth/discord/callback';
    process.env.OPENAI_API_KEY = 'sk-test-key';
    process.env.OPENAI_MODEL = 'gpt-4o-mini';
    process.env.AI_WEB_PUBLIC_URL = 'http://localhost:3100';
    resetEnvForTests();

    const env = getEnv();
    expect(env.AI_DISCORD_TOKEN).toBe('ai-token');
    expect(env.AI_DISCORD_CLIENT_ID).toBe('ai-client');
    expect(env.AI_DISCORD_CLIENT_SECRET).toBe('ai-client-secret');
    expect(env.AI_DISCORD_REDIRECT_URI).toBe('http://localhost:3100/api/auth/discord/callback');
    expect(env.OPENAI_API_KEY).toBe('sk-test-key');
    expect(env.OPENAI_MODEL).toBe('gpt-4o-mini');
    expect(env.AI_WEB_PUBLIC_URL).toBe('http://localhost:3100');
  });

  it('exports AI schema tables', () => {
    expect(aiAuthorizedUsers).toBeDefined();
    expect(aiGuildConfigs).toBeDefined();
    expect(aiReplyChannels).toBeDefined();
    expect(aiRoleRules).toBeDefined();
    expect(aiWebsiteSources).toBeDefined();
    expect(aiKnowledgeDocuments).toBeDefined();
    expect(aiCustomQas).toBeDefined();
  });

  it('enforces website source linkage and source-content deduplication for knowledge documents', () => {
    const tableConfig = getTableConfig(aiKnowledgeDocuments);
    const indexSummary = tableConfig.indexes.map((index) => ({
      columns: index.config.columns.map((column) => column.name),
      name: index.config.name,
      unique: index.config.unique,
    }));
    const foreignKeySummary = tableConfig.foreignKeys.map((foreignKey) => ({
      columnsFrom: foreignKey.reference().columns.map((column) => column.name),
      columnsTo: foreignKey.reference().foreignColumns.map((column) => column.name),
      name: foreignKey.getName(),
      onDelete: foreignKey.onDelete,
      onUpdate: foreignKey.onUpdate,
      referencesWebsiteSources: foreignKey.reference().foreignTable === aiWebsiteSources,
    }));

    expect(indexSummary).toContainEqual({
      columns: ['source_id', 'content_hash'],
      name: 'ai_knowledge_documents_source_content_hash_uq',
      unique: true,
    });
    expect(foreignKeySummary).toContainEqual({
      columnsFrom: ['source_id'],
      columnsTo: ['id'],
      name: 'ai_knowledge_documents_source_fk',
      onDelete: 'cascade',
      onUpdate: 'cascade',
      referencesWebsiteSources: true,
    });
  });
});
