'use client';
import { useState } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex min-h-screen">
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed(!collapsed)}
      />
      <div
        className={`flex-1 flex flex-col min-w-0 transition-[margin] duration-300 ease-out ${
          collapsed ? 'ml-16' : 'ml-56'
        }`}
      >
        <Header
          onToggleSidebar={() => setCollapsed(!collapsed)}
        />
        <main className="flex-1 px-6 py-6">
          {children}
        </main>
      </div>
    </div>
  );
}
