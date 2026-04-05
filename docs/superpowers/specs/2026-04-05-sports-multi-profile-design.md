# Sports Multi-Profile Design

**Date:** 2026-04-05

## Goal

Extend the sports worker from a single-country guild configuration into a multi-profile system where one Discord server can manage multiple daily sports listing categories and multiple live-event categories, each tied to a specific broadcast country, while keeping a shared daily publish time of `00:01`.

This design also fixes the current live-event behavior so live channels update during the event instead of only appearing after the event has finished.

## Scope

This design covers:

- multiple sports listing profiles per guild
- one daily listings category per profile
- one live-event category per profile
- one `broadcastCountry` per profile
- shared guild-level publish time of `00:01`
- daily listings publishing for all enabled profiles
- live-event creation and updates only for configured profiles
- keeping final scores visible until live-event channel deletion
- fixing live tracking so active events update during the live window
- migration from the existing single-profile guild config
- command changes needed to manage multiple profiles

This design does not cover:

- adding a second sports data provider
- dashboard-based sports configuration
- changing the 3-hour live-event cleanup window
- changing the shared daily publish time away from `00:01`

## Current State

The sports worker currently stores a single guild-level sports config in `sports_guild_configs` with:

- one managed daily listings category
- one live-event category
- one `broadcastCountry`
- one timezone
- one shared schedule

The current worker also stores:

- persistent sport channel bindings in `sports_channel_bindings`
- tracked live-event channels in `sports_live_event_channels`

This model only supports one country per guild. A server can currently configure either UK, USA, or another single country, but not multiple countries side by side.

The live-event runtime is intended to update live event channels while events are active. In practice, the worker currently relies too heavily on TV-enrichment success before treating a live event as trackable. When that enrichment is delayed or rate-limited, live channels can be missed during the event and only show up after the event reaches a later state.

## Product Decisions

### Multi-Profile Model

Each guild can have multiple sports profiles.

Each profile represents one country-specific sports setup, for example:

- `uk` -> daily category `UK Daily Sport`, live category `UK Live Sport`, country `United Kingdom`
- `usa` -> daily category `USA Daily Sport`, live category `USA Live Sport`, country `United States`

Profiles are the unit of configuration for:

- broadcast country
- daily listings category
- live-event category
- enabled or disabled state

### Shared Schedule

The guild keeps one shared sports publish schedule:

- publish time: `00:01`
- timezone: one shared guild timezone

All enabled profiles publish on that same schedule.

### Daily Listings Behavior

Each profile publishes only into its own daily category.

Persistent sport channels remain per profile. That means:

- `Soccer` in the UK profile and `Soccer` in the USA profile are separate managed channels
- if a profile has no listings for a sport on that day, the channel remains but is cleared
- if a profile has no events at all for that day, its managed channels remain empty

### Live-Event Behavior

Live-event channels are profile-scoped.

That means:

- live-event channels are created only for countries that have a configured profile
- live-event channels are created only inside that profile’s live category
- there is no shared live category across all countries
- if a profile has no live category configured, live-event channels are disabled for that profile

When an event is active:

1. the worker matches the event to a configured profile
2. the worker creates or reuses the live-event channel for that profile
3. the worker updates score and state while the event remains live
4. the worker posts highlights when available after finish
5. the final score remains visible until the channel is deleted
6. the channel is deleted 3 hours after the event finishes

### Search And Lookup Behavior

Manual lookup commands should be profile-aware.

The commands keep their existing event/team/player behavior, but they should allow the user to specify either:

- a profile
- a broadcast country

If no profile or country is specified:

- commands should use a safe default resolution rule
- when there is only one enabled profile, use it automatically
- when there are multiple enabled profiles, require explicit selection or return a clear prompt to narrow the request

This avoids silently using the wrong country.

## Architecture

### Guild-Level Settings

Retain a guild-level sports settings record for shared schedule state only.

This record should hold:

- guild ID
- enabled flag
- shared publish time `00:01`
- timezone
- next run timestamp
- last run timestamp
- last local run date
- updated by Discord user ID

The guild-level record should no longer hold:

- daily category channel ID
- live category channel ID
- broadcast country

Those become profile-level concerns.

### Sports Profiles

Add a new `sports_listing_profiles` table keyed by guild.

Each row stores:

- profile ID
- guild ID
- profile label or slug
- broadcast country
- daily category channel ID
- live category channel ID
- enabled flag
- created at
- updated at

Suggested constraints:

- unique `(guild_id, profile_slug)`
- unique `(guild_id, daily_category_channel_id)` when daily category is present
- unique `(guild_id, live_category_channel_id)` when live category is present

### Channel Bindings

Persistent sport channel bindings must move from guild scope to profile scope.

Current:

- one row per `(guild, sport)`

Target:

- one row per `(profile, sport)`

Each row should store:

- binding ID
- profile ID
- guild ID
- sport ID
- sport name
- sport slug
- channel ID
- created at
- updated at

This allows the same sport to exist once per profile without collisions.

### Live Event Tracking

Tracked live-event rows must also move from guild scope to profile scope.

Current:

- one row per `(guild, event)`

Target:

- one row per `(profile, event)`

Each row should store:

- tracked event ID
- profile ID
- guild ID
- sport name
- event ID
- event name
- sport channel ID
- event channel ID
- status
- kickoff timestamp
- last score snapshot
- last state snapshot
- last synced timestamp
- finished timestamp
- delete-after timestamp
- highlights-posted flag
- created at
- updated at

Suggested constraints:

- unique `(profile_id, event_id)`
- unique `(guild_id, event_channel_id)` for non-null channel IDs

## Runtime Design

### Daily Publishing

The daily scheduler should:

1. load all enabled guild-level configs that are due
2. load all enabled profiles for each guild
3. for each profile, fetch that day’s listings for the profile’s broadcast country
4. ensure sport channels exist under the profile’s daily category
5. publish listings only to that profile’s sport channels
6. clear profile sport channels that have no listings that day
7. mark the shared guild schedule run complete after all enabled profiles finish

Failure handling:

- one profile failure should not corrupt another profile’s state
- the guild run should be treated as failed if any profile fails, and the existing retry mechanism should reschedule the guild run
- logs should identify both `guildId` and `profileId`

### Live Event Matching

The live-event scheduler should:

1. load all enabled profiles with live categories
2. fetch live events for each profile country
3. match events to that profile
4. create, update, finish, and clean up channels within that profile’s live category

Matching should be profile-local. A UK profile only handles UK-matched live events. A USA profile only handles USA-matched live events.

### Fixing The Current Live Bug

The live bug is caused by over-coupling event tracking to successful TV enrichment.

Current weak point:

- live-event discovery starts from the live feed
- enrichment is used to attach broadcaster data
- the runtime filters to events where `broadcasters.length > 0`
- when enrichment is delayed or rate-limited, otherwise valid live events can be dropped

Required behavior:

- track the event from the base live feed first
- continue updating score and state while the event is live
- treat enrichment as optional data, not as the gate for whether a live event exists
- only use profile country matching to decide which configured profile should own the event

Implementation direction:

- make `SportsDataService.listLiveEvents` resilient when TV enrichment fails
- preserve country-matching data separately from `broadcasters.length`
- do not drop a still-live event from the runtime only because enrichment is incomplete
- once a live event is already tracked, keep updating it until the live feed says it is no longer live

### Finished Event Behavior

When an event leaves the live feed:

1. mark it finished
2. render the finished state into the channel without clearing the final score away
3. post highlights if available
4. schedule deletion 3 hours later
5. delete the channel at cleanup time

If the live category becomes unavailable:

- do not create or update live channels for that profile
- already tracked cleanup work can still run so finished channels are removed on time

## Command Design

Replace the single-profile setup flow with profile management commands.

### `/sports profile-add`

Inputs:

- `label`
- `broadcast_country`
- `daily_category_name`
- `live_category_name`

Behavior:

- creates the profile
- creates or resolves the two managed categories
- saves the profile
- creates any needed daily sport channels for the current day
- publishes current daily listings for that profile

### `/sports profile-update`

Inputs:

- `profile`
- optional new `label`
- optional new `broadcast_country`
- optional new `daily_category_name`
- optional new `live_category_name`
- optional enabled flag

Behavior:

- updates only the selected profile
- preserves other profiles
- re-syncs profile-managed channels if country or category changes

### `/sports profile-remove`

Inputs:

- `profile`

Behavior:

- removes the selected profile configuration
- does not silently delete unrelated categories or channels
- marks or removes profile-scoped bindings and tracked event state safely

Destructive channel deletion is out of scope for the initial version unless explicitly requested later.

### `/sports profiles`

Behavior:

- lists all configured profiles for the guild
- shows country, daily category, live category, enabled state, and managed channel count

### `/sports refresh`

Behavior:

- republishes all enabled profiles for the guild

### `/sports status`

Behavior:

- shows guild-level schedule/timezone
- shows all profiles and their categories
- shows channel counts per profile

### `/sports live-status`

Behavior:

- groups tracked live events by profile
- shows current live count, pending cleanup, and stale sync state per profile

### Lookup Commands

The following should accept an optional profile or country selector:

- `/search`
- `/live`
- `/match`
- `/fixtures`
- `/results`
- `/standings`
- `/team`
- `/player`
- `/highlights`

## Migration Strategy

Migration must preserve current guilds.

### Step 1: Introduce Profile Tables

Add:

- guild-level shared sports settings if the current config table is being split
- `sports_listing_profiles`
- profile-scoped bindings table or updated bindings schema
- profile-scoped live-event table or updated live-event schema

### Step 2: Backfill Existing Guilds

For each existing `sports_guild_configs` row:

1. create one default profile
2. move the existing `broadcastCountry`, daily category, and live category into that profile
3. move existing `sports_channel_bindings` rows onto the new profile
4. move existing `sports_live_event_channels` rows onto the new profile

This keeps current servers working without manual reconfiguration.

### Step 3: Remove Obsolete Single-Profile Fields

Once code reads from profiles:

- remove category and country fields from the old single-guild config shape
- keep only shared schedule fields there

## Error Handling

- Missing permissions must name the exact missing Discord permissions.
- Profile-level errors must identify which profile failed.
- API failures must keep using user-safe messages and structured logs.
- No silent skips when a configured profile cannot publish or sync.
- If multiple profiles exist and a lookup command has no country selector, the response must explain how to disambiguate instead of guessing.

## Testing

Add or update tests for:

- profile creation, update, listing, and removal
- migration from single-profile guild config to multi-profile state
- per-profile daily publishing
- multiple countries in one guild
- profile-scoped persistent sport bindings
- profile-scoped live-event tracking
- empty daily sport channels staying present but cleared
- live-event channels updating while live
- live tracking surviving temporary enrichment failures
- final score staying visible until channel deletion
- live-event creation only for profiles with configured live categories
- command resolution when multiple profiles exist

Coverage must remain at or above the repo requirement of `95%`.

## Rollout

Implementation is complete only when all of the following are done:

1. migrations are added and journaled
2. full local gate passes:
   - `pnpm lint --fix`
   - `pnpm typecheck`
   - `pnpm test --coverage`
   - `pnpm build`
3. changes are committed and pushed
4. `main` on the droplet is updated
5. the droplet runs:
   - `pnpm install`
   - `pnpm build`
   - `pnpm migrate`
   - `pnpm deploy:commands`
   - PM2 restart
6. smoke tests confirm:
   - multi-profile daily publishing
   - correct country-to-category mapping
   - live channels updating during live events
   - final score retained until cleanup

## Summary

The sports worker should move from a single-country guild config to a multi-profile guild model.

That model gives each country its own:

- daily listings category
- live-event category
- broadcast country configuration

while keeping one shared guild publish time of `00:01`.

The live-event runtime should also be corrected so live channels update during the event window, with broadcaster enrichment treated as optional supporting data rather than the condition that decides whether a live event is tracked at all.
