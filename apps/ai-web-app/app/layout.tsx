import type { Metadata } from 'next';
import { Inter, Manrope } from 'next/font/google';
import type { ReactNode } from 'react';

import { AI_APP_BRAND } from '@/lib/ai-design-tokens';

import './globals.css';

const bodyFont = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
});

const displayFont = Manrope({
  subsets: ['latin'],
  variable: '--font-display',
});

export const metadata: Metadata = {
  title: `${AI_APP_BRAND.name} Control Panel`,
  description: AI_APP_BRAND.tagline,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        className={`${bodyFont.variable} ${displayFont.variable} min-h-screen bg-background font-sans text-foreground antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
