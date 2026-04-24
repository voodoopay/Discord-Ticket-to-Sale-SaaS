# AI Unanswered Learning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add unanswered-question logging with Discord admin-to-Q&A conversion, plus guild-level AI reply frequency.

**Architecture:** Extend AI guild config with reply frequency and unanswered log settings, then pass those settings through the web API and worker runtime. The answer service applies frequency-specific evidence thresholds before OpenAI calls. The worker logs refusals to a configured channel and handles button/modal interactions to create Custom Q&A entries.

**Tech Stack:** TypeScript, discord.js 14, Next.js API routes, Drizzle/MySQL, Vitest, Tailwind dashboard controls.

---

## File Map

- `packages/core/src/infra/db/schema/tables.ts`: add AI config columns.
- `drizzle/migrations/0032_ai_unanswered_learning.sql`: migrate new settings.
- `packages/core/src/repositories/ai-config-repository.ts`: map/persist settings.
- `packages/core/src/services/ai-config-service.ts`: pass repository shape through existing service.
- `packages/core/src/services/ai-answer-service.ts`: add reply-frequency evidence threshold.
- `apps/ai-web-app/app/api/guilds/[guildId]/settings/route.ts`: accept new settings.
- `apps/ai-web-app/components/ai-control-plane.tsx`: add reply frequency and unanswered log channel controls.
- `apps/ai-worker/src/message-runtime.ts`: return unanswered-log intent on refusal.
- `apps/ai-worker/src/runtime.ts`: post unanswered log messages and handle Add Q&A interactions.
- `apps/ai-worker/src/index.ts`: route button/modal interactions.
- Tests in `packages/core/tests`, `apps/ai-worker/src`, and `apps/ai-web-app/app/api`.

## Task 1: Persist AI Settings

**Files:**
- Modify: `packages/core/src/infra/db/schema/tables.ts`
- Create: `drizzle/migrations/0032_ai_unanswered_learning.sql`
- Modify: `drizzle/migrations/meta/_journal.json`
- Modify: `packages/core/src/repositories/ai-config-repository.ts`
- Test: `packages/core/tests/ai-config-service.test.ts`

- [ ] **Step 1: Write failing schema/export tests**

Add assertions that `aiGuildConfigs` exposes `reply_frequency`, `unanswered_logging_enabled`, and `unanswered_log_channel_id` columns through Drizzle table config.

Run: `pnpm vitest run packages/core/tests/ai-config-service.test.ts`

Expected: FAIL because the columns do not exist.

- [ ] **Step 2: Add schema and migration**

Add columns:

```ts
replyFrequency: mysqlEnum('reply_frequency', ['low', 'mid', 'max']).notNull().default('mid'),
unansweredLoggingEnabled: boolean('unanswered_logging_enabled').notNull().default(false),
unansweredLogChannelId: varchar('unanswered_log_channel_id', { length: 32 }),
```

Migration:

```sql
ALTER TABLE `ai_guild_configs`
  ADD COLUMN `reply_frequency` enum('low','mid','max') NOT NULL DEFAULT 'mid',
  ADD COLUMN `unanswered_logging_enabled` boolean NOT NULL DEFAULT false,
  ADD COLUMN `unanswered_log_channel_id` varchar(32);
```

- [ ] **Step 3: Extend repository types**

Add `AiReplyFrequency = 'low' | 'mid' | 'max'`, include the three fields in snapshots/save inputs, default snapshots, and `saveGuildSettings` updates.

- [ ] **Step 4: Verify**

Run: `pnpm vitest run packages/core/tests/ai-config-service.test.ts`

Expected: PASS.

## Task 2: Answer Frequency Thresholds

**Files:**
- Modify: `packages/core/src/services/ai-answer-service.ts`
- Test: `packages/core/tests/ai-answer-service.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests:

```ts
it('refuses in low frequency when evidence is weak', async () => {
  // evidence score 1, sourceType website_document => refusal, OpenAI not called
});

it('answers in max frequency with weak approved evidence', async () => {
  // same weak evidence => OpenAI called and answer returned
});
```

Run: `pnpm vitest run packages/core/tests/ai-answer-service.test.ts`

Expected: FAIL because `replyFrequency` is not accepted or applied.

- [ ] **Step 2: Implement thresholds**

Add `replyFrequency` to `answerMessage` input, default callers to `mid`, and filter:

- `low`: require `sourceType === 'custom_qa'` or `score >= 4`.
- `mid`: use existing retrieved evidence.
- `max`: use existing retrieved evidence.

- [ ] **Step 3: Verify**

Run: `pnpm vitest run packages/core/tests/ai-answer-service.test.ts`

Expected: PASS.

## Task 3: Runtime Unanswered Intent

**Files:**
- Modify: `apps/ai-worker/src/message-runtime.ts`
- Test: `apps/ai-worker/src/message-runtime.test.ts`

- [ ] **Step 1: Write failing runtime tests**

Add tests that a refusal returns:

```ts
{
  kind: 'unanswered',
  logChannelId: 'log-channel',
  question: '...',
}
```

when logging is enabled and configured, and returns ignored when disabled.

Run: `pnpm --filter @voodoo/ai-worker test -- src/message-runtime.test.ts`

Expected: FAIL because the runtime only returns ignored on refusal.

- [ ] **Step 2: Implement runtime result**

Extend `AiRuntimeGuildState` and `AiRuntimeResult` with unanswered settings and result kind. Pass `replyFrequency` into `answerMessage`.

- [ ] **Step 3: Verify**

Run: `pnpm --filter @voodoo/ai-worker test -- src/message-runtime.test.ts`

Expected: PASS.

## Task 4: Discord Logging and Q&A Interactions

**Files:**
- Modify: `apps/ai-worker/src/runtime.ts`
- Modify: `apps/ai-worker/src/index.ts`
- Test: `apps/ai-worker/src/runtime.test.ts` or `apps/ai-worker/src/message-runtime.test.ts`

- [ ] **Step 1: Write failing interaction tests**

Test these behaviors:

- Unanswered result sends an embed with an `Add Q&A` button to the configured log channel.
- Non-admin button click gets an ephemeral denial.
- Admin button click opens a modal.
- Modal submission creates Custom Q&A.

Run: `pnpm --filter @voodoo/ai-worker test -- src/runtime.test.ts`

Expected: FAIL because handlers do not exist.

- [ ] **Step 2: Implement log post**

In `processIncomingMessage`, when result kind is `unanswered`, fetch/send to `logChannelId`. Embed field `Question` stores the original question. Add button custom ID `ai:unanswered:add-qa`.

- [ ] **Step 3: Implement interaction handlers**

Route button and modal interactions from `index.ts` into runtime helpers. Validate `Administrator` permission before showing modal. On modal submit, call `AiKnowledgeManagementService.createCustomQa`.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @voodoo/ai-worker test -- src/runtime.test.ts src/message-runtime.test.ts`

Expected: PASS.

## Task 5: Dashboard Controls

**Files:**
- Modify: `apps/ai-web-app/app/api/guilds/[guildId]/settings/route.ts`
- Modify: `apps/ai-web-app/components/ai-control-plane.tsx`
- Test: `apps/ai-web-app/app/api/guilds/[guildId]/snapshot/route.test.ts`

- [ ] **Step 1: Write failing API snapshot/settings tests**

Ensure snapshot includes `replyFrequency`, `unansweredLoggingEnabled`, and `unansweredLogChannelId`.

Run: `pnpm vitest run apps/ai-web-app/app/api/guilds/[guildId]/snapshot/route.test.ts`

Expected: FAIL until mocks/types include new fields.

- [ ] **Step 2: Implement API payloads**

Add the fields to `SaveAiSettingsBody` and settings payload handling.

- [ ] **Step 3: Implement UI**

Add controls in reply behavior:

- select for reply frequency
- checkbox for unanswered logging
- category/channel picker for log channel

- [ ] **Step 4: Verify**

Run: `pnpm vitest run apps/ai-web-app/app/api/guilds/[guildId]/snapshot/route.test.ts`

Expected: PASS.

## Task 6: Docs, Full Gate, Deploy

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`

- [ ] **Step 1: Update docs**

Document unanswered logging, Add Q&A, and reply frequency.

- [ ] **Step 2: Run full verification**

Run:

```powershell
pnpm lint --fix
pnpm typecheck
pnpm test --coverage
pnpm build
```

Expected: all pass with no warnings and coverage >=95%.

- [ ] **Step 3: Commit and push**

Commit implementation changes, push to `origin/main`.

- [ ] **Step 4: Deploy and smoke test**

Update `/var/www/voodoo`, run migration, restart `voodoo-ai-web` and `voodoo-ai-worker`, verify `/dashboard` returns 200 and both PM2 apps are online.
