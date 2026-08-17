'use client';
import { useRouter, usePathname } from 'next/navigation';
import { motion } from 'framer-motion';

interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: React.ReactNode;
  disabled?: boolean;
  customLabel?: React.ReactNode;
}

const navItems: NavItem[] = [
  {
    id: 'home',
    label: 'Início',
    path: '/',
    icon: (
      <svg className="w-5 h-5 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3 origin-center" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
      </svg>
    ),
  },
  {
    id: 'media',
    label: 'Mídia',
    path: '/media',
    icon: (
      <svg className="w-5 h-5 text-[#E50914] transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6 origin-center" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25c.621 0 1.125-.504 1.125-1.125v-9.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v9.75c0 .621.504 1.125 1.125 1.125z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 7.5L7.5 3h3L6.375 7.5h-3zM10.5 7.5L14.625 3h3L13.5 7.5h-3zM17.625 7.5L21.75 3h.375c.621 0 1.125.504 1.125 1.125v3.375h-5.625z" />
        <polygon points="10 11.5 15 14 10 16.5 10 11.5" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    id: 'filmes',
    label: 'Filmes',
    path: '/filmes',
    icon: (
      <svg className="w-5 h-5 transition-transform duration-300 group-hover:scale-110 origin-center" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h.01M7 12h.01M7 16h.01M17 8h.01M17 12h.01M17 16h.01M10 12l4-2v4l-4-2z" />
      </svg>
    ),
  },
  {
    id: 'series',
    label: 'Séries',
    path: '/series',
    icon: (
      <svg className="w-5 h-5 transition-transform duration-300 group-hover:scale-110 origin-center" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <rect x="2" y="5" width="20" height="12" rx="2" ry="2" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 20h8" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 17v3" />
      </svg>
    ),
  },
  {
    id: 'search',
    label: 'Buscar',
    path: '/search',
    icon: (
      <svg className="w-5 h-5 transition-transform duration-300 group-hover:scale-110 origin-center" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
      </svg>
    ),
  },
];

export default function Sidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <motion.aside
      className="fixed left-0 top-0 h-screen z-40 bg-zinc-950/90 backdrop-blur-xl border-r border-zinc-800/60 flex flex-col"
      animate={{ width: collapsed ? 64 : 224 }}
      initial={{ width: 224 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      {/* Logo */}
      <div className="flex items-center justify-center h-14 px-4 border-b border-zinc-800/60 shrink-0">
        {!collapsed ? (
          <motion.button
            onClick={() => router.push('/')}
            className="flex items-center justify-center text-zinc-100 hover:text-white transition-transform hover:scale-105"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <span className="text-lg font-black tracking-wider uppercase">
              <span className="text-[#E50914]">Jack</span>
              <span className="text-white">In</span>
            </span>
          </motion.button>
        ) : (
          <motion.button
            onClick={() => router.push('/')}
            className="flex items-center justify-center text-zinc-100 hover:text-white transition-transform hover:scale-105 mx-auto"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <span className="text-base font-black tracking-wider uppercase">
              <span className="text-[#E50914]">J</span>
              <span className="text-white">I</span>
            </span>
          </motion.button>
        )}
      </div>

      {/* Main navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = !item.disabled && (pathname === item.path || (item.id === 'home' && pathname === '/'));
          return (
            <motion.button
              key={item.id}
              onClick={() => !item.disabled && router.push(item.path)}
              className={`group flex items-center gap-3 w-full rounded-lg transition-colors ${
                collapsed ? 'justify-center px-2 py-3' : 'px-3 py-2.5'
              } ${
                item.disabled
                  ? 'cursor-not-allowed opacity-30 text-zinc-600'
                  : isActive
                  ? 'bg-zinc-800/80 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
              }`}
              whileTap={!item.disabled ? { scale: 0.97 } : {}}
            >
              <span className="shrink-0">{item.icon}</span>
              {!collapsed && (
                <motion.span
                  className="text-xs font-medium truncate"
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  {item.customLabel || item.label}
                </motion.span>
              )}
            </motion.button>
          );
        })}
      </nav>

      {/* Bottom items */}
      <div className="px-3 py-4 border-t border-zinc-800/60 space-y-1">
        {/* Collapse toggle */}
        <motion.button
          onClick={onToggle}
          className={`flex items-center gap-3 w-full rounded-lg transition-colors text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 ${
            collapsed ? 'justify-center px-2 py-3' : 'px-3 py-2.5'
          }`}
          whileTap={{ scale: 0.97 }}
        >
          <motion.span
            className="shrink-0"
            animate={{ rotate: collapsed ? 180 : 0 }}
            transition={{ duration: 0.3 }}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5" />
            </svg>
          </motion.span>
          {!collapsed && (
            <motion.span
              className="text-xs font-medium truncate"
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.15 }}
            >
              Recolher
            </motion.span>
          )}
        </motion.button>
      </div>
    </motion.aside>
  );
}
