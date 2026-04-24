# AI Unanswered Learning and Reply Frequency Design

## Goal

Add an operational feedback loop for Voodoo AI so unanswered questions can be reviewed inside Discord and converted into Custom Q&A entries without opening the dashboard. Add a guild-level reply-frequency setting so server owners can choose how aggressively the bot answers.

## Scope

This change applies to the standalone AI bot and AI dashboard only:

- `apps/ai-worker` logs unanswered qualifying messages and handles Discord button/modal submissions.
- `apps/ai-web-app` exposes settings for unanswered logging and reply frequency.
- `packages/core` persists the new guild settings and saves approved unanswered questions into the existing Custom Q&A store.

It does not add a dashboard review inbox in this iteration.

## Guild Settings

Add these persisted AI guild settings:

- `replyFrequency`: `low | mid | max`, default `mid`.
- `unansweredLoggingEnabled`: boolean, default `false`.
- `unansweredLogChannelId`: nullable Discord channel ID.

`replyFrequency` controls answer strictness:

- `low`: reply only when evidence is strong. Strong evidence means at least one retrieved Custom Q&A item or at least one retrieved source with score `>= 4`.
- `mid`: current balanced behavior.
- `max`: answer whenever approved evidence is available, while still refusing if there is no evidence.

The AI must never use outside model knowledge in any mode.

## Runtime Flow

When an incoming message qualifies for AI handling:

1. Load guild activation and AI settings.
2. Resolve whether the message is in an active reply channel or auto-selected reply category.
3. Enforce role allowlist/blocklist.
4. Ask the answer service using the configured `replyFrequency`.
5. If an answer is returned, reply inline or in a thread as configured.
6. If the answer service refuses because evidence is missing or too weak, do not reply publicly.
7. If unanswered logging is enabled and a log channel is configured, post an admin-facing log message to that channel.

Logging failures must not cause a public reply or crash message processing. They must be logged internally.

## Unanswered Log Message

The log message must be posted in the configured server channel and include:

- Original question text.
- Source channel mention.
- Asking user mention.
- Timestamp or Discord jump context when available.
- A short note that no approved answer was available.
- An `Add Q&A` button.

The message is operational admin UI, so it must be concise and not expose stack traces or secrets.

## Add Q&A Interaction

Any member with Discord `Administrator` permission in the guild may use the `Add Q&A` button.

Flow:

1. Admin clicks `Add Q&A`.
2. Worker validates the interaction is in a guild and the member has `Administrator`.
3. Worker opens a modal.
4. Modal includes:
   - Question field prefilled with the unanswered question.
   - Answer field blank.
5. Admin submits the modal.
6. Worker saves a Custom Q&A entry using the existing AI knowledge service:
   - `question`: modal question value.
   - `answer`: modal answer value.
   - `createdByDiscordUserId` and `updatedByDiscordUserId`: clicking admin ID.
7. Worker replies ephemerally with success or a clear validation error.

Permission failures must be ephemeral and specific.

## Data Model

Extend `ai_guild_configs` rather than creating a new settings table:

- `reply_frequency`
- `unanswered_logging_enabled`
- `unanswered_log_channel_id`

No new table is required for unanswered questions because the Discord log message is the queue, and accepted items are saved into `ai_custom_qas`.

The unanswered log embed must store the original question in a predictable embed field. The button custom ID should only carry a compact action marker, because Discord custom IDs are size-limited. On click, the worker reads the question back from the log message embed. If the embed field is missing or malformed, the interaction must explain that the item cannot be converted and ask the admin to add the Q&A from the dashboard.

## Dashboard UX

Add controls to the AI dashboard reply behavior area:

- Reply frequency select: `Low`, `Mid`, `Max`.
- Unanswered logging toggle.
- Log channel picker grouped by category, using normal text/announcement channels.

The log channel picker is separate from knowledge channels because it is an operator channel, not a source of truth.

## Answer Service

The answer service must accept `replyFrequency` and use it to adjust the minimum evidence threshold before calling OpenAI:

- `low`: require at least one Custom Q&A evidence item or one evidence item with score `>= 4`.
- `mid`: keep the current retrieval threshold, which is any positive-score retrieved evidence.
- `max`: allow any retrieved evidence and pass up to the normal retrieval limit into the model.

If the threshold is not met, return the existing refusal result so the worker can log the unanswered question.

OpenAI instructions must still explicitly require using only approved evidence and returning the exact refusal message when evidence does not answer the question.

## Error Handling

- Missing or inaccessible log channel: skip unanswered logging and write an internal warning.
- Missing bot permissions in the log channel: skip logging and write an internal warning.
- Button clicked by non-admin: ephemeral denial.
- Expired/missing unanswered context: ephemeral explanation.
- Custom Q&A validation failure: ephemeral validation message.
- Custom Q&A save failure: ephemeral generic internal error message.

## Testing

Add or update tests for:

- AI config repository/service persistence for new settings.
- Answer service `low`, `mid`, and `max` threshold behavior.
- Runtime returns a public reply when an answer exists.
- Runtime logs an unanswered question when refusal occurs and logging is configured.
- Runtime skips unanswered logging when disabled or no channel is configured.
- Discord interaction handler opens the Add Q&A modal for administrators.
- Discord interaction handler rejects non-admin users ephemerally.
- Modal submission creates a Custom Q&A entry.
- Dashboard settings payload includes reply frequency and unanswered log channel settings.

## Deployment Notes

Deployment requires a DB migration for the new `ai_guild_configs` columns, then restarting `voodoo-ai-web` and `voodoo-ai-worker`.
