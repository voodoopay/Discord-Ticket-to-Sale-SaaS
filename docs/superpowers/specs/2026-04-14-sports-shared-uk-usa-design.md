# Sports Shared UK-USA Category Design

**Date:** 2026-04-14

## Goal

Change the sports worker so one Discord server can run a single shared sports category that publishes daily televised fixtures from both the United Kingdom and the United States, refreshed automatically at `00:01` UK time, while also creating live-event channels that update scores during the day.

The command flow should stay simple:

- `/sports setup`
- ask for the category name
- create the managed channels
- publish the daily listings immediately
- refresh them automatically every day at `00:01` in `Europe/London`

## Scope

This design covers:

- one shared daily sports category per guild
- one optional shared live-events category per guild
- one guild sports config with a multi-country source list
- merged daily listings from `United Kingdom` and `United States`
- one sport channel per guild and sport
- one live-event channel per live televised event
- score updates in live-event channels during the event
- de-duplication when the same event appears in both country feeds
- updates to command behavior, scheduler behavior, persistence, tests, and docs

This design does not cover:

- multiple independent sports profiles per guild
- dashboard-based sports configuration
- user-selectable schedules beyond the existing daily publish time model
- a second sports data provider
- deleting empty daily sport channels as part of v1

## Current State

The sports worker already supports:

- `/sports setup`, `/sports sync`, `/sports refresh`, `/sports status`, and `/sports live-status`
- one guild-level sports config with:
  - one managed daily category
  - one live-event category
  - one `broadcastCountry`
  - one timezone
  - one daily schedule
- persistent sport channel bindings per guild
- tracked live-event channels per guild
- a daily scheduler with a default publish time of `00:01`
- a live-event runtime that creates temporary live channels and posts updates

The main limitation is that the current config only supports one `broadcastCountry` string. That means a guild can be configured for the UK or the USA, but not both together in one shared category.

## Product Decisions

### Shared Category Model

Each guild keeps one shared sports setup.

That setup owns:

- one managed daily category
- one optional live-events category
- one timezone
- one publish time
- one source-country list

The source-country list defaults to:

- `United Kingdom`
- `United States`

### Daily Listings Behavior

The bot manages one persistent text channel per sport under the shared daily category.

Examples:

- `soccer`
- `basketball`
- `boxing`
- `baseball`

Each day at `00:01` UK time:

1. the worker loads that day’s listings for both countries
2. it merges and de-duplicates the events
3. it groups them by sport
4. it republishes the daily posts inside each sport channel

If a sport has no listings on that day:

- the channel remains
- the previous daily posts are removed
- nothing new is posted into that channel

This keeps the channel map stable and predictable.

### Live-Event Behavior

If a live-events category is configured:

- the worker watches live televised events from both countries
- it de-duplicates duplicate events across the two country feeds
- it creates one temporary channel per live event
- it edits the live event content as the score or state changes
- it posts a finished state and highlights when available
- it deletes the temporary channel after the existing cleanup window

If no live-events category is configured:

- daily sport channels still work
- live-event channel creation remains disabled

### Score Update UX

The preferred score UX is:

- one current scoreboard message in each live-event channel
- that message is edited as the event changes
- a header message can stay above it for context
- the final score remains visible when the event is marked finished

This avoids spamming the channel with repeated score messages.

Renaming the live-event channel with the current score is optional and should not be part of the initial version.

## Architecture

### Guild Sports Config

Keep the current guild-level sports config model instead of introducing multiple profiles.

The guild config should continue to store:

- guild ID
- enabled flag
- managed daily category channel ID
- live-events category channel ID
- publish time
- timezone
- next run timestamp
- last run timestamp
- last local run date
- updated by Discord user ID

Replace the single `broadcastCountry` field with a multi-country field.

Recommended persisted shape:

- `broadcastCountries: string[]`

Initial supported value for the shared setup:

- `["United Kingdom", "United States"]`

Migration should backfill existing rows so a single old `broadcastCountry` becomes:

- `[oldBroadcastCountry]`

### Channel Bindings

Keep sport channel bindings at guild scope.

Current model:

- one row per `(guild, sport)`

That still fits the shared-category design because the guild now owns one merged sport space rather than multiple country-specific profiles.

Each binding continues to store:

- binding ID
- guild ID
- sport ID
- sport name
- sport slug
- channel ID
- created at
- updated at

### Live Event Tracking

Keep tracked live events at guild scope.

Current model:

- one row per `(guild, event)`

That still fits because one guild now has one shared live-event space.

The runtime should continue to store snapshots of score and state so it can skip Discord writes when nothing changed.

## Data Flow

### `/sports setup`

The setup flow should:

1. acknowledge the interaction immediately with an ephemeral defer
2. verify the caller has `Manage Server` or `Administrator`
3. verify the bot has the required guild permissions
4. ask for the category name
5. optionally ask for the live-events category name
6. save a guild config with:
   - timezone `Europe/London`
   - publish time `00:01`
   - source countries `[United Kingdom, United States]`
7. create or update the managed categories
8. create any needed sport channels for today
9. publish today’s merged daily listings immediately

The command should stay user-friendly and not expose the country list unless that needs to become configurable later.

### Daily Scheduler

The daily scheduler should:

1. load due guild configs
2. for each guild, fetch today’s listings for both countries
3. merge and de-duplicate the events
4. group the merged events by sport
5. ensure the sport channels exist
6. clear and republish the daily posts for sports with listings
7. clear channels for sports with no listings that day
8. mark the run complete and compute the next `00:01` UK run

If a publish fails:

- log the failure
- schedule the existing retry window
- do not silently skip the guild

### Live Scheduler

The live scheduler should:

1. load active guild configs
2. fetch live events for both countries
3. merge and de-duplicate the same event across those feeds
4. create or reuse the shared sport channel if needed
5. create or reuse the temporary live-event channel
6. edit the live-event message when score or state changes
7. mark events finished when they leave the live feed
8. post highlights when available
9. delete finished channels after the cleanup window

## Merge And De-Duplication Rules

Daily and live-event merge behavior needs deterministic de-duplication.

Recommended rule:

- if two entries share the same provider event ID, they are the same event
- if one feed lacks an event ID match, fall back to a normalized comparison of:
  - sport name
  - event name
  - kickoff time

When duplicates are merged:

- keep one canonical event
- combine broadcaster metadata from both entries if useful
- do not publish the event twice
- do not create duplicate live-event channels

This rule should live in the data-service layer so both the daily and live schedulers use the same merge behavior.

## Error Handling

- Permission failures must stay explicit and ephemeral.
- Setup must name the exact missing Discord permissions.
- Missing or deleted managed categories should trigger recreation or a clear runtime error, not silent failure.
- If one country feed fails and the other succeeds, the worker should publish the successful country’s data and log the partial failure.
- If both feeds fail, the guild publish should fail and use the retry path.
- If a live-event channel was deleted manually, the runtime should recover it on the next reconcile when the event is still active.
- Secrets, stack traces, and raw provider failures must not leak into Discord responses.

## Testing

Add or update tests for:

- guild config persistence with `broadcastCountries`
- migration from legacy single-country config rows
- merged daily listings across UK and USA
- de-duplication of duplicate events across both feeds
- shared-category sport-channel sync behavior
- daily publish clearing and republishing existing channels
- live-event merge behavior without duplicate channels
- score/state message edits only when tracked state changes
- final score remaining visible until cleanup
- `/sports setup` status and output text for the merged configuration
- docs updates for the new setup behavior

Coverage must remain at or above the repo requirement of `95%`.

## Rollout

Implementation is complete only when all of the following are done:

1. schema and repository changes are added
2. runtime and command changes are implemented
3. docs are updated in `README.md` and relevant `docs/**`
4. local verification passes:
   - `pnpm lint --fix`
   - `pnpm typecheck`
   - `pnpm test --coverage`
   - `pnpm build`
5. changes are committed and pushed
6. the droplet is updated so `/var/www/voodoo` matches the pushed commit
7. smoke tests confirm:
   - `/sports setup` creates the shared category
   - daily listings contain merged UK and USA events
   - live channels update scores during the event
   - finished live channels retain the final state until cleanup

## Summary

The sports worker should stay a single shared guild sports setup, but move from one `broadcastCountry` to a multi-country source list containing the UK and USA.

That keeps the current architecture mostly intact while enabling:

- one shared sports category
- one sport channel per sport
- merged UK and USA daily listings
- one temporary live channel per live event
- score updates inside the live channel during the event

This is the smallest clean redesign that matches the requested UX without forcing the bot into a heavier multi-profile system.
