import os from 'os';

export interface LanIface {
  name: string;
  address: string;
  family: string;
  internal: boolean;
}

export type LanIfaces = Record<string, LanIface[]>;

// Preferência de classe de IP para descoberta na LAN (Chromecast/cast).
function ipClassRank(address: string): number {
  if (address.startsWith('192.168.')) return 0;
  if (address.startsWith('10.')) return 1;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(address)) return 2;
  return 3;
}

/** Função pura (testável) — ordena e filtra um mapa de interfaces injetado. */
export function getLanIpsFrom(ifaces: LanIfaces): string[] {
  return Object.values(ifaces)
    .flat()
    .filter((i) => i.family === 'IPv4' && !i.internal)
    .filter((i) => !i.address.startsWith('127.') && !i.address.startsWith('169.254.'))
    .sort((a, b) => {
      const enA = a.name.startsWith('en') ? 0 : 1;
      const enB = b.name.startsWith('en') ? 0 : 1;
      const clsA = ipClassRank(a.address);
      const clsB = ipClassRank(b.address);
      return enA - enB || clsA - clsB || a.address.localeCompare(b.address);
    })
    .map((i) => i.address);
}

export function getPrimaryLanIpFrom(ifaces: LanIfaces): string | null {
  return getLanIpsFrom(ifaces)[0] ?? null;
}

export function getLanIps(): string[] {
  const raw = os.networkInterfaces();
  const normalized: LanIfaces = {};
  for (const name of Object.keys(raw)) {
    normalized[name] = (raw[name] || []).map((i) => ({
      name,
      address: i.address,
      family: String(i.family),
      internal: i.internal,
    }));
  }
  return getLanIpsFrom(normalized);
}

export function getPrimaryLanIp(): string | null {
  return getLanIps()[0] ?? null;
}
