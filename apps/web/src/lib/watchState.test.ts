import { describe, expect, it } from 'vitest';
import { nextWatchedState, WATCHED_THRESHOLD, UNWATCH_THRESHOLD } from './watchState';

describe('nextWatchedState', () => {
  it('marca assistido ao cruzar 90%', () => {
    expect(nextWatchedState(0.9, false)).toBe(true);
    expect(nextWatchedState(0.96, false)).toBe(true);
  });

  it('não reenvia true quando já está assistido', () => {
    expect(nextWatchedState(0.98, true)).toBeNull();
  });

  it('desmarca só abaixo de 80% e quando estava assistido', () => {
    expect(nextWatchedState(0.79, true)).toBe(false);
    expect(nextWatchedState(0.5, true)).toBe(false);
  });

  it('não desmarca um não-assistido', () => {
    expect(nextWatchedState(0.1, false)).toBeNull();
  });

  it('histerese: entre 80% e 90% não muda nada', () => {
    expect(nextWatchedState(0.85, false)).toBeNull();
    expect(nextWatchedState(0.85, true)).toBeNull();
    expect(nextWatchedState(WATCHED_THRESHOLD - 0.001, false)).toBeNull();
    expect(nextWatchedState(UNWATCH_THRESHOLD, true)).toBeNull();
  });
});
