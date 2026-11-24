import { describe, it, expect } from 'vitest';
import { hp, toPoints, formatPoints, RULES_VERSION } from '../src/index.js';

describe('points', () => {
  it('converts to half-points and back', () => {
    expect(hp(92.5)).toBe(185);
    expect(hp(-3)).toBe(-6);
    expect(toPoints(185)).toBe(92.5);
  });
  it('rejects values that are not multiples of 0.5', () => {
    expect(() => hp(0.3)).toThrow(RangeError);
  });
  it('formats with one decimal', () => {
    expect(formatPoints(185)).toBe('92.5');
    expect(formatPoints(-6)).toBe('-3.0');
  });
  it('exposes the rules version', () => {
    expect(RULES_VERSION).toBe('t20-v0.7');
  });
});
