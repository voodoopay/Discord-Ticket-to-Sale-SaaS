'use client';

import {
  CreditCard,
  Gift,
  LayoutDashboard,
  Link2,
  Menu,
  Settings2,
  ShoppingBag,
  Sparkles,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import darkModeLogo from '../../../../assets/darkmode-logo.png';
import lightModeLogo from '../../../../assets/lightmode-logo.png';
import { ModeToggle } from '@/components/mode-toggle';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '', label: 'Overview', icon: LayoutDashboard },
  { href: '/settings', label: 'Settings', icon: Settings2 },
  { href: '/payments', label: 'Payments', icon: CreditCard },
  { href: '/coupons', label: 'Coupons', icon: Sparkles },
  { href: '/points', label: 'Points', icon: Gift },
  { href: '/referrals', label: 'Referrals', icon: Link2 },
  { href: '/products', label: 'Products', icon: ShoppingBag },
] as const;

type DashboardShellProps = {
  tenantId: string;
  guildId: string;
  tenantName: string;
  guildName: string;
  children: React.ReactNode;
};

export function DashboardShell({
  tenantId,
  guildId,
  tenantName,
  guildName,
  children,
}: DashboardShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const basePath = `/dashboard/${tenantId}/${guildId}`;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(74,222,128,0.08),transparent_22%),radial-gradient(circle_at_top_right,rgba(56,189,248,0.14),transparent_24%),radial-gradient(circle_at_bottom,rgba(249,115,22,0.1),transparent_28%)]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1500px] flex-col px-4 py-4 sm:px-6 lg:px-8">
        <div className="grid min-h-[calc(100vh-2rem)] gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
          <aside
            className={cn(
              'rounded-[2rem] border border-border/70 bg-card/85 p-4 shadow-[0_24px_70px_-32px_rgba(0,0,0,0.65)] backdrop-blur',
              mobileOpen ? 'block' : 'hidden lg:block',
            )}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border/70 pb-4">
              <Link href="/dashboard" className="flex min-w-0 items-center gap-3">
                <Image src={lightModeLogo} alt="Voodoo Pay" className="h-10 w-auto dark:hidden" priority />
                <Image src={darkModeLogo} alt="Voodoo Pay" className="hidden h-10 w-auto dark:block" priority />
                <div className="min-w-0">
                  <p className="font-[family-name:var(--font-display)] text-sm tracking-[0.18em] text-foreground uppercase">
                    Voodoo Pay
                  </p>
                  <p className="truncate text-xs text-muted-foreground">Merchant control panel</p>
                </div>
              </Link>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="lg:hidden"
                onClick={() => setMobileOpen(false)}
              >
                <Menu className="size-4" />
              </Button>
            </div>

            <div className="mt-4 rounded-[1.5rem] border border-border/70 bg-background/70 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Current Store
              </p>
              <p className="mt-2 font-medium">{tenantName}</p>
              <p className="text-sm text-muted-foreground">{guildName}</p>
            </div>

            <nav className="mt-4 space-y-2">
              {navItems.map((item) => {
                const href = `${basePath}${item.href}`;
                const active = pathname === href;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.label}
                    href={href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      'flex min-h-12 items-center gap-3 rounded-[1.15rem] border px-4 py-3 text-sm font-medium transition',
                      active
                        ? 'border-primary/50 bg-primary/12 text-foreground shadow-[0_16px_34px_-22px_rgba(56,189,248,0.75)]'
                        : 'border-transparent bg-transparent text-muted-foreground hover:border-border/70 hover:bg-background/70 hover:text-foreground',
                    )}
                  >
                    <span
                      className={cn(
                        'inline-flex size-9 items-center justify-center rounded-full border',
                        active
                          ? 'border-primary/35 bg-primary/15 text-primary'
                          : 'border-border/70 bg-background/70 text-muted-foreground',
                      )}
                    >
                      <Icon className="size-4" />
                    </span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>

            <div className="mt-6 rounded-[1.5rem] border border-border/70 bg-secondary/30 p-4">
              <p className="font-[family-name:var(--font-display)] text-sm">Need the live site?</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Open the public Voodoo Pay site or switch stores without losing this session.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button asChild size="sm" className="min-h-10">
                  <a href="https://voodoopay.online/" target="_blank" rel="noreferrer">
                    Visit Website
                  </a>
                </Button>
                <Button asChild size="sm" variant="outline" className="min-h-10">
                  <Link href="/dashboard">Change Server</Link>
                </Button>
              </div>
            </div>
          </aside>

          <div className="min-w-0 rounded-[2rem] border border-border/70 bg-card/65 p-4 shadow-[0_24px_70px_-32px_rgba(0,0,0,0.65)] backdrop-blur sm:p-5">
            <header className="mb-5 flex flex-col gap-4 rounded-[1.65rem] border border-border/70 bg-background/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Dashboard
                </p>
                <h1 className="truncate font-[family-name:var(--font-display)] text-xl sm:text-2xl">
                  {guildName}
                </h1>
                <p className="truncate text-sm text-muted-foreground">{tenantName}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 lg:hidden"
                  onClick={() => setMobileOpen((current) => !current)}
                >
                  <Menu className="size-4" />
                  Menu
                </Button>
                <ModeToggle />
              </div>
            </header>
            <div className="min-w-0">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
