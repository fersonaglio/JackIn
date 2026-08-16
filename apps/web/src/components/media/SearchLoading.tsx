'use client';
import { motion } from 'framer-motion';

export default function SearchLoading({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 space-y-10">
      <div className="relative w-16 h-16">
        <motion.span
          className="absolute inset-0 rounded-full border-2 border-[#EF9F27]/30"
          animate={{ scale: [1, 1.7], opacity: [0.6, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
        />
        <motion.span
          className="absolute inset-0 rounded-full border-2 border-[#EF9F27]/30"
          animate={{ scale: [1, 1.7], opacity: [0.6, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut', delay: 0.4 }}
        />
        <motion.span
          className="absolute inset-0 flex items-center justify-center text-3xl"
          animate={{ rotate: [0, 20, -20, 0] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        >
          🔍
        </motion.span>
      </div>

      <div className="text-center space-y-1.5">
        <p className="text-zinc-300 text-sm font-bold">
          Buscando <span className="text-[#EF9F27] font-black">“{query}”</span>
        </p>
        <p className="text-zinc-500 text-xs font-medium animate-pulse">
          Procurando em todas as fontes P2P por relevância...
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 w-full max-w-6xl">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => (
          <div key={i} className="space-y-2">
            <div className="aspect-[2/3] rounded-lg bg-zinc-900 overflow-hidden">
              <motion.div
                className="w-full h-full"
                animate={{ x: ['-100%', '100%'] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut', delay: (i % 6) * 0.12 }}
              >
                <div className="w-full h-full bg-gradient-to-r from-transparent via-zinc-800/60 to-transparent" />
              </motion.div>
            </div>
            <div className="h-3 w-3/4 rounded bg-zinc-900" />
            <div className="h-2 w-1/2 rounded bg-zinc-900" />
          </div>
        ))}
      </div>
    </div>
  );
}
