import {
  ArrowRight,
  Bot,
  BrainCircuit,
  Gauge,
  LockKeyhole,
  MessagesSquare,
  Orbit,
  ShieldCheck,
  Sparkles,
  Waypoints,
} from 'lucide-react';
import Link from 'next/link';

import {
  AI_APP_BRAND,
  aiDashboardSections,
  aiHeroSignals,
  aiLaunchMetrics,
  aiReadinessPillars,
} from '@/lib/ai-design-tokens';
import { getAiDashboardSessionData } from '@/lib/ai-session';
import { AiControlPlane } from '@/components/ai-control-plane';

const sectionIcons = {
  overview: Gauge,
  'reply-behavior': MessagesSquare,
  knowledge: Waypoints,
  personality: BrainCircuit,
  diagnostics: ShieldCheck,
} as const;

function GuildAvatar({
  name,
  iconUrl,
}: {
  name: string;
  iconUrl: string | null;
}) {
  if (iconUrl) {
    return <img src={iconUrl} alt="" className="size-12 rounded-2xl object-cover" />;
  }

  return (
    <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-primary/12 font-semibold text-primary">
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

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
    <main className="relative min-h-screen overflow-x-hidden pb-24 lg:pb-10">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-[32rem] bg-[radial-gradient(circle_at_top_left,rgba(67,97,238,0.24),transparent_42%),radial-gradient(circle_at_88%_8%,rgba(91,213,252,0.28),transparent_24%)]" />
        <div className="ai-grid-weave absolute inset-x-4 top-28 h-56 rounded-[2.2rem] opacity-35 blur-[1px] sm:inset-x-8 lg:left-auto lg:right-10 lg:w-[32rem]" />
      </div>

      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <header className="ai-panel rounded-[1.9rem] px-4 py-4 sm:px-5 lg:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <Link href="/dashboard" className="flex items-center gap-3 rounded-full focus-visible:outline-2">
              <span className="ai-gradient-signal relative inline-flex size-12 items-center justify-center overflow-hidden rounded-[1.35rem] text-primary-foreground">
                <span className="ai-orb absolute inset-0" />
                <Orbit className="relative size-5" />
              </span>
              <div>
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.32em] text-muted-foreground">
                  {AI_APP_BRAND.eyebrow}
                </p>
                <h1 className="font-[family-name:var(--font-display)] text-xl font-extrabold tracking-[-0.04em] text-foreground sm:text-2xl">
                  {AI_APP_BRAND.name}
                </h1>
              </div>
            </Link>

            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="rounded-full bg-primary/[0.08] px-3 py-1.5 text-primary">
                Standalone app
              </span>
              <span className="rounded-full bg-white/70 px-3 py-1.5">
                Port 3100
              </span>
              {sessionData ? (
                <span className="rounded-full bg-accent/60 px-3 py-1.5 text-accent-foreground">
                  Discord user {sessionData.me.discordUserId}
                </span>
              ) : null}
            </div>
          </div>
        </header>

        {authError ? (
          <section className="rounded-[1.6rem] bg-[rgb(255_218_214_/_0.7)] px-4 py-3 text-sm text-destructive shadow-[0_10px_30px_rgb(186_26_26_/_0.08)] sm:px-5">
            {authError}
          </section>
        ) : null}

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_24rem]">
          <div className="ai-gradient-signal overflow-hidden rounded-[2rem] px-5 py-5 text-primary-foreground sm:px-6 sm:py-6">
            <div className="flex flex-col gap-6">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-3">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-primary-foreground/70">
                    {AI_APP_BRAND.shellLabel}
                  </p>
                  <div className="space-y-2">
                    <h2 className="max-w-[12ch] font-[family-name:var(--font-display)] text-3xl font-extrabold tracking-[-0.05em] sm:text-4xl">
                      Grounded control without the clutter.
                    </h2>
                    <p className="max-w-xl text-sm leading-7 text-primary-foreground/84 sm:text-[0.95rem]">
                      {AI_APP_BRAND.tagline} The dashboard shell is live now, with data-dense sections
                      reserved for the next API passes.
                    </p>
                  </div>
                </div>

                <div className="relative hidden size-24 shrink-0 items-center justify-center rounded-[1.8rem] border border-white/16 bg-white/12 backdrop-blur-md sm:flex">
                  <span className="ai-pulse-ring absolute size-16 rounded-full bg-white/22" />
                  <Bot className="relative size-9" />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {aiLaunchMetrics.map((metric) => (
                  <article
                    key={metric.label}
                    className="rounded-[1.4rem] border border-white/10 bg-white/10 px-4 py-4 backdrop-blur-md"
                  >
                    <p className="text-[0.72rem] uppercase tracking-[0.26em] text-primary-foreground/62">
                      {metric.label}
                    </p>
                    <p className="mt-2 font-[family-name:var(--font-display)] text-xl font-bold tracking-[-0.04em]">
                      {sessionData && metric.label === 'Accessible guilds'
                        ? String(sessionData.discordGuilds.length)
                        : metric.value}
                    </p>
                  </article>
                ))}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                {sessionData ? (
                  <a
                    href="#guild-access"
                    className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-primary transition hover:-translate-y-0.5 hover:brightness-105 focus-visible:outline-2"
                  >
                    Review guild access
                    <ArrowRight className="size-4" />
                  </a>
                ) : (
                  <a
                    href="/api/auth/discord/login"
                    className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-primary transition hover:-translate-y-0.5 hover:brightness-105 focus-visible:outline-2"
                  >
                    {AI_APP_BRAND.loginLabel}
                    <ArrowRight className="size-4" />
                  </a>
                )}
                <div className="flex flex-wrap gap-2">
                  {aiHeroSignals.map((signal) => (
                    <span
                      key={signal}
                      className="inline-flex min-h-11 items-center rounded-full border border-white/12 px-4 text-xs font-medium uppercase tracking-[0.18em] text-primary-foreground/76"
                    >
                      {signal}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <aside className="ai-panel rounded-[2rem] px-4 py-5 sm:px-5">
            <div className="space-y-4">
              <div>
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.26em] text-muted-foreground">
                  Launch posture
                </p>
                <h3 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-extrabold tracking-[-0.05em] text-foreground">
                  Atmospheric, dense, and mobile-first.
                </h3>
              </div>
              <div className="space-y-3">
                {aiReadinessPillars.map((pillar) => (
                  <article key={pillar.title} className="ai-soft-surface rounded-[1.5rem] px-4 py-4">
                    <p className="text-sm font-semibold text-foreground">{pillar.title}</p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{pillar.detail}</p>
                  </article>
                ))}
              </div>
            </div>
          </aside>
        </section>

        {sessionData ? (
          <AiControlPlane
            guilds={sessionData.discordGuilds}
            initialGuildId={initialGuildId}
          />
        ) : (
          <section className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_22rem]">
            <article className="ai-panel rounded-[2rem] px-5 py-5 sm:px-6 sm:py-6">
              <div className="max-w-2xl space-y-5">
                <span className="inline-flex size-14 items-center justify-center rounded-[1.5rem] bg-primary/[0.08] text-primary">
                  <LockKeyhole className="size-6" />
                </span>
                <div className="space-y-3">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.26em] text-muted-foreground">
                    Discord authentication
                  </p>
                  <h2 className="font-[family-name:var(--font-display)] text-3xl font-extrabold tracking-[-0.05em] text-foreground sm:text-4xl">
                    Authenticate once, then manage only the servers you can actually control.
                  </h2>
                  <p className="text-sm leading-7 text-muted-foreground sm:text-[0.96rem]">
                    This shell intentionally stops at entry, session, and design-system foundation. Guild
                    settings APIs and full module workflows arrive in the next task set.
                  </p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <a
                    href="/api/auth/discord/login"
                    className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:-translate-y-0.5 hover:bg-secondary focus-visible:outline-2"
                  >
                    {AI_APP_BRAND.loginLabel}
                    <ArrowRight className="size-4" />
                  </a>
                  <Link
                    href="#shell-preview"
                    className="inline-flex min-h-12 cursor-pointer items-center justify-center rounded-full bg-muted px-5 text-sm font-semibold text-foreground transition hover:bg-white focus-visible:outline-2"
                  >
                    Review the shell
                  </Link>
                </div>
              </div>
            </article>

            <aside className="ai-panel rounded-[2rem] px-5 py-5">
              <div className="space-y-3">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.26em] text-muted-foreground">
                  Access model
                </p>
                <div className="space-y-3">
                  {[
                    'Session cookie created through the existing AuthService exchange.',
                    'Discord access token stored separately for live guild discovery.',
                    'Guild chooser filtered down to owner and admin scope only.',
                  ].map((line) => (
                    <article key={line} className="ai-soft-surface rounded-[1.4rem] px-4 py-4 text-sm leading-6 text-muted-foreground">
                      {line}
                    </article>
                  ))}
                </div>
              </div>
            </aside>
          </section>
        )}

        <section id="guild-access" className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_24rem]">
          <article id="shell-preview" className="ai-panel rounded-[2rem] px-5 py-5 sm:px-6 sm:py-6">
            <div className="space-y-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.26em] text-muted-foreground">
                    Dashboard preview
                  </p>
                  <h2 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-extrabold tracking-[-0.05em] text-foreground">
                    {sessionData ? 'Guild entry shell is ready.' : 'Five panel lanes are staged.'}
                  </h2>
                </div>
                <span className="inline-flex items-center gap-2 rounded-full bg-primary/[0.08] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                  <Sparkles className="size-4" />
                  Task 6 scope
                </span>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                {aiDashboardSections.map((section) => {
                  const Icon = sectionIcons[section.id];

                  return (
                    <article
                      key={section.id}
                      id={sessionData ? undefined : section.id}
                      className="ai-soft-surface rounded-[1.5rem] px-4 py-4"
                    >
                      <span className="inline-flex size-10 items-center justify-center rounded-[1rem] bg-white text-primary shadow-[0_8px_24px_rgb(35_70_213_/_0.08)]">
                        <Icon className="size-4" />
                      </span>
                      <p className="mt-4 text-sm font-semibold text-foreground">{section.title}</p>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{section.detail}</p>
                    </article>
                  );
                })}
              </div>
            </div>
          </article>

          <aside className="ai-panel rounded-[2rem] px-5 py-5">
            <div className="space-y-4">
              <div>
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.26em] text-muted-foreground">
                  Guild access
                </p>
                <h3 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-extrabold tracking-[-0.05em] text-foreground">
                  {sessionData ? 'Eligible servers' : 'Sign in to load servers'}
                </h3>
              </div>

              {sessionData ? (
                sessionData.discordGuilds.length > 0 ? (
                  <div className="space-y-3">
                    {sessionData.discordGuilds.map((guild) => (
                      <article
                        key={guild.id}
                        className="ai-soft-surface flex items-center gap-3 rounded-[1.5rem] px-4 py-4"
                      >
                        <GuildAvatar name={guild.name} iconUrl={guild.iconUrl} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-foreground">{guild.name}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                            {guild.owner ? 'Owner' : 'Administrator'}
                          </p>
                        </div>
                        <span className="rounded-full bg-white px-3 py-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-primary">
                          Ready
                        </span>
                      </article>
                    ))}
                  </div>
                ) : (
                  <article className="ai-soft-surface rounded-[1.5rem] px-4 py-4 text-sm leading-7 text-muted-foreground">
                    This Discord account authenticated successfully, but it does not currently own or
                    administer any guilds available to the panel.
                  </article>
                )
              ) : (
                <article className="ai-soft-surface rounded-[1.5rem] px-4 py-4 text-sm leading-7 text-muted-foreground">
                  OAuth is wired. Login will set the session token and Discord access token cookies, then
                  return here with the filtered guild list.
                </article>
              )}

              {sessionData?.discordGuildsError ? (
                <article className="rounded-[1.4rem] bg-[rgb(222_225_255_/_0.7)] px-4 py-4 text-sm leading-6 text-primary">
                  {sessionData.discordGuildsError}
                </article>
              ) : null}
            </div>
          </aside>
        </section>
      </div>

      <nav className="ai-panel fixed inset-x-4 bottom-4 z-40 grid grid-cols-5 rounded-[1.8rem] px-2 py-2 lg:hidden">
        {aiDashboardSections.map((section) => {
          const Icon = sectionIcons[section.id];

          return (
            <a
              key={section.id}
              href={`#${section.id}`}
              className="flex min-h-14 cursor-pointer flex-col items-center justify-center gap-1 rounded-[1.2rem] text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground transition hover:bg-primary/[0.08] hover:text-primary focus-visible:outline-2"
            >
              <Icon className="size-4" />
              {section.title}
            </a>
          );
        })}
      </nav>
    </main>
  );
}
