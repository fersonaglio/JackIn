export interface AltSourceCandidate {
  sourceUrl?: string;
  ptConfirmed?: boolean;
}

/** Magnets alternativos para cascata de fallback no download.
 *
 * Quando o usuário clicou numa opção Dublado (requirePt), o fallback NÃO pode
 * escorregar para uma fonte sem PT (YTS/original) — restringe as alternativas
 * às PT-confirmadas. Sem requirePt, mantém todas (menos a própria fonte).
 */
export function buildAltSourceUrls(
  options: AltSourceCandidate[],
  sourceUrl: string,
  requirePt: boolean,
): string[] {
  return (options ?? [])
    .filter((o) => (requirePt ? o.ptConfirmed === true : true))
    .map((o) => o.sourceUrl)
    .filter((u): u is string => !!u && u !== sourceUrl);
}
