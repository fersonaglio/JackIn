const FALLBACK_TRACKERS: string[] = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://tracker.openbittorrent.com:80/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://explodie.org:6969/announce',
  'udp://ipv4.tracker.harry.lu:80/announce',
  'udp://tracker.moeking.me:6969/announce',
  'udp://tracker.tiny-vps.com:6969/announce',
  'udp://tracker.tamersunion.org:1337/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://tracker.pirateparty.gr:6969/announce',
  'udp://tracker.gbitt.info:80/announce',
  'udp://tracker.bittor.pw:1337/announce',
  'udp://tracker.altrosky.nl:2710/announce',
  'udp://p4p.arenabg.com:1337/announce',
  'udp://movies.zsw.ca:6969/announce',
  'udp://retracker.lanta-net.ru:2710/announce',
  'udp://vibe.community:6969/announce',
  'udp://opentor.net:6969/announce',
  'udp://tracker.filemail.com:6969/announce',
  'udp://tracker.ddunlimited.net:6969/announce',
  'udp://tracker.dump.cl:6969/announce',
  'udp://tracker.qu.ax:6969/announce',
  'udp://sanincode.com:6969/announce',
  'udp://run.publictracker.xyz:6969/announce',
  'udp://public.tracker.vraphim.com:6969/announce',
  'udp://free-tracker.zooki.xyz:6969/announce',
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.fastcast.nz',
];

const configured = process.env.P2P_TRACKERS;

export const TRACKERS_LIST: string[] = configured
  ? configured.split(',').map((t) => t.trim()).filter(Boolean)
  : FALLBACK_TRACKERS;

export const TRACKERS_COMMA = TRACKERS_LIST.filter((t) => t.startsWith('udp://')).join(',');

/**
 * Enriquece um magnet link com todos os trackers UDP curados de alta performance,
 * garantindo conexão rápida com peers mesmo em links com poucos trackers embutidos.
 */
export function enrichMagnetWithTrackers(magnetUri: string): string {
  if (!magnetUri || !magnetUri.startsWith('magnet:?')) {
    return magnetUri;
  }
  const parts = magnetUri.split('&');
  const existingTrackers = new Set(
    parts
      .filter((p) => p.startsWith('tr='))
      .map((p) => decodeURIComponent(p.replace('tr=', '')))
  );

  const udpTrackers = TRACKERS_LIST.filter((t) => t.startsWith('udp://'));
  const newParams: string[] = [];

  for (const tr of udpTrackers) {
    if (!existingTrackers.has(tr)) {
      newParams.push(`tr=${encodeURIComponent(tr)}`);
    }
  }

  if (newParams.length === 0) return magnetUri;
  return `${magnetUri}&${newParams.join('&')}`;
}
