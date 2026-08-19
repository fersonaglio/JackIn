import { describe, it, expect } from 'vitest';
import { buildAltSourceUrls } from './mediaOptions';

describe('buildAltSourceUrls', () => {
  const pt = (url: string) => ({ sourceUrl: url, ptConfirmed: true });
  const any = (url: string) => ({ sourceUrl: url, ptConfirmed: false });

  it('com requirePt=true mantém só alternativas PT', () => {
    const res = buildAltSourceUrls(
      [pt('m1'), any('m2'), pt('m3')],
      'm1',
      true,
    );
    expect(res).toEqual(['m3']);
  });

  it('exclui a própria fonte escolhida', () => {
    const res = buildAltSourceUrls([pt('m1'), pt('m2')], 'm1', true);
    expect(res).toEqual(['m2']);
  });

  it('sem requirePt mantém todas (menos a fonte)', () => {
    const res = buildAltSourceUrls([pt('m1'), any('m2'), any('m3')], 'm1', false);
    expect(res).toEqual(['m2', 'm3']);
  });

  it('ignora opções sem sourceUrl', () => {
    const res = buildAltSourceUrls(
      [{ sourceUrl: undefined as unknown as string, ptConfirmed: true }, pt('m1')],
      'm1',
      false,
    );
    expect(res).toEqual([]);
  });

  it('com requirePt e lista vazia retorna []', () => {
    expect(buildAltSourceUrls([], 'm1', true)).toEqual([]);
  });
});
