/**
 * Funções puras para montar URLs de mídia do Google Cast (Default Media
 * Receiver). Mantidas fora do hook para serem testáveis sem DOM.
 */

export interface CastAudioTrack {
  trackId: number;
  language: string;
  codec: string;
  channels: number;
  label: string;
}

/**
 * Reaponta o URL de vídeo do player local para o IP da LAN (o Chromecast
 * baixa a mídia direto, localhost não funciona) e força target=h264, que é
 * o único codec suportado pelo receiver padrão do Google. O parâmetro
 * audio não é propagado (o receiver usa activeTrackIds para selecionar).
 */
export function buildCastMediaUrl(videoUrl: string, lanIp: string, port: number): string {
  try {
    const url = new URL(videoUrl);
    url.hostname = lanIp;
    url.port = String(port);
    url.searchParams.set('target', 'h264');
    url.searchParams.delete('audio');
    return url.toString();
  } catch {
    console.warn('[Cast] videoUrl não é URL absoluta, retornando sem alteração:', videoUrl);
    return videoUrl;
  }
}

/** URL das legendas WebVTT servidas pelo servidor local, acessível ao Chromecast. */
export function buildCastTrackUrl(lanIp: string, port: number, projectId: string, lang: string): string {
  return `http://${lanIp}:${port}/api/projects/${projectId}/subtitles?lang=${encodeURIComponent(lang)}`;
}

/**
 * Reaponta o host de uma URL qualquer (ex.: poster) para o IP da LAN quando o
 * host atual é local (localhost/127.0.0.1) — a TV não resolve localhost.
 * URLs que não são absolutas ou já apontam para outro host são mantidas.
 */
export function normalizeHostForCast(url: string, lanIp: string, port: number): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1') {
      parsed.hostname = lanIp;
      parsed.port = String(port);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

/** Primeira faixa de áudio cujo idioma bate com o desejado (ou undefined). */
export function pickCastAudioTrackId(
  audioTracks: { trackId: number; language: string }[] | null | undefined,
  desiredLang: string
): number | undefined {
  if (!audioTracks) return undefined;
  return audioTracks.find((t) => t.language === desiredLang)?.trackId;
}
