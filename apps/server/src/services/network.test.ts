import { describe, it, expect } from 'vitest';
import { getLanIpsFrom, getPrimaryLanIpFrom, type LanIfaces } from '../services/network.js';

describe('getLanIpsFrom', () => {
  it('filtra loopback, interno e link-local; mantém só IPv4 público', () => {
    const ifaces: LanIfaces = {
      lo0: [{ name: 'lo0', address: '127.0.0.1', family: 'IPv4', internal: true }],
      en0: [
        { name: 'en0', address: '192.168.1.10', family: 'IPv4', internal: false },
        { name: 'en0', address: 'fe80::1', family: 'IPv6', internal: false },
      ],
      en5: [{ name: 'en5', address: '169.254.1.1', family: 'IPv4', internal: false }],
      utun3: [{ name: 'utun3', address: '10.0.0.2', family: 'IPv4', internal: false }],
    };
    expect(getLanIpsFrom(ifaces)).toEqual(['192.168.1.10', '10.0.0.2']);
  });

  it('prefere device "en*" mesmo com classe de IP pior', () => {
    const ifaces: LanIfaces = {
      wlan0: [{ name: 'wlan0', address: '192.168.0.5', family: 'IPv4', internal: false }],
      en1: [{ name: 'en1', address: '10.1.2.3', family: 'IPv4', internal: false }],
    };
    expect(getLanIpsFrom(ifaces)).toEqual(['10.1.2.3', '192.168.0.5']);
  });

  it('ordena 192.168.* antes de 10.* dentro do mesmo grupo de device', () => {
    const ifaces: LanIfaces = {
      en0: [{ name: 'en0', address: '10.0.0.9', family: 'IPv4', internal: false }],
      en1: [{ name: 'en1', address: '192.168.1.50', family: 'IPv4', internal: false }],
    };
    expect(getLanIpsFrom(ifaces)).toEqual(['192.168.1.50', '10.0.0.9']);
  });

  it('ranking de classes: 192.168 > 10 > 172.16-31 > demais (alpha)', () => {
    const ifaces: LanIfaces = {
      en0: [
        { name: 'en0', address: '8.8.8.8', family: 'IPv4', internal: false },
        { name: 'en0', address: '172.20.0.2', family: 'IPv4', internal: false },
        { name: 'en0', address: '10.0.0.2', family: 'IPv4', internal: false },
        { name: 'en0', address: '192.168.0.2', family: 'IPv4', internal: false },
      ],
    };
    expect(getLanIpsFrom(ifaces)).toEqual(['192.168.0.2', '10.0.0.2', '172.20.0.2', '8.8.8.8']);
  });

  it('sem interfaces válidas → lista vazia', () => {
    expect(getLanIpsFrom({})).toEqual([]);
    const onlyLoopback: LanIfaces = {
      lo0: [{ name: 'lo0', address: '127.0.0.1', family: 'IPv4', internal: true }],
    };
    expect(getLanIpsFrom(onlyLoopback)).toEqual([]);
  });
});

describe('getPrimaryLanIpFrom', () => {
  it('retorna o primeiro IP da lista ordenada', () => {
    const ifaces: LanIfaces = {
      en0: [{ name: 'en0', address: '192.168.1.10', family: 'IPv4', internal: false }],
      en5: [{ name: 'en5', address: '10.0.0.2', family: 'IPv4', internal: false }],
    };
    expect(getPrimaryLanIpFrom(ifaces)).toBe('192.168.1.10');
  });

  it('sem IP disponível → null', () => {
    expect(getPrimaryLanIpFrom({})).toBeNull();
    const onlyLoopback: LanIfaces = {
      lo0: [{ name: 'lo0', address: '127.0.0.1', family: 'IPv4', internal: true }],
    };
    expect(getPrimaryLanIpFrom(onlyLoopback)).toBeNull();
  });
});
