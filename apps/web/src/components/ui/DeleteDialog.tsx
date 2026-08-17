'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

export default function DeleteDialog({
  open,
  title,
  onConfirm,
  onCancel,
  customTitle,
  customMessage,
}: {
  open: boolean;
  title: string;
  pendingCount?: number;
  postedCount?: number;
  cutsCount?: number;
  onConfirm: () => void;
  onCancel: () => void;
  customTitle?: string;
  customMessage?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const content = (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[110] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onCancel} />
          <motion.div
            className="relative bg-zinc-900 border border-zinc-800 rounded-xl p-6 max-w-sm mx-4 w-full"
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.2, ease: [0.25, 1, 0.5, 1] }}
          >
            <h3 className="text-zinc-100 font-semibold text-base mb-2">
              {customTitle || "Excluir projeto"}
            </h3>
            <p className="text-zinc-400 text-sm font-light leading-relaxed mb-4">
              {customMessage || (
                <>
                  Tem certeza que deseja excluir <span className="text-zinc-300 font-medium">{title}</span>? Esta ação não pode ser desfeita.
                </>
              )}
            </p>

            <div className="flex items-center justify-end gap-3">
              <motion.button
                onClick={onCancel}
                className="px-4 py-2 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                whileTap={{ scale: 0.97 }}
              >
                Cancelar
              </motion.button>
              <motion.button
                onClick={onConfirm}
                className="px-5 py-2 rounded-lg text-sm font-medium bg-red-500/10 text-red-400 border border-red-900/40 hover:bg-red-500/20 transition-colors"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
              >
                Excluir
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(content, document.body);
}
