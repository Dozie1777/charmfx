import { describe, expect, it } from 'vitest';
import { resolveEnding, roundToEnding } from '../src';

const NINETY_NINE = { step: 100, ending: 99 };

describe('roundToEnding', () => {
  it('rounds up to the next .99 at least the markup above', () => {
    expect(roundToEnding(982, NINETY_NINE, 35)).toBe(1099); // €9.99 would add only 17c
    expect(roundToEnding(1050, NINETY_NINE, 35)).toBe(1099);
    expect(roundToEnding(1070, NINETY_NINE, 35)).toBe(1199);
    expect(roundToEnding(964, NINETY_NINE, 35)).toBe(999); // exactly the markup
    expect(roundToEnding(34512, NINETY_NINE, 35)).toBe(34599);
  });

  it('gives small amounts a .99 price and leaves nothing as nothing', () => {
    expect(roundToEnding(69, NINETY_NINE, 35)).toBe(199);
    expect(roundToEnding(50, NINETY_NINE)).toBe(99);
    expect(roundToEnding(200, NINETY_NINE)).toBe(299);
    expect(roundToEnding(0, NINETY_NINE, 35)).toBe(0);
  });

  it('keeps a price already on the ending', () => {
    expect(roundToEnding(1099, NINETY_NINE)).toBe(1099);
    expect(roundToEnding(1000, { step: 100, ending: 0 })).toBe(1000);
  });

  it('rounds to bigger steps', () => {
    // Round naira up to the next ₦500.
    expect(roundToEnding(1_234_567, { step: 50_000, ending: 0 })).toBe(1_250_000);
    expect(roundToEnding(1, { step: 50_000, ending: 0 })).toBe(50_000);
  });
});

describe('resolveEnding', () => {
  it('charm ends in .99, .990 or whole units by decimal places', () => {
    expect(resolveEnding('charm', 2)).toEqual({ step: 100, ending: 99 });
    expect(resolveEnding('charm', 3)).toEqual({ step: 1000, ending: 990 });
    expect(resolveEnding('charm', 0)).toEqual({ step: 1, ending: 0 });
  });

  it('whole and none', () => {
    expect(resolveEnding('whole', 2)).toEqual({ step: 100, ending: 0 });
    expect(resolveEnding('none', 2)).toEqual({ step: 1, ending: 0 });
  });
});
