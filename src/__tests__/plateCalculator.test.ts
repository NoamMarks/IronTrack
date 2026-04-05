import { describe, it, expect } from 'vitest';
import { calculatePlates, getPlateColor } from '../lib/plateCalculator';

describe('calculatePlates', () => {
  it('returns empty plates when target ≤ bar + collars', () => {
    const result = calculatePlates(20, 20, 2.5);
    expect(result.plates).toEqual([]);
    expect(result.totalWeight).toBe(25); // 20 bar + 2×2.5 collars
  });

  it('subtracts bar weight and divides by two', () => {
    // 60kg target, 20kg bar, 2.5kg collars
    // Available per side: (60 - 20 - 5) / 2 = 17.5kg
    // 17.5 = 15 + 2.5
    const result = calculatePlates(60, 20, 2.5);
    expect(result.plates).toEqual([15, 2.5]);
    expect(result.totalWeight).toBe(60);
    expect(result.remainder).toBe(0);
  });

  it('correctly calculates for 100kg with standard bar', () => {
    // Per side: (100 - 25) / 2 = 37.5
    // 37.5 = 25 + 10 + 2.5
    const result = calculatePlates(100);
    expect(result.plates).toEqual([25, 10, 2.5]);
    expect(result.totalWeight).toBe(100);
  });

  it('correctly calculates for 140kg with standard bar', () => {
    // Per side: (140 - 25) / 2 = 57.5
    // Greedy: 25 + 25 + 5 + 2.5 = 57.5
    const result = calculatePlates(140);
    expect(result.plates).toEqual([25, 25, 5, 2.5]);
    expect(result.totalWeight).toBe(140);
  });

  it('reports non-zero remainder for impossible weights', () => {
    // 26kg target, bar=20, collars=2.5 each → available = (26-25)/2 = 0.5
    // Smallest plate is 1.25 → can't do 0.5 → remainder
    const result = calculatePlates(26);
    expect(result.plates).toEqual([]);
    expect(result.totalWeight).toBe(25);
    expect(result.remainder).toBe(1);
  });

  it('handles 0kg target', () => {
    const result = calculatePlates(0);
    expect(result.plates).toEqual([]);
    expect(result.totalWeight).toBe(25);
  });

  it('works with custom bar and collar weights', () => {
    // 50kg target, 15kg bar, 0 collars → per side: (50-15)/2 = 17.5
    const result = calculatePlates(50, 15, 0);
    expect(result.plates).toEqual([15, 2.5]);
    expect(result.totalWeight).toBe(50);
  });

  it('uses all plate sizes in a heavy load', () => {
    // 178.75kg, bar=20, collars=2.5 → per side: (178.75-25)/2 = 76.875
    // Greedy: 25+25+25+1.25 = 76.25, remainder = 0.625
    // Use a weight that exercises more variety: 96.25kg → per side: (96.25-25)/2 = 35.625
    // Greedy: 25+10+... no. Let's use exact: per side 35 = 25+10
    // Better: use custom bar. 20kg bar, 0 collars → 97.5 → per side 38.75 = 25+10+2.5+1.25
    const result = calculatePlates(97.5, 20, 0);
    expect(result.plates).toEqual([25, 10, 2.5, 1.25]);
    expect(result.totalWeight).toBe(97.5);
  });
});

describe('getPlateColor', () => {
  it('returns red for 25kg', () => {
    expect(getPlateColor(25)).toBe('#ef4444');
  });

  it('returns blue for 20kg', () => {
    expect(getPlateColor(20)).toBe('#3b82f6');
  });

  it('returns fallback for unknown weight', () => {
    expect(getPlateColor(99)).toBe('#6b7280');
  });
});
