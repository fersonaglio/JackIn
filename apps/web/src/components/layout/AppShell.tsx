'use client';
import Header from './Header';

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen bg-[#09090B] text-zinc-100">
      <Header />
      <main className="flex-1 w-full max-w-[1920px] mx-auto">
        {children}
      </main>
    </div>
  );
}
