import { describe, expect, it } from 'vitest';
import { parseVttCues, parseVttTimestamp } from './subtitleParser';

describe('parseVttTimestamp', () => {
  it('parses MM:SS.mmm', () => {
    expect(parseVttTimestamp('00:11.125')).toBeCloseTo(11.125);
  });

  it('parses HH:MM:SS.mmm', () => {
    expect(parseVttTimestamp('01:02:03.500')).toBeCloseTo(3723.5);
  });

  it('accepts comma decimal separator (SRT style)', () => {
    expect(parseVttTimestamp('00:02:03,250')).toBeCloseTo(123.25);
  });
});

describe('parseVttCues', () => {
  const VTT = [
    'WEBVTT',
    '',
    '00:11.125 --> 00:13.542',
    'O cruel IMPÉRIO GALÁCTICO caiu.',
    '',
    '00:13.625 --> 00:16.792',
    'Ex-senhores da guerra',
    'estão espalhados pela galáxia',
    '',
    'NOTE this block is ignored',
    '',
  ].join('\n');

  it('parses cues with multi-line text', () => {
    const cues = parseVttCues(VTT);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ start: 11.125, end: 13.542, text: 'O cruel IMPÉRIO GALÁCTICO caiu.' });
    expect(cues[1].text).toBe('Ex-senhores da guerra\nestão espalhados pela galáxia');
  });

  it('strips HTML and ASS/SSA tags from the body', () => {
    const vtt = ['WEBVTT', '', '00:01.000 --> 00:02.000', '{\\an8}<i>Hi</i> there<br>now', ''].join('\n');
    const [cue] = parseVttCues(vtt);
    expect(cue.text).toBe('Hi therenow');
  });

  it('sorts cues by start time', () => {
    const vtt = ['WEBVTT', '', '00:05.000 --> 00:06.000', 'b', '', '00:01.000 --> 00:02.000', 'a', ''].join('\n');
    expect(parseVttCues(vtt).map((c) => c.text)).toEqual(['a', 'b']);
  });

  it('returns an empty array for empty or header-only input', () => {
    expect(parseVttCues('')).toEqual([]);
    expect(parseVttCues('WEBVTT\n\n')).toEqual([]);
  });

  it('skips blocks that have timing but no text', () => {
    const cues = parseVttCues(['WEBVTT', '', '00:01.000 --> 00:02.000', '', '00:03.000 --> 00:04.000', 'x', ''].join('\n'));
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe('x');
  });
});
