import { describe, expect, it } from 'vitest';

import {
  buildJoinGateButtons,
  buildJoinGateEmailModal,
  buildJoinGatePrompt,
  buildJoinGateResendDmButton,
  buildJoinGateStatusMessage,
  lookupFailureMessage,
  parseJoinGateModalCustomId,
  parseJoinGateResendDmCustomId,
  parseJoinGateStartCustomId,
  sanitizeTicketChannelName,
  shortStatusLabel,
} from './join-gate-ui.js';

describe('join gate runtime helpers', () => {
  it('builds stable start button ids for both verification paths', () => {
    const row = buildJoinGateButtons('guild-123');
    const json = row.toJSON();
    const components = json.components as Array<{ custom_id?: string }>;

    expect(components).toHaveLength(2);
    expect(components[0]?.custom_id).toBe('join-gate:start:guild-123:current_customer');
    expect(components[1]?.custom_id).toBe('join-gate:start:guild-123:new_customer');
  });

  it('builds a stable resend-dm button id', () => {
    const row = buildJoinGateResendDmButton('guild-123');
    const json = row.toJSON();
    const components = json.components as Array<{ custom_id?: string }>;

    expect(components).toHaveLength(1);
    expect(components[0]?.custom_id).toBe('join-gate:resend-dm:guild-123');
  });

  it('parses join gate custom ids from button and modal interactions', () => {
    expect(parseJoinGateStartCustomId('join-gate:start:guild-1:current_customer')).toEqual({
      guildId: 'guild-1',
      path: 'current_customer',
    });
    expect(parseJoinGateModalCustomId('join-gate:email:guild-2:new_customer')).toEqual({
      guildId: 'guild-2',
      path: 'new_customer',
    });
    expect(parseJoinGateResendDmCustomId('join-gate:resend-dm:guild-9')).toEqual({
      guildId: 'guild-9',
    });
    expect(parseJoinGateStartCustomId('sale:start:guild-1:current_customer')).toBeNull();
    expect(parseJoinGateModalCustomId('join-gate:email:guild-2:wrong')).toBeNull();
    expect(parseJoinGateResendDmCustomId('join-gate:resend-dm:')).toBeNull();
  });

  it('builds the verification prompt copy for fallback delivery', () => {
    const payload = buildJoinGatePrompt({
      guildId: 'guild-1',
      guildName: 'Voodoo Guild',
      delivery: 'fallback',
      panelTitle: 'Welcome to Voodoo',
      panelMessage: 'Please verify below before you can access the rest of the server.',
    });
    const embed = payload.embeds?.[0]?.toJSON();

    expect(embed?.title).toBe('Welcome to Voodoo');
    expect(embed?.description).toContain('Please verify below before you can access the rest of the server.');
    expect(payload.components).toHaveLength(2);
  });

  it('builds the verification prompt copy for dm delivery', () => {
    const payload = buildJoinGatePrompt({
      guildId: 'guild-1',
      guildName: 'Voodoo Guild',
      delivery: 'dm',
    });
    const embed = payload.embeds?.[0]?.toJSON();

    expect(embed?.description).toContain('Welcome to **Voodoo Guild**.');
  });

  it('builds the email modal for both verification paths', () => {
    const currentModal = buildJoinGateEmailModal('guild-1', 'current_customer').toJSON();
    const newModal = buildJoinGateEmailModal('guild-1', 'new_customer').toJSON();

    expect(currentModal.custom_id).toBe('join-gate:email:guild-1:current_customer');
    expect(currentModal.title).toBe('Current Customer Verification');
    expect(newModal.custom_id).toBe('join-gate:email:guild-1:new_customer');
    expect(newModal.title).toBe('New Customer Verification');
  });

  it('returns the right success and retry labels for both paths', () => {
    expect(shortStatusLabel('current_customer')).toBe('confirmed customer');
    expect(shortStatusLabel('new_customer')).toBe('new customer email confirmed');
    expect(lookupFailureMessage('current_customer')).toBe(
      'No customer email connected to this email address. Try again.',
    );
    expect(lookupFailureMessage('new_customer')).toBe(
      'No referral or email connected to this email address. Try again.',
    );
  });

  it('sanitizes ticket channel names for Discord-friendly output', () => {
    expect(sanitizeTicketChannelName('Fancy User !!!', '01ABCDEF')).toBe('verify-fancy-user-01abcd');
    expect(sanitizeTicketChannelName('***', '!!')).toBe('verify-member-verify');
  });

  it('formats the status message with config and warning sections', () => {
    const content = buildJoinGateStatusMessage({
      config: {
        joinGateEnabled: true,
        joinGateStaffRoleIds: ['role-staff-1', 'role-staff-2'],
        joinGateFallbackChannelId: 'fallback-1',
        joinGateVerifiedRoleId: 'role-1',
        joinGateTicketCategoryId: 'cat-1',
        joinGateCurrentLookupChannelId: 'current-1',
        joinGateNewLookupChannelId: 'new-1',
        joinGatePanelTitle: 'Welcome to Voodoo',
        joinGatePanelMessage: 'Please verify to continue.',
      },
      missingConfig: ['Verified role'],
      runtimeWarnings: ['Missing guild permission: Manage Roles'],
      currentLookupCount: 12,
      newLookupCount: 3,
    });

    expect(content).toContain('Join Gate: Enabled');
    expect(content).toContain('Staff roles: <@&role-staff-1>, <@&role-staff-2>');
    expect(content).toContain('Fallback panel title: "Welcome to Voodoo"');
    expect(content).toContain('Current-customer lookup: <#current-1> (12 indexed email(s))');
    expect(content).toContain('Missing config: Verified role');
    expect(content).toContain('- Missing guild permission: Manage Roles');
  });

  it('formats the status message when no config or runtime warnings are missing', () => {
    const content = buildJoinGateStatusMessage({
      config: {
        joinGateEnabled: false,
        joinGateStaffRoleIds: [],
        joinGateFallbackChannelId: null,
        joinGateVerifiedRoleId: null,
        joinGateTicketCategoryId: null,
        joinGateCurrentLookupChannelId: null,
        joinGateNewLookupChannelId: null,
        joinGatePanelTitle: null,
        joinGatePanelMessage: null,
      },
      missingConfig: [],
      runtimeWarnings: [],
      currentLookupCount: 0,
      newLookupCount: 0,
    });

    expect(content).toContain('Join Gate: Disabled');
    expect(content).toContain('Missing config: none');
    expect(content).toContain('Runtime warnings: none');
  });
});
