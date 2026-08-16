const FALLBACK_TRACKERS: string[] = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.fastcast.nz',
];

const configured = process.env.P2P_TRACKERS;

export const TRACKERS_LIST: string[] = configured
  ? configured.split(',').map((t) => t.trim()).filter(Boolean)
  : FALLBACK_TRACKERS;

export const TRACKERS_COMMA = TRACKERS_LIST.filter((t) => t.startsWith('udp://')).join(',');
