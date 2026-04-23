import type { Metadata } from 'next';
import { Fira_Code, Fira_Sans } from 'next/font/google';
import type { ReactNode } from 'react';

import { AI_APP_BRAND } from '@/lib/ai-design-tokens';
import { TooltipProvider } from '@/components/ui/tooltip';

import './globals.css';

const bodyFont = Fira_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['300', '400', '500', '600', '700'],
});

const monoFont = Fira_Code({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: `${AI_APP_BRAND.name} Control Panel`,
  description: AI_APP_BRAND.tagline,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        className={`${bodyFont.variable} ${monoFont.variable} min-h-screen bg-background font-sans text-foreground antialiased`}
      >
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
