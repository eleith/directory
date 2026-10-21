import { describe, expect, it } from 'vitest';
import { nextResultIndex } from './result-navigation.js';

const positions = [
	{ top: 0, left: 0 },
	{ top: 0, left: 112 },
	{ top: 0, left: 224 },
	{ top: 180, left: 0 },
	{ top: 180, left: 112 },
	{ top: 180, left: 224 },
	{ top: 360, left: 0 }
];

describe('filtered result navigation', () => {
	it('moves horizontally within a visual row without wrapping', () => {
		expect(nextResultIndex(positions, 0, 'ArrowRight')).toBe(1);
		expect(nextResultIndex(positions, 1, 'ArrowLeft')).toBe(0);
		expect(nextResultIndex(positions, 0, 'ArrowLeft')).toBe(0);
		expect(nextResultIndex(positions, 2, 'ArrowRight')).toBe(2);
	});

	it('moves vertically to the nearest column, including an incomplete last row', () => {
		expect(nextResultIndex(positions, 2, 'ArrowDown')).toBe(5);
		expect(nextResultIndex(positions, 5, 'ArrowDown')).toBe(6);
		expect(nextResultIndex(positions, 4, 'ArrowUp')).toBe(1);
		expect(nextResultIndex(positions, 1, 'ArrowUp')).toBe(1);
		expect(nextResultIndex(positions, 6, 'ArrowDown')).toBe(6);
	});

	it('handles one row, an empty grid and unrelated keys', () => {
		expect(nextResultIndex(positions.slice(0, 3), 1, 'ArrowDown')).toBe(1);
		expect(nextResultIndex([], 0, 'ArrowDown')).toBe(0);
		expect(nextResultIndex(positions, 2, 'Enter')).toBe(2);
	});

	it('moves to the ends of the current visual and semantic row with Home and End', () => {
		expect(nextResultIndex(positions, 4, 'Home')).toBe(3);
		expect(nextResultIndex(positions, 4, 'End')).toBe(5);
		expect(nextResultIndex(positions, 6, 'Home')).toBe(6);
		expect(nextResultIndex(positions, 6, 'End')).toBe(6);
	});
});
