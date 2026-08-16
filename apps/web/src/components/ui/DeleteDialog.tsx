'use client';
import { motion, AnimatePresence } from 'framer-motion';

export default function DeleteDialog({
  open,
  title,
  pendingCount = 0,
  postedCount = 0,
  cutsCount = 0,
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
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
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

            {/* Alertas sobre o estado de postagem (apenas se não for mensagem customizada) */}
            {!customMessage && (
              <>
                {pendingCount > 0 ? (
                  <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3 mb-6 space-y-1">
                    <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider block">⚠️ Alerta Crítico</span>
                    <p className="text-[11px] text-red-300 font-light leading-relaxed">
                      Este projeto possui <span className="font-bold">{pendingCount} publicação(ões) pendente(s)</span> na fila de envio do JackIn. Se você excluí-lo agora, o upload desses vídeos falhará!
                    </p>
                  </div>
                ) : postedCount > 0 ? (
                  <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3 mb-6 space-y-1">
                    <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider block">✅ Seguro para Excluir</span>
                    <p className="text-[11px] text-emerald-300/90 font-light leading-relaxed">
                      Todos os <span className="font-bold">{postedCount} cortes publicados/agendados</span> já foram enviados ao YouTube de forma definitiva.
                    </p>
                  </div>
                ) : cutsCount > 0 ? (
                  <div className="bg-zinc-800/40 border border-zinc-800 rounded-lg p-3 mb-6 space-y-1">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">ℹ️ Nota</span>
                    <p className="text-[11px] text-zinc-400 font-light leading-relaxed">
                      Nenhum dos <span className="font-bold">{cutsCount} cortes gerados</span> foi publicado ou agendado ainda.
                    </p>
                  </div>
                ) : null}
              </>
            )}
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
}
