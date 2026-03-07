import type { ApplicationCommandOptionChoiceData } from 'discord.js';

const MAX_AUTOCOMPLETE_CHOICES = 25;

const PRIORITY_TIMEZONES = [
  'Europe/London',
  'Europe/Dublin',
  'Europe/Lisbon',
  'Europe/Berlin',
  'Europe/Paris',
  'Europe/Amsterdam',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Vancouver',
  'America/Sao_Paulo',
  'America/Mexico_City',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Pacific/Auckland',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'Etc/UTC',
];

const PRIORITY_LABELS: Record<string, string> = {
  'Europe/London': 'London (Europe/London)',
  'Europe/Dublin': 'Dublin (Europe/Dublin)',
  'Europe/Lisbon': 'Lisbon (Europe/Lisbon)',
  'Europe/Berlin': 'Berlin (Europe/Berlin)',
  'Europe/Paris': 'Paris (Europe/Paris)',
  'Europe/Amsterdam': 'Amsterdam (Europe/Amsterdam)',
  'America/New_York': 'New York (America/New_York)',
  'America/Chicago': 'Chicago (America/Chicago)',
  'America/Denver': 'Denver (America/Denver)',
  'America/Los_Angeles': 'Los Angeles (America/Los_Angeles)',
  'America/Toronto': 'Toronto (America/Toronto)',
  'America/Vancouver': 'Vancouver (America/Vancouver)',
  'America/Sao_Paulo': 'Sao Paulo (America/Sao_Paulo)',
  'America/Mexico_City': 'Mexico City (America/Mexico_City)',
  'Asia/Dubai': 'Dubai (Asia/Dubai)',
  'Asia/Kolkata': 'India (Asia/Kolkata)',
  'Asia/Singapore': 'Singapore (Asia/Singapore)',
  'Asia/Hong_Kong': 'Hong Kong (Asia/Hong_Kong)',
  'Asia/Tokyo': 'Tokyo (Asia/Tokyo)',
  'Australia/Sydney': 'Sydney (Australia/Sydney)',
  'Australia/Melbourne': 'Melbourne (Australia/Melbourne)',
  'Pacific/Auckland': 'Auckland (Pacific/Auckland)',
  'Africa/Johannesburg': 'Johannesburg (Africa/Johannesburg)',
  'Africa/Lagos': 'Lagos (Africa/Lagos)',
  'Etc/UTC': 'UTC (Etc/UTC)',
};

function getSupportedTimezones(): string[] {
  if (typeof Intl.supportedValuesOf === 'function') {
    const values = Intl.supportedValuesOf('timeZone');
    return Array.from(new Set([...PRIORITY_TIMEZONES, ...values]));
  }

  return PRIORITY_TIMEZONES;
}

const ALL_TIMEZONES = getSupportedTimezones();
const PRIORITY_INDEX = new Map(PRIORITY_TIMEZONES.map((timezone, index) => [timezone, index]));

function buildSearchText(timezone: string): string {
  return `${timezone} ${PRIORITY_LABELS[timezone] ?? ''}`
    .toLowerCase()
    .replaceAll('_', ' ')
    .replaceAll('/', ' ');
}

function buildChoiceName(timezone: string): string {
  return PRIORITY_LABELS[timezone] ?? timezone;
}

function getPriorityRank(timezone: string): number {
  return PRIORITY_INDEX.get(timezone) ?? Number.MAX_SAFE_INTEGER;
}

function scoreTimezone(timezone: string, normalizedQuery: string): [number, number, number, string] {
  const searchText = buildSearchText(timezone);
  const citySegment = timezone.split('/').at(-1)?.replaceAll('_', ' ').toLowerCase() ?? timezone.toLowerCase();
  const exactMatch = searchText === normalizedQuery ? 0 : 1;
  const prefixMatch = searchText.startsWith(normalizedQuery) || citySegment.startsWith(normalizedQuery) ? 0 : 1;
  return [exactMatch, prefixMatch, getPriorityRank(timezone), timezone];
}

export function getTimezoneAutocompleteChoices(
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase().replaceAll('_', ' ');

  const matchingTimezones = ALL_TIMEZONES.filter((timezone) => {
    if (!normalizedQuery) {
      return true;
    }

    return buildSearchText(timezone).includes(normalizedQuery);
  });

  const sorted = matchingTimezones.sort((left, right) => {
    const leftScore = scoreTimezone(left, normalizedQuery);
    const rightScore = scoreTimezone(right, normalizedQuery);

    if (leftScore[0] !== rightScore[0]) {
      return leftScore[0] < rightScore[0] ? -1 : 1;
    }

    if (leftScore[1] !== rightScore[1]) {
      return leftScore[1] < rightScore[1] ? -1 : 1;
    }

    if (leftScore[2] !== rightScore[2]) {
      return leftScore[2] < rightScore[2] ? -1 : 1;
    }

    return leftScore[3].localeCompare(rightScore[3]);
  });

  return sorted.slice(0, MAX_AUTOCOMPLETE_CHOICES).map((timezone) => ({
    name: buildChoiceName(timezone),
    value: timezone,
  }));
}
