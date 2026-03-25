'use client';

import { Info } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

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

export type SectionMenuItem<T extends string = string> = {
  id: T;
  label: string;
  description?: string;
  info?: string;
};

export function InfoButton({ label }: { label: string }) {
  const tooltipId = useId();
  const [open, setOpen] = useState(false);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? tooltipId : undefined}
        className="inline-flex size-7 items-center justify-center rounded-full border border-border/70 bg-background/70 text-muted-foreground transition hover:border-primary/35 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
        onClick={() => setOpen((current) => !current)}
        onBlur={() => setOpen(false)}
      >
        <Info className="size-3.5" />
      </button>
      {open ? (
        <span
          id={tooltipId}
          role="tooltip"
          className="absolute right-0 top-full z-30 mt-2 w-64 rounded-[1rem] border border-border/70 bg-card/95 px-3 py-2 text-xs leading-5 text-muted-foreground shadow-[0_18px_40px_-24px_rgba(0,0,0,0.7)] backdrop-blur"
        >
          {label}
        </span>
      ) : null}
    </span>
  );
}

export function SectionMenu<T extends string>({
  title,
  items,
  activeId,
  onChange,
}: {
  title: string;
  items: readonly SectionMenuItem<T>[];
  activeId: T;
  onChange: (id: T) => void;
}) {
  return (
    <aside className="rounded-[1.6rem] border border-border/70 bg-card/85 p-4 shadow-[0_18px_50px_-28px_rgba(0,0,0,0.55)] backdrop-blur">
      <div className="space-y-1 border-b border-border/70 pb-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">
          Switch between focused configuration steps without crowding the page.
        </p>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
        {items.map((item) => {
          const active = item.id === activeId;

          return (
            <div
              key={item.id}
              className={cn(
                'flex min-h-12 items-start justify-between gap-3 rounded-[1.2rem] border px-4 py-3 transition',
                active
                  ? 'border-primary/45 bg-primary/10 shadow-[0_14px_34px_-24px_rgba(56,189,248,0.8)]'
                  : 'border-border/70 bg-background/70 hover:border-primary/25 hover:bg-background/85',
              )}
            >
              <button
                type="button"
                onClick={() => onChange(item.id)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block font-medium text-foreground">{item.label}</span>
                {item.description ? (
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">{item.description}</span>
                ) : null}
              </button>
              {item.info ? <InfoButton label={item.info} /> : null}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

export function Panel({
  title,
  description,
  action,
  children,
  className,
}: {
  title: ReactNode;
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
