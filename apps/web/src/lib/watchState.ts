// Transições do estado "assistido" de um filme/episódio no player.
// O player salva progresso a cada ~3s; chamar markWatched a cada tick (mesmo
// sem mudança de estado) gera spam de PUT /watched + persist do DB inteiro e,
// pior, desmarca "assistido" quando o usuário só reabre e toca alguns segundos.
// Regra com histerese:
//  - razão >= 0.90  → marcar assistido (o usuário "assistiu").
//  - razão <  0.80  → desmarcar (só quando estava assistido e claramente rever).
//  - entre 0.80 e 0.90 → não muda nada (evita oscilar na fronteira).
export const WATCHED_THRESHOLD = 0.9;
export const UNWATCH_THRESHOLD = 0.8;

export type WatchTransition = true | false | null;

/** Próximo estado de watched a partir da razão assistida e do estado atual. */
export function nextWatchedState(ratio: number, current: boolean): WatchTransition {
  if (ratio >= WATCHED_THRESHOLD && !current) return true;
  if (ratio < UNWATCH_THRESHOLD && current) return false;
  return null;
}
