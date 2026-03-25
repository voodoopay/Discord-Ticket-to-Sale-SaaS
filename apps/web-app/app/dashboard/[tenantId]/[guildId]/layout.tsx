import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';

import { DashboardProvider } from '@/components/dashboard/dashboard-provider';
import { DashboardShell } from '@/components/dashboard/dashboard-shell';
import { getDashboardSessionData } from '@/lib/dashboard-session';

export default async function GuildDashboardLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ tenantId: string; guildId: string }>;
}) {
  const sessionData = await getDashboardSessionData();
  if (!sessionData) {
    redirect('/dashboard');
  }

  const { tenantId, guildId } = await params;
  const tenant = sessionData.tenants.find((entry) => entry.id === tenantId);
  const guild = sessionData.discordGuilds.find((entry) => entry.id === guildId);

  if (!tenant || !guild) {
    redirect('/dashboard');
  }

  return (
    <DashboardProvider
      tenantId={tenant.id}
      tenantName={tenant.name}
      guildId={guild.id}
      guildName={guild.name}
    >
      <DashboardShell tenantId={tenant.id} tenantName={tenant.name} guildId={guild.id} guildName={guild.name}>
        {children}
      </DashboardShell>
    </DashboardProvider>
  );
}
