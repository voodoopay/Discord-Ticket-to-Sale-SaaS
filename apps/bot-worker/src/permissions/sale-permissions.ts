import { PermissionFlagsBits, type GuildMember } from 'discord.js';

export function hasConfiguredStaffAccess(input: {
  configuredRoleIds: string[];
  hasManageGuild: boolean;
  hasAdministrator: boolean;
  memberRoleIds: string[];
}): boolean {
  if (input.hasManageGuild || input.hasAdministrator) {
    return true;
  }

  if (input.configuredRoleIds.length === 0) {
    return false;
  }

  return input.memberRoleIds.some((roleId) => input.configuredRoleIds.includes(roleId));
}

export function canStartSale(member: GuildMember, configuredRoleIds: string[]): boolean {
  return hasConfiguredStaffAccess({
    configuredRoleIds,
    hasManageGuild: member.permissions.has(PermissionFlagsBits.ManageGuild),
    hasAdministrator: member.permissions.has(PermissionFlagsBits.Administrator),
    memberRoleIds: [...member.roles.cache.keys()],
  });
}
