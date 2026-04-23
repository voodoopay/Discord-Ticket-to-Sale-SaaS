import { AetherlineDashboard } from '@/components/aetherline-dashboard';
import { getAiDashboardSessionData } from '@/lib/ai-session';

export default async function AiDashboardEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sessionData = await getAiDashboardSessionData();
  const resolvedSearchParams = await searchParams;
  const authErrorParam = resolvedSearchParams.authError;
  const authError = Array.isArray(authErrorParam) ? authErrorParam[0] : authErrorParam;
  const guildIdParam = resolvedSearchParams.guildId;
  const initialGuildId = Array.isArray(guildIdParam) ? (guildIdParam[0] ?? null) : (guildIdParam ?? null);

  return (
    <AetherlineDashboard
      authError={authError}
      initialGuildId={initialGuildId}
      sessionData={sessionData}
    />
  );
}
