'use client';

import { Info } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

type FeatureToggleProps = {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
};

export function FeatureToggle({ checked, disabled = false, label, onChange }: FeatureToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-11 w-[5.2rem] items-center rounded-full border px-1 transition duration-200',
        checked
          ? 'border-primary/50 bg-primary/15 shadow-[0_0_0_1px_rgba(0,0,0,0.02)]'
          : 'border-border/70 bg-background/70',
        disabled ? 'cursor-not-allowed opacity-50' : 'hover:border-primary/35',
      )}
    >
      <span
        className={cn(
          'inline-flex size-8 items-center justify-center rounded-full text-[11px] font-semibold transition duration-200',
          checked
            ? 'translate-x-[2.05rem] bg-primary text-primary-foreground shadow-lg shadow-primary/30'
            : 'translate-x-0 bg-secondary text-secondary-foreground',
        )}
      >
        {checked ? 'On' : 'Off'}
      </span>
    </button>
  );
}

export function StatusPill({
  active,
  activeLabel,
  inactiveLabel,
}: {
  active: boolean;
  activeLabel: string;
  inactiveLabel: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]',
        active
          ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-200'
          : 'border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-200',
      )}
    >
      {active ? activeLabel : inactiveLabel}
    </span>
  );
}

export function SectionShell({
  eyebrow,
  title,
  description,
  action,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-4 rounded-[1.75rem] border border-border/70 bg-card/80 px-5 py-5 shadow-[0_22px_60px_-28px_rgba(0,0,0,0.5)] backdrop-blur sm:px-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              {eyebrow}
            </p>
            <div className="space-y-1">
              <h1 className="font-[family-name:var(--font-display)] text-2xl tracking-tight sm:text-3xl">
                {title}
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
            </div>
          </div>
          {action ? <div className="flex flex-wrap gap-2">{action}</div> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

export function Panel({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-[1.6rem] border border-border/70 bg-card/85 p-5 shadow-[0_18px_50px_-28px_rgba(0,0,0,0.55)] backdrop-blur',
        className,
      )}
    >
      <div className="flex flex-col gap-3 border-b border-border/70 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-base font-semibold sm:text-lg">{title}</h2>
          {description ? <p className="text-sm leading-6 text-muted-foreground">{description}</p> : null}
        </div>
        {action ? <div className="flex flex-wrap gap-2">{action}</div> : null}
      </div>
      <div className="pt-5">{children}</div>
    </div>
  );
}

export function InfoTip({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-[1.25rem] border border-border/70 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-card/80">
        <Info className="size-4 text-primary" />
      </span>
      <p className="leading-6">{children}</p>
    </div>
  );
}
