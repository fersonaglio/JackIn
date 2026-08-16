import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';
import AppShell from '@/components/layout/AppShell';

export const metadata: Metadata = {
  title: 'JackIn — Cinema P2P',
  description: 'Baixe e assista filmes e séries em 4K via P2P direto da sua biblioteca',
  icons: {
    icon: '/logo.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head suppressHydrationWarning />
      <body className="antialiased min-h-screen bg-[#09090B]" suppressHydrationWarning>
        <Script id="hydration-interceptor" src="/hydration-interceptor.js" strategy="beforeInteractive" />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
