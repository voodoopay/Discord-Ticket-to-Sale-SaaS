import type { Metadata } from 'next';
import { Manrope, Sora } from 'next/font/google';
import type { ReactNode } from 'react';

import { ThemeProvider } from '@/components/theme-provider';

import './globals.css';

const bodyFont = Manrope({
  subsets: ['latin'],
  variable: '--font-sans',
});

const displayFont = Sora({
  subsets: ['latin'],
  variable: '--font-display',
});

export const metadata: Metadata = {
  title: 'Voodoo SaaS Dashboard',
  description: 'Multi-tenant Discord ticket-to-sale control panel',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${bodyFont.variable} ${displayFont.variable} min-h-screen bg-background font-sans text-foreground antialiased`}
      >
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
