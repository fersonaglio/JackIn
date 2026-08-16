'use client';
import { motion } from 'framer-motion';

export default function Header({
  onToggleSidebar,
}: {
  onToggleSidebar: () => void;
}) {
  return (
    <motion.header
      className="sticky top-0 z-30 bg-[#09090B]/80 backdrop-blur-md border-b border-zinc-800/60 px-6 h-14 flex items-center justify-between"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      <div className="flex items-center gap-4">
        <motion.button
          onClick={onToggleSidebar}
          className="text-zinc-500 hover:text-zinc-300 transition-colors p-1 rounded-md hover:bg-zinc-800/50"
          whileTap={{ scale: 0.9 }}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </motion.button>
        <span className="text-sm font-medium text-zinc-300">Minha Biblioteca</span>
      </div>

      <div className="flex items-center gap-4">
        <span className="text-[10px] font-black tracking-widest uppercase text-zinc-500 hidden sm:block">
          <span className="text-[#E50914]">Jack</span>
          <span className="text-zinc-300">In</span>
          <span className="text-[#EF9F27] ml-1 font-mono font-bold">4K</span>
        </span>
      </div>
    </motion.header>
  );
}
