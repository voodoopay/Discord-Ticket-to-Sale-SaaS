import { ArrowRight, LockKeyhole, Sparkles } from 'lucide-react';
import Link from 'next/link';

import { DashboardLaunchpad } from '@/components/dashboard/dashboard-launchpad';
import { ModeToggle } from '@/components/mode-toggle';
import { Button } from '@/components/ui/button';
import { getDashboardSessionData } from '@/lib/dashboard-session';

export default async function DashboardEntryPage() {
  const sessionData = await getDashboardSessionData();

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(48rem_28rem_at_10%_0%,rgba(56,189,248,0.2),transparent),radial-gradient(34rem_24rem_at_90%_10%,rgba(74,222,128,0.18),transparent),radial-gradient(46rem_30rem_at_50%_115%,rgba(249,115,22,0.18),transparent)]" />

      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3">
            <span className="inline-flex size-11 items-center justify-center rounded-[1.2rem] border border-primary/30 bg-primary/12 text-primary">
              <Sparkles className="size-5" />
            </span>
            <div>
              <p className="font-[family-name:var(--font-display)] text-lg tracking-tight">Voodoo Pay</p>
              <p className="text-sm text-muted-foreground">Dashboard launchpad</p>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" className="min-h-10">
              <a href="https://voodoopay.online/" target="_blank" rel="noreferrer">
                Main Website
              </a>
            </Button>
            <ModeToggle />
          </div>
        </div>

        {sessionData ? (
          <DashboardLaunchpad data={sessionData} />
        ) : (
          <section className="mx-auto w-full max-w-3xl rounded-[2rem] border border-border/70 bg-card/85 p-7 shadow-[0_28px_80px_-36px_rgba(0,0,0,0.6)] backdrop-blur sm:p-9">
            <div className="flex flex-col gap-5">
              <span className="inline-flex size-14 items-center justify-center rounded-[1.35rem] border border-primary/30 bg-primary/12 text-primary">
                <LockKeyhole className="size-6" />
              </span>
              <div className="space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Authentication
                </p>
                <h1 className="font-[family-name:var(--font-display)] text-3xl tracking-tight sm:text-4xl">
                  Login with Discord to open the merchant panel.
                </h1>
                <p className="text-sm leading-7 text-muted-foreground sm:text-base">
                  After login you will choose the workspace and Discord server, then continue into the
                  main dashboard with sidebar navigation for settings, payments, coupons, points,
                  referrals, and products.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className="min-h-12 sm:flex-1">
                  <a href="/api/auth/discord/login">
                    Login with Discord
                    <ArrowRight className="size-4" />
                  </a>
                </Button>
                <Button asChild size="lg" variant="outline" className="min-h-12 sm:flex-1">
                  <Link href="/">Back to Home</Link>
                </Button>
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
