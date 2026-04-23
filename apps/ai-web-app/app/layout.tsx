import type { Metadata } from 'next';
import { Space_Mono, Syncopate } from 'next/font/google';
import type { ReactNode } from 'react';

import { AI_APP_BRAND } from '@/lib/ai-design-tokens';

import './globals.css';

const bodyFont = Space_Mono({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['400', '700'],
});

const displayFont = Syncopate({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400', '700'],
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
