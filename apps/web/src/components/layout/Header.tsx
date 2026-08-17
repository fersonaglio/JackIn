'use client';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';

const navItems = [
  { label: 'Início', path: '/media' },
  { label: 'Filmes', path: '/filmes' },
  { label: 'Séries', path: '/series' },
  { label: 'Buscar', path: '/search' },
];

export default function Header() {
  const pathname = usePathname();

  return (
    <motion.header
      className="sticky top-0 z-50 bg-[#09090B]/90 backdrop-blur-xl border-b border-zinc-800/60 px-4 sm:px-8 h-16 flex items-center justify-between transition-colors"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      <div className="flex items-center gap-8">
        {/* Logo */}
        <Link
          href="/media"
          className="flex items-center gap-2 group transition-transform duration-200 hover:scale-105"
        >
          <span className="text-xl font-black tracking-widest uppercase">
            <span className="text-[#E50914]">Jack</span>
            <span className="text-white">In</span>
          </span>
        </Link>

        {/* Navigation Links */}
        <nav className="flex items-center gap-1 sm:gap-2">
          {navItems.map((item) => {
            const isActive =
              pathname === item.path ||
              (item.path === '/media' && (pathname === '/' || pathname === '/media'));

            return (
              <Link
                key={item.path}
                href={item.path}
                className={`relative px-3 py-1.5 rounded-md text-sm font-semibold transition-all duration-200 ${
                  isActive
                    ? 'text-white bg-zinc-800/80 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/40'
                }`}
              >
                {item.label}
                {isActive && (
                  <motion.div
                    layoutId="activeNavIndicator"
                    className="absolute bottom-0 left-2 right-2 h-[2px] bg-[#E50914] rounded-full"
                    transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                  />
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Right side accessories */}
      <div className="flex items-center gap-3">
        <Link
          href="/search"
          className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition-colors"
          title="Buscar filmes e séries"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        </Link>
        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-[11px] font-bold text-zinc-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[#EF9F27] font-mono">4K P2P</span>
        </div>
      </div>
    </motion.header>
  );
}
