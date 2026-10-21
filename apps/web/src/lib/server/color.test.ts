import { describe, expect, it } from 'vitest';
import { getContrastText } from './color.js';

function contrast(primary: string, foreground: string): number {
	function luminance(hex: string) {
		const digits = hex.slice(1);
		const expanded =
			digits.length === 3 ? [...digits].map((digit) => digit + digit).join('') : digits;
		const channels = expanded.match(/../g)!.map((pair) => {
			const value = parseInt(pair, 16) / 255;
			return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
		});
		return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
	}
	const values = [luminance(primary), luminance(foreground)].sort((a, b) => a - b);
	return (values[1]! + 0.05) / (values[0]! + 0.05);
}

describe('configured primary foreground', () => {
	it.each([
		['#fff', '#171717', '#171717'],
		['#000000', '#f5f5f5', '#f5f5f5'],
		['#0f766e', '#171717', '#ffffff'],
		['#5eead4', '#f5f5f5', '#000000'],
		['#777', '#171717', '#000000']
	])('chooses %s with preferred %s as %s', (primary, preferred, expected) => {
		expect(getContrastText(primary, preferred)).toBe(expected);
	});

	it.each(['#000', '#fff', '#ABC', '#abcdef', '#777777', '#00f', '#ff0000', '#0f766e', '#5eead4'])(
		'provides at least 4.5:1 contrast against %s in both schemes',
		(primary) => {
			for (const preferred of ['#171717', '#f5f5f5']) {
				expect(contrast(primary, getContrastText(primary, preferred))).toBeGreaterThanOrEqual(4.5);
			}
		}
	);
});
