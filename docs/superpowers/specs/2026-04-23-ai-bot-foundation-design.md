# AI Bot Foundation Design

## Goal

Add a new standalone Discord AI bot and a separate AI web app that together provide panel-only configuration for grounded server replies, with a completely isolated activation model and no dependency on the existing Voodoo dashboard UX.

## Approved Scope

- Create a new standalone Discord worker for the AI bot with its own Discord application and token.
- Create a new standalone web app on its own domain for AI bot marketing, auth, and guild administration.
- Expose only `/activation grant|revoke|list` as slash commands for the AI bot.
- Keep all operational setup inside the new AI web app.
- Allow the bot to reply automatically to all qualifying messages in selected channels.
- Support website knowledge from exact manually entered URLs only.
- Support custom Q&A entries managed in the panel.
- Sync website knowledge immediately when a source URL is created or edited.
- Allow manual re-sync of saved website URLs.
- Require grounded answers only; if evidence is insufficient, the bot must refuse cleanly.
- Support tone presets plus custom tone instructions in the panel.
- Support per-channel reply mode configuration:
  - inline reply in-channel
  - thread reply
- Support role-based reply gating with both modes:
  - allowlist selected roles only
  - blocklist selected roles
- Restrict panel access to Discord server owners and Discord admins only.
- Make the new AI product visually separate from the current Voodoo dashboard.
- Use a bright, airy, futuristic public design language, with a cleaner operational admin panel once signed in.

## Non-Goals

- No Discord channel-learning in this first sub-project.
- No sitemap crawl, domain crawl, or recursive website discovery.
- No bot-facing slash commands beyond `/activation`.
- No separate workspace-member permission model.
- No hidden fallback to general model knowledge when grounding fails.
- No public source attribution in bot replies for v1.
- No reuse of the current Voodoo dashboard shell or visual system as the main UI surface.
- No bundling of this AI product into the existing `apps/web-app`.

## Product Summary

This first release is the foundation for a separate AI Discord product. It consists of:

- `apps/ai-worker`
  A separate Discord worker that watches configured channels and posts grounded answers when guild rules allow it.
- `apps/ai-web-app`
  A separate Next.js app on its own domain for marketing, Discord OAuth, guild selection, and panel-based administration.
- `packages/core`
  Shared AI domain logic for config persistence, activation state, website ingestion, custom Q&A, retrieval preparation, and answer orchestration.

The web app is the control plane. The worker is the response plane. Shared storage is the source of truth between them.

## User Experience

### Discord User Experience

There are no setup slash commands for normal operators. The AI bot should feel ambient and already configured.

Behavior:

1. A server owner or admin configures the bot in the AI panel.
2. The bot watches only configured reply channels.
3. The bot checks whether the message author is allowed under the guild's role mode.
4. If grounded evidence is found, the bot answers in the configured reply style.
5. If grounded evidence is insufficient, the bot refuses cleanly instead of improvising.

The worker must ignore:

- messages outside configured reply channels
- messages from bots
- empty/noise messages that cannot reasonably be answered
- users excluded by the guild's role rule configuration

### Activation UX

`/activation` mirrors the standalone worker activation pattern already used in the repo:

- `/activation grant guild_id:<server-id> user_id:<user-id>`
- `/activation revoke guild_id:<server-id> user_id:<user-id>`
- `/activation list guild_id:<server-id>`

Rules:

- Only `SUPER_ADMIN_DISCORD_IDS` can use these commands.
- The super admin does not need to be present in the target guild.
- Activation for this AI bot is fully isolated from sales, sports, nuke, join-gate, and channel-copy activation.
- The AI worker must be present in the target guild for the activation to matter operationally.

### Panel UX

The AI product must ship with a real usable admin panel in the first milestone because all operational setup lives there.

Primary sections:

- `Overview`
  Activation state, bot presence, sync health, knowledge counts, reply coverage, and recent issues.
- `Reply Behavior`
  Manage reply channels, per-channel reply mode, role mode, and selected roles.
- `Knowledge`
  Manage exact website URLs, trigger sync, inspect source status, and manage custom Q&A.
- `Personality`
  Choose a tone preset, add custom tone instructions, and preview answer style.
- `Diagnostics`
  Surface sync errors, rejected replies, missing permissions, and recent runtime issues.

The panel must favor guided controls over generic settings forms. Each section should explain what the settings change in plain language.

## Architecture

### New Web App

Create a new standalone package:

- `apps/ai-web-app`

Responsibilities:

- public marketing site for the AI product
- Discord OAuth login
- guild discovery and guild access gating
- settings UI for all AI bot behavior
- API routes for AI bot config, source management, sync triggers, previews, and diagnostics

This app is deployed on its own domain and is visually separate from the current Voodoo dashboard.

### New Worker

Create a new standalone package:

- `apps/ai-worker`

Responsibilities:

- register and handle `/activation`
- watch messages in guild text channels the bot can access
- load guild config and activation state
- apply reply-channel and role gating
- retrieve grounded evidence
- call shared answer orchestration
- post replies inline or in threads based on config

The worker must acknowledge interactions within 3 seconds and use ephemeral responses for activation/admin flows, matching repo rules.

### Shared Core Layer

Add a dedicated AI domain to `packages/core`.

Expected shared responsibilities:

- AI activation checks
- guild-level AI configuration
- reply channel configuration
- role rule configuration
- website source persistence and sync bookkeeping
- extracted website content persistence
- custom Q&A persistence
- retrieval preparation
- grounded answer orchestration with OpenAI
- diagnostics and audit-friendly status models

## Data Model

Add AI-specific tables. Names can be refined during implementation, but the boundaries are fixed.

### `ai_authorized_users`

Guild-scoped activation allowlist for the AI worker only.

Columns:

- `id`
- `guild_id`
- `discord_user_id`
- `granted_by_discord_user_id`
- `created_at`
- `updated_at`

Constraints:

- unique on `(guild_id, discord_user_id)`
- index on `guild_id`

This table must remain completely separate from all other worker allowlists.

### `ai_guild_configs`

Guild-wide AI defaults and status.

Columns:

- `id`
- `guild_id`
- `enabled`
- `tone_preset`
- `tone_instructions`
- `role_mode`
- `default_reply_mode`
- `created_at`
- `updated_at`

`role_mode` values:

- `allowlist`
- `blocklist`

`default_reply_mode` values:

- `inline`
- `thread`

### `ai_reply_channels`

Allowed reply channels and per-channel behavior.

Columns:

- `id`
- `guild_id`
- `channel_id`
- `reply_mode`
- `created_at`
- `updated_at`

Constraints:

- unique on `(guild_id, channel_id)`
- index on `guild_id`

### `ai_role_rules`

Selected Discord roles used by the guild's reply gate mode.

Columns:

- `id`
- `guild_id`
- `role_id`
- `created_at`
- `updated_at`

Constraints:

- unique on `(guild_id, role_id)`
- index on `guild_id`

Interpretation is determined by `ai_guild_configs.role_mode`.

### `ai_website_sources`

Manually entered website URLs and their sync state.

Columns:

- `id`
- `guild_id`
- `url`
- `status`
- `last_synced_at`
- `last_sync_started_at`
- `last_sync_error`
- `http_status`
- `content_hash`
- `page_title`
- `created_by_discord_user_id`
- `updated_by_discord_user_id`
- `created_at`
- `updated_at`

`status` values:

- `pending`
- `syncing`
- `ready`
- `failed`

Constraints:

- unique on `(guild_id, url)`
- index on `(guild_id, status)`

### `ai_knowledge_documents`

Normalized extracted content prepared for retrieval from approved website sources.

Columns:

- `id`
- `guild_id`
- `source_id`
- `document_type`
- `content_text`
- `content_hash`
- `metadata_json`
- `created_at`
- `updated_at`

`document_type` is `website_page` in v1 but should not block future source types.

### `ai_custom_qas`

Admin-authored grounded Q&A entries.

Columns:

- `id`
- `guild_id`
- `question`
- `answer`
- `created_by_discord_user_id`
- `updated_by_discord_user_id`
- `created_at`
- `updated_at`

Constraints:

- index on `guild_id`

## Guild Access And Admin Rules

Panel access is limited to Discord server owners and users with Discord admin permissions.

Implications:

- no separate app-level member invite system
- no support for dashboard-only staff roles in this first sub-project
- guild access is determined from Discord OAuth plus live guild membership/permissions

If a user is authenticated but lacks owner/admin rights for a guild, the AI web app must refuse management access clearly and without ambiguity.

## Reply Rules

### Channel Gating

The worker only considers messages from channels present in `ai_reply_channels`.

### Role Gating

The worker loads the guild's `role_mode` and `ai_role_rules`.

Behavior:

- `allowlist`
  The message author must have at least one selected role.
- `blocklist`
  The message author must have none of the selected roles.

### Message Eligibility

The worker ignores:

- bot authors
- messages outside configured channels
- messages with no meaningful text content
- users blocked by role configuration

### Reply Mode

Each reply channel uses either:

- `inline`
  Reply publicly in the same channel.
- `thread`
  Post the answer into a created or reused thread tied to the question flow.

Per-channel configuration overrides guild defaults.

## Knowledge Model

### Website Sources

Rules:

- Admins add exact page URLs only.
- Saving a new source or editing an existing source triggers immediate sync.
- Admins can manually trigger re-sync later.
- No recursive crawl, sitemap import, or domain expansion in v1.

The system should store enough metadata to help operators understand whether a source is usable:

- current sync status
- last successful sync time
- last failure reason
- basic page identity such as URL and title

### Custom Q&A

Custom Q&A is first-class grounded knowledge, not just prompt text.

Use cases:

- precise business rules
- house-style answers
- exceptions not clearly represented on a website page

The panel must support create, edit, and delete flows.

## Grounded Answer Flow

The worker answer flow is:

1. Receive a message in a channel visible to the worker.
2. Load activation state for the guild.
3. Load guild config, reply channels, role rules, and tone settings.
4. Stop if the guild is not activated.
5. Stop if the message is not eligible under channel/role/message rules.
6. Retrieve candidate evidence from:
   - synced website documents
   - custom Q&A entries
7. If evidence is insufficient, return a refusal response.
8. If evidence is sufficient, construct the answer request for OpenAI with:
   - user question
   - grounded evidence only
   - selected tone preset
   - admin-specified tone instructions
9. Produce the final response in the configured reply mode.

## Answer Policy

### When Evidence Exists

The model may answer only from the grounded evidence supplied by approved sources.

### When Evidence Does Not Exist

The model must refuse cleanly and not supplement with general model knowledge.

Examples of acceptable refusal style:

- explain that the bot does not have enough approved information to answer
- suggest contacting staff if appropriate
- remain aligned to the selected tone preset without pretending certainty

### Source Visibility

Grounding is internal in v1. Replies do not include visible source citations.

## Tone And Personality

The panel supports:

- preset tone selection
- custom admin instructions layered on top of the preset

Example preset directions:

- `professional`
- `standard`
- `witty`
- `cheeky`

Preset names can be refined during implementation, but the design assumes a controlled preset list rather than fully freeform prompting.

The panel should include a preview interaction so admins can see how the tone affects answers before saving.

## Public Web Experience

The separate domain should not drop users directly into a bare login form. It needs a lightweight public product shell.

Required public surface:

- branded landing page
- concise product proposition
- product preview imagery or stitched mockups
- explanation of grounded knowledge from approved pages and Q&A
- CTA into Discord OAuth / admin access flow

## Visual Direction

### Brand Relationship

This AI product is a separate brand, not a reskinned Voodoo section.

### Public Site Direction

The public site should follow the approved reference direction:

- bright, airy atmosphere
- soft futuristic gradients
- rounded chrome
- oversized typography
- minimal navigation
- polished, premium presentation

It should feel contemporary and expensive rather than dark, dense, or generic SaaS.

The closest approved style references from `ui-ux-pro-max` are:

- `Spatial UI (VisionOS)` for depth, frosted layers, and floating-window calm
- restrained `Glassmorphism` for navigation, shells, and overlays

The implementation should avoid full `Liquid Glass` as a dominant system because the effect cost and contrast risk are too high for an everyday admin product.

### Logged-In Panel Direction

The signed-in panel should retain the same family resemblance but become more operational:

- less decorative blur
- clearer hierarchy
- stronger settings readability
- fewer theatrical effects in dense admin areas

The panel should still feel premium, but it must optimize for control and scanning rather than pure spectacle.

The signed-in product should not become a data-dense generic dashboard. The worker settings and diagnostics can be information-rich, but the UI should preserve soft spacing, rounded structure, and a calm visual cadence instead of collapsing into KPI-card sprawl.

### Design System Guardrails

Recommended visual rules, informed by `ui-ux-pro-max`:

- Typography:
  - headline direction: `Satoshi`
  - body direction: `General Sans`
  - fallback implementation can use `DM Sans` if licensing or delivery constraints require a Google-font alternative
- Color posture:
  - very light background base
  - cool primary family in blue-indigo space
  - restrained accent color for CTA states only
  - avoid default purple-heavy SaaS palettes as the dominant brand signal
- Surface system:
  - use frosted/glass panels selectively for nav, previews, and elevated controls
  - keep dense forms and diagnostics on cleaner, more opaque surfaces for readability
- Motion:
  - smooth 150-300ms operational transitions for panel interactions
  - slower atmospheric motion on the public site only
  - respect `prefers-reduced-motion`
- Accessibility:
  - maintain 4.5:1 contrast minimum in light mode
  - do not rely on blur/transparency where it weakens text legibility
  - visible focus states are mandatory

### Frontend Implementation Notes

The AI web app should follow these UI implementation constraints:

- do not use emojis as interface icons
- use a consistent SVG icon set
- ensure all interactive cards and controls have clear hover/focus affordance
- avoid hover transforms that cause layout shift
- test key layouts at `375px`, `768px`, `1024px`, and `1440px`
- avoid fixed-dimension responsive imagery in Next.js; use fill/object-fit patterns where appropriate

### Stitch Deliverables

The visual system handed to Stitch should include screens for:

- public landing page
- auth entry / guild picker
- overview dashboard
- reply behavior settings
- knowledge management
- personality settings
- diagnostics
- mobile variants for all key screens

## Permissions

### Worker Permissions

Before attempting to read or answer in a channel, the worker must verify it has the required Discord permissions for the relevant action.

At minimum, the worker should verify:

- `ViewChannel`
- `SendMessages`
- `CreatePublicThreads` or the applicable thread permission when `thread` mode is selected
- any other Discord permissions required by the chosen reply mode

If permissions are missing, the system must surface the specific missing permission clearly in diagnostics and in any relevant admin-facing response.

### Panel Permissions

The panel must clearly explain:

- when the bot is not present in the guild
- when required Discord permissions are missing
- when a channel cannot be used because the bot cannot read or write there

## Error Handling

All user-facing errors must be explicit and safe.

Examples:

- guild is not activated for the AI worker
- bot is not in the guild
- selected reply channel is not writable by the bot
- website source failed to sync
- message ignored because user role is blocked
- grounded evidence was insufficient for an answer

Errors must never expose:

- secrets
- raw OpenAI payloads
- stack traces
- SQL errors

## Testing Strategy

### Worker Tests

Cover:

- super-admin-only `/activation`
- isolated activation behavior
- message ignored outside configured reply channels
- message ignored for blocked/unauthorized roles
- inline reply mode
- thread reply mode
- grounded refusal behavior when evidence is insufficient
- graceful handling of missing Discord permissions

### Core Service Tests

Cover:

- guild config reads and writes
- role mode evaluation
- reply channel selection behavior
- website source sync bookkeeping
- custom Q&A CRUD behavior
- retrieval candidate selection
- grounded answer policy enforcement
- no fallback to general model knowledge

### Web App Tests

Cover:

- owner/admin access gating
- source save triggering sync
- manual re-sync action behavior
- panel forms for reply behavior and tone settings
- diagnostics rendering of sync and permission issues

## Environment And Workspace Updates

Add new env variables to `.env.example` and the shared env parser as needed. Expected new variables include:

- `AI_DISCORD_TOKEN`
- `AI_DISCORD_CLIENT_ID`
- OpenAI configuration for the AI product if not already present in shared env
- AI web app public origin/domain settings if separate from current web app config

Update root workspace scripts in `package.json`:

- add `apps/ai-web-app` and `apps/ai-worker` to local dev orchestration
- include both in the build graph
- add `deploy:commands:ai`
- include AI command deployment in aggregate command deployment where appropriate

## Documentation Updates

Update:

- `README.md`
- `docs/architecture.md`
- `SETUP_GUIDE.md` if setup/deployment instructions are affected

Document:

- separate AI product architecture
- isolated activation model
- owner/admin-only panel access
- panel-only configuration workflow
- website source sync behavior
- grounded-only answer policy
- separate web domain expectations

## File Boundaries

### `apps/ai-worker`

Owns Discord runtime only:

- activation command definitions and execution
- message event handling
- permission checks against live Discord channels
- reply posting

### `apps/ai-web-app`

Owns product presentation and operator workflows:

- public marketing site
- authentication and guild access flow
- settings UI
- admin API routes

### `packages/core`

Owns durable business logic and persistence:

- activation services and repositories
- AI config services and repositories
- source sync services and repositories
- retrieval and answer orchestration

## Open Decisions Resolved

- Separate web app and separate domain.
- Separate Discord worker and token.
- `/activation` is the only slash command group.
- All bot setup lives in the panel.
- Auto replies are enabled for all qualifying messages in selected channels.
- Website knowledge uses exact manual URLs only.
- Website sync happens on save and via manual re-sync.
- Grounded-only answer policy with clean refusal on insufficient evidence.
- Tone presets plus custom instructions.
- Per-channel inline/thread reply mode.
- Both allowlist and blocklist role modes.
- Owner/admin-only panel access.
- Separate visual brand from the current Voodoo dashboard.
- Airy futuristic marketing site with a cleaner operational panel.

## Implementation Notes

The later implementation plan should follow repo conventions:

- acknowledge Discord interactions within 3 seconds
- use ephemeral replies for activation and admin/config flows
- avoid hardcoded IDs and keep all configuration guild-scoped and persisted
- verify Discord permissions before API calls
- repositories return domain-shaped data, not raw rows
- update docs when workflows or behavior change
- add Vitest coverage for every behavior change
- finish only after:
  - `pnpm lint --fix`
  - `pnpm typecheck`
  - `pnpm test --coverage`
  - `pnpm build`
