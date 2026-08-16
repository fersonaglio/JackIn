import { describe, it, expect } from 'vitest';
import { titleKey } from './route';

describe('titleKey', () => {
  it('folds punctuation/whitespace so variants collide', () => {
    expect(titleKey('Pirates of the Caribbean: On Stranger Tides')).toBe(
      titleKey('Pirates of the Caribbean On Stranger Tides'),
    );
    expect(titleKey('At World\'s End')).toBe('at worlds end');
    expect(titleKey('The Lord of the Rings')).toBe('lord of the rings');
    expect(titleKey('Homem de Ferro')).toBe('homem de ferro');
  });

  it('keeps the PT title distinct from the EN one (merge uses EN original)', () => {
    // The merge keys on the TMDB EN original title, so the PT display title
    // must NOT collide with the EN Wikipedia title.
    expect(titleKey('Piratas do Caribe: Navegando em Águas Misteriosas')).not.toBe(
      titleKey('Pirates of the Caribbean: On Stranger Tides'),
    );
    expect(titleKey('Pirates of the Caribbean')).not.toBe(
      titleKey('Pirates of the Caribbean: Dead Men Tell No Tales'),
    );
  });
});
