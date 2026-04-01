# Sports Worker Expansion Design

**Date:** 2026-04-01

## Goal

Expand the sports worker from a daily UK TV listings bot into a fuller sports experience that supports live score event channels, automatic highlight posting, richer event lookup, standings, fixtures, results, and team/player information while staying on a single provider: TheSportsDB.

## Scope

This design covers:

- persistent sport channels that are only created and used for sports with events on the target day
- automatic live event channels for every televised live event
- automatic deletion of event channels 3 hours after an event finishes
- automatic and on-demand highlights
- match center lookups
- standings, fixtures, results, team, and player lookup commands
- schedule default change from `01:00` to `00:01`
- restart-safe tracking and cleanup for live events

This design does not cover:

- adding a second sports provider
- dashboard configuration for sports features
- non-Discord delivery surfaces

## Current State

The sports worker currently:

- manages one persistent text channel per sport under a managed category
- publishes daily UK TV listings into those sport channels
- supports `/sports setup`, `/sports sync`, `/sports refresh`, and `/sports status`
- supports `/search` for televised events from today through the next 7 days
- stores guild-level schedule/config state in `sports_guild_configs`
- stores persistent sport channel bindings in `sports_channel_bindings`

The current implementation relies on `SportsDataService` for:

- sport definitions
- daily TV listings
- event search
- event detail lookup

## Product Decisions

### Provider Strategy

Use approach `1`: keep TheSportsDB as the only provider for this feature set. The internal service boundaries should remain clean enough that a second provider can be introduced later without rewriting command handlers.

### Persistent Sport Channels

Sport channels remain persistent. They are not recreated daily.

However, setup, sync, and daily publish behavior changes so the worker only creates and actively publishes sport channels for sports that actually have events on the relevant day. Sports with no events that day should not receive empty daily posts.

### Live Event Channels

Every televised live event gets its own temporary event channel automatically.

The event channel lifecycle is:

1. Detect the event as live or newly eligible for live tracking.
2. Create the event channel under the managed sports category.
3. Post a live match center message.
4. Keep updating the event state while live.
5. When the event finishes, mark the event as finished.
6. Post highlights automatically when available.
7. Delete the event channel 3 hours after the finish time.

### Highlights

Highlights support both:

- automatic posting into the event channel when available after the event finishes
- on-demand lookup through slash commands

### Schedule Default

The default guild publish time changes from `01:00` to `00:01`.

This affects:

- new sports guild config bootstrap values
- docs and setup guidance
- tests that rely on the default time

## User Experience

### `/sports` Behavior

Keep `/sports` as the guild management surface and expand it with:

- `setup`
- `sync`
- `refresh`
- `status`
- `live-status`

Expected behavior:

- `/sports setup` creates or refreshes the managed category, ensures persistent sport channels exist only for sports with events on the target day, publishes today's listings, and seeds live-event tracking.
- `/sports sync` refreshes persistent sport channel bindings for the target day without republishing.
- `/sports refresh` republishes the target day's listings and reconciles live-event candidates.
- `/sports status` shows config, activation, category, channel count, schedule, and last run information.
- `/sports live-status` shows currently tracked live events, pending event-channel cleanup, and recent live-sync health.

All management responses remain ephemeral and user-friendly.

### Public Lookup Commands

Keep `/search` and add the following focused commands:

- `/live [sport] [league]`
- `/highlights query:<team/event>`
- `/match query:<team/event>`
- `/standings league:<name>`
- `/fixtures query:<team/league>`
- `/results query:<team/league>`
- `/team query:<team>`
- `/player query:<player>`

### Command Intent

- `/search` remains the broad "find upcoming televised event" entry point.
- `/live` returns current live events and their latest status.
- `/highlights` returns highlight links and fallback context.
- `/match` returns richer event detail for one match.
- `/standings` returns available league table data.
- `/fixtures` returns upcoming schedule data.
- `/results` returns recent completed event results.
- `/team` returns team profile, badge, league, venue, and roster-related info when available.
- `/player` returns player profile and team-related info when available.

## Architecture

### Service Layer

Keep `SportsDataService` as the provider-facing module, but split its responsibilities into clearer method groups:

- daily listings
- live event discovery and polling
- event details and match center data
- highlights
- standings
- fixtures and results
- team lookup
- player lookup

If the file becomes too large, split it into focused service modules under the sports service area while keeping a consistent public API for the worker.

### Runtime Layer

The sports worker runtime should contain two schedulers:

- daily publish scheduler
- live event sync scheduler

The daily scheduler remains responsible for:

- loading due guild configs
- publishing that day's sport listings at the configured local time
- ensuring only relevant persistent sport channels exist or are updated

The live scheduler is responsible for:

- polling live or near-live televised events
- creating missing event channels
- updating active event channels
- detecting finished events
- triggering highlight posting when possible
- deleting channels whose cleanup time has elapsed

### Discord Rate Control

Channel creation and live message edits must be queue-controlled so the worker does not overwhelm Discord when many events start at once.

Use the existing `p-queue` dependency for bounded concurrency and interval-based throttling around:

- event channel creation
- event channel updates
- cleanup deletion

## Data Model

### Existing Tables

Keep:

- `sports_guild_configs`
- `sports_channel_bindings`
- `sports_authorized_users`

### New Table: `sports_live_event_channels`

Add a table to track temporary event channels and their lifecycle.

Required fields:

- `id`
- `guild_id`
- `sport_name`
- `event_id`
- `event_name`
- `sport_channel_id`
- `event_channel_id`
- `status`
- `kickoff_at_utc`
- `last_score_snapshot`
- `last_state_snapshot`
- `last_synced_at_utc`
- `finished_at_utc`
- `delete_after_utc`
- `highlights_posted`
- `created_at`
- `updated_at`

Recommended status values:

- `scheduled`
- `live`
- `finished`
- `cleanup_due`
- `deleted`
- `failed`

Required uniqueness:

- unique by `guild_id + event_id`
- unique by `guild_id + event_channel_id`

Required indexes:

- by `status + last_synced_at_utc`
- by `status + delete_after_utc`
- by `guild_id`

### Snapshot Strategy

Store a compact serialized snapshot of the latest known score and state so the runtime can avoid unnecessary Discord edits when nothing materially changed.

The snapshot only needs to store what is required for diffing and recovery, such as:

- home and away names
- score string
- period or status string
- event state

## Daily Publish Rules

At the configured local time, defaulting to `00:01`:

1. Resolve the guild's local date.
2. Load televised listings for that local date.
3. Group listings by sport.
4. Ensure persistent sport channels exist only for sports with listings.
5. Clear previous managed daily posts in those sport channels.
6. Publish the current day's sport schedule in each relevant persistent sport channel.
7. Reconcile live-event candidates for the same day.
8. Schedule the next run.

Important rules:

- no empty daily placeholder posts for sports with no events that day
- existing persistent sport channels can remain if already created, but daily posting only happens for sports with events
- any newly needed persistent sport channel should be created on demand during setup, sync, refresh, or daily publish

## Live Event Rules

### Detection

The worker polls TheSportsDB live-capable endpoints on a shorter interval and identifies televised events that are:

- already live
- about to go live and should be prepared for tracking
- recently finished but still awaiting cleanup or highlights

### Channel Naming

Event channels should be generated from the event name with a stable, readable slug. The name should stay inside Discord limits and avoid collisions where possible.

Example shape:

- `live-arsenal-vs-chelsea`
- `live-rangers-v-celtic`

### Event Channel Content

Each event channel should include:

- a headline status message or embed
- current score
- state or period
- kickoff time in guild timezone
- league
- venue
- broadcasters
- artwork when available
- later, highlight links when available

The main event message should be edited in place where practical rather than spamming new messages for every score change.

### Finish And Cleanup

When the provider marks an event finished:

1. Store `finished_at_utc`.
2. Compute `delete_after_utc = finished_at_utc + 3 hours`.
3. Post automatic highlights if available and not yet posted.
4. Mark the record for cleanup.
5. Delete the channel when `delete_after_utc` is reached.
6. Mark the DB record `deleted`.

If the event finish time is unavailable, use the first observed finished timestamp from the worker clock.

## Recovery And Idempotency

On worker startup:

1. Load tracked live event rows that are not `deleted`.
2. Verify whether their Discord channels still exist.
3. Resume live updates for active events.
4. Continue scheduled cleanup for finished events.
5. Repair state if the channel was already removed externally.

Idempotency rules:

- never create more than one event channel per `guild_id + event_id`
- channel creation must re-check the DB row before and after creation
- highlight posting must be guarded by the `highlights_posted` flag
- cleanup deletion must tolerate channels already deleted by staff or Discord

## Error Handling

### User-facing

- interaction responses must acknowledge within 3 seconds
- longer I/O must defer replies
- errors must stay explicit and friendly
- no raw stack traces or secrets in Discord responses

### Runtime-facing

Structured logs must exist for:

- live event discovery failure
- channel creation failure
- message update failure
- highlight lookup and post failure
- cleanup deletion failure
- restart recovery mismatch

Failures should retry where safe. Non-retryable failures should still leave a clear DB and log trail.

## Permissions

Before Discord writes, verify the bot has the required guild or channel permissions.

For live event channel management, the worker needs at minimum:

- `View Channel`
- `Manage Channels`
- `Send Messages`
- `Embed Links`
- `Manage Messages`
- `Read Message History`

Error messages should name exactly which permissions are missing.

## Testing Strategy

Add or update tests for:

- daily listing grouping by sport
- "only sports with events today" channel-binding behavior
- new default schedule time `00:01`
- live event discovery and filtering
- event channel creation idempotency
- event state updates without duplicate posts
- event finish detection
- highlight autopost guard behavior
- channel cleanup 3 hours after finish
- startup recovery and reconciliation
- every new slash command path
- permission failures and provider failures

Coverage must remain at or above the repo requirement.

## Documentation Updates

Update:

- `README.md`
- `SETUP_GUIDE.md`

Required documentation changes:

- new default sports publish time `00:01`
- persistent sport channels only posting for sports with events
- automatic live event channels
- auto-delete behavior 3 hours after finish
- auto and manual highlights
- new lookup commands and `/sports live-status`

## Implementation Notes

Implementation should stay focused on the requested feature set only.

Do not add:

- dashboard sports management UI
- subscription or preferences UI
- unrelated provider refactors

The implementation should still keep internal service boundaries clean so a second provider can be added later if needed.

## Success Criteria

This feature is complete when:

- the sports worker publishes at `00:01` by default
- persistent sport channels are only actively used for sports with events that day
- every televised live event gets its own temporary channel automatically
- live event channels update while the event is active
- highlights post automatically when available and can also be requested manually
- new commands for live, match, standings, fixtures, results, team, and player data work cleanly
- finished event channels are deleted 3 hours after finish
- runtime recovery survives restarts without duplicate channels or orphaned cleanup jobs
- docs, migrations, tests, and deployment flow are all updated
