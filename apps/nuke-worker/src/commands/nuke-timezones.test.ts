import { describe, expect, it } from 'vitest';

import { getTimezoneAutocompleteChoices } from './nuke-timezones.js';

describe('nuke timezone autocomplete', () => {
  it('pins Europe/London to the top when no query is provided', () => {
    const choices = getTimezoneAutocompleteChoices('');

    expect(choices[0]).toEqual({
      name: 'London (Europe/London)',
      value: 'Europe/London',
    });
    expect(choices).toHaveLength(25);
  });

  it('keeps Europe/London at the top when the query matches london', () => {
    const choices = getTimezoneAutocompleteChoices('london');

    expect(choices[0]).toEqual({
      name: 'London (Europe/London)',
      value: 'Europe/London',
    });
  });

  it('filters the list by the typed query', () => {
    const choices = getTimezoneAutocompleteChoices('tokyo');

    expect(choices.length).toBeGreaterThan(0);
    expect(choices.every((choice) => choice.value.toLowerCase().includes('tokyo'))).toBe(true);
  });
});
