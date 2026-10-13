import { describe, expect, it } from 'vitest';
import { normalizeName, parseInviteInput, parseTags } from './normalize';
import { isPrivilegedKey } from './supabase';
import { formatRating, roundHalf, timeAgo } from './format';

describe('normalizeName (mirrors SQL normalize_name)', () => {
  it('ignores case, punctuation and leading articles', () => {
    expect(normalizeName('The Batman')).toBe('batman');
    expect(normalizeName('  BATMAN!! ')).toBe('batman');
    expect(normalizeName('A Quiet Place')).toBe('quiet place');
  });
  it('strips accents and handles Turkish letters', () => {
    expect(normalizeName('Café Müller & Sons')).toBe('cafe muller and sons');
    expect(normalizeName('Kadıköy')).toBe(normalizeName('KADIKÖY'));
    expect(normalizeName('Şişli')).toBe('sisli');
    expect(normalizeName('İstanbul')).toBe('istanbul');
  });
  it('keeps non-latin titles', () => {
    expect(normalizeName('千と千尋の神隠し')).not.toBe('');
  });
  it('returns empty for symbols only', () => {
    expect(normalizeName('!!!')).toBe('');
  });
});

describe('parseInviteInput', () => {
  it('accepts raw codes and links', () => {
    expect(parseInviteInput(' AbC123def456 ')).toBe('abc123def456');
    expect(parseInviteInput('https://me.github.io/stakeout/#/join/abc123def456')).toBe('abc123def456');
  });
});

describe('parseTags', () => {
  it('lowercases, trims, dedupes and caps', () => {
    expect(parseTags('Noir, rain  ,NOIR, #date night')).toEqual(['noir', 'rain', 'date night']);
    expect(parseTags(Array.from({ length: 20 }, (_, i) => `t${i}`).join(','))).toHaveLength(12);
  });
});

describe('rating helpers', () => {
  it('formats and rounds to half steps', () => {
    expect(formatRating(4)).toBe('4.0');
    expect(formatRating(null)).toBe('–');
    expect(roundHalf(3.74)).toBe(3.5);
    expect(roundHalf(3.76)).toBe(4);
  });
  it('describes elapsed time', () => {
    const now = Date.now();
    expect(timeAgo(new Date(now - 30_000).toISOString())).toBe('just now');
    expect(timeAgo(new Date(now - 3 * 3600_000).toISOString())).toBe('3h ago');
  });
});

describe('service-role guard', () => {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  it('flags privileged keys but not anon keys', () => {
    expect(isPrivilegedKey(`h.${b64({ role: 'service_role' })}.s`)).toBe(true);
    expect(isPrivilegedKey('sb_secret_abc')).toBe(true);
    expect(isPrivilegedKey(`h.${b64({ role: 'anon' })}.s`)).toBe(false);
    expect(isPrivilegedKey('sb_publishable_abc')).toBe(false);
  });
});
