import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { validateConfig } from '@directory/config';
import type { DirectoryConfiguration, DirectoryLink } from '@directory/config/types';
import { describe, expect, it } from 'vitest';
import { getBookmarkLogos } from './bookmark-logos.js';

function configuration(
	links: Record<string, Pick<DirectoryLink, 'title'> & Partial<DirectoryLink>>
): DirectoryConfiguration {
	return validateConfig(
		{
			links: Object.fromEntries(
				Object.entries(links).map(([id, link]) => [id, { url: 'https://example.com', ...link }])
			)
		},
		{ env: {} }
	);
}

function letters(svg: string): string {
	return svg.match(/<text\b[^>]*>([^<]*)<\/text>/u)?.[1] ?? '';
}

function background(svg: string): string {
	const color = svg.match(/<rect\b[^>]*fill="(#[a-f0-9]{6})"/iu)?.[1];
	expect(color).toBeDefined();
	return color!;
}

function luminance(hex: string): number {
	const channels = hex
		.slice(1)
		.match(/.{2}/gu)!
		.map((channel) => {
			const value = parseInt(channel, 16) / 255;
			return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
		});
	return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

describe('prepared bookmark logos with the current Initials renderer', () => {
	it('keeps the exact published Initials definition bytes', async () => {
		const bytes = await readFile(new URL('./initials.json', import.meta.url));
		expect(bytes.byteLength).toBe(2116);
		expect(createHash('sha256').update(bytes).digest('hex')).toBe(
			'9d2ddeeaaa4070a3ff2a7c57368bbfa8bd863a001625fe6ec97907b9d1914eb4'
		);
	});

	it.each([
		['Home Assistant', 'HA'],
		['Photos', 'PH'],
		['École Photos', 'ÉP'],
		['照片', '照片'],
		['e\u0301cole Photos', 'E\u0301P'],
		['Photos@home', 'PH']
	])('uses the visible title %j rather than the route slug', (title, expected) => {
		const logos = getBookmarkLogos(configuration({ 'different-slug': { title } }));
		expect(Object.keys(logos)).toEqual(['different-slug']);
		expect(letters(logos['different-slug']!)).toBe(expected);
	});

	it.each(['12345', '😀', '\u0301', '123@Photos', '@Photos'])(
		'falls back to the slug for a title without usable letters: %j',
		(title) => {
			const logos = getBookmarkLogos(configuration({ 'backup-files': { title } }));
			expect(letters(logos['backup-files']!)).toBe('BF');
		}
	);

	it.each([
		{ id: 'long-title', title: 'A'.repeat(1025) },
		{ id: 'b'.repeat(1025), title: '123' },
		{ id: 'unicode-title', title: '𐐨'.repeat(1025) },
		{ id: 'late-letter', title: '1'.repeat(1024) + 'A' }
	])('bounds renderer input without restricting configured titles or slugs', ({ id, title }) => {
		const config = configuration({ [id]: { title } });
		const logos = getBookmarkLogos(config);
		expect(logos[id]).toMatch(/^<svg\b/);
		expect(letters(logos[id]!)).not.toBe('');
		expect(getBookmarkLogos(config)).toEqual(logos);
	});

	it('uses an explicit Directory fallback for a valid slug with no letters', () => {
		const logos = getBookmarkLogos(configuration({ '123-456': { title: '😀' } }));
		expect(letters(logos['123-456']!)).toBe('DI');
	});

	it.each(['<script>alert(1)</script>\u0001', '<>&"\'\u0000\nPhotos', 'A & B'])(
		'accepts raw HTML-like and control text without copying it into SVG metadata: %j',
		(title) => {
			const svg = getBookmarkLogos(configuration({ photos: { title } })).photos!;
			expect(letters(svg)).not.toBe('');
			expect(svg).not.toMatch(/<script|<title|<desc|onerror=/u);
			expect(svg).not.toContain('\u0000');
			expect(svg).not.toContain('\u0001');
			expect(svg).not.toContain(title);
			expect(svg).not.toContain('&amp;amp;');
		}
	);

	it('is deterministic, owns its result, and leaves caller configuration untouched', () => {
		const config = configuration({ photos: { title: 'Family Photos' } });
		const before = structuredClone(config);
		const first = getBookmarkLogos(config);
		const second = getBookmarkLogos(config);
		expect(first).toEqual(second);
		expect(first).not.toBe(second);
		expect(config).toEqual(before);
		expect(Object.isFrozen(config.links)).toBe(false);
		first.photos = 'changed';
		expect(getBookmarkLogos(config)).toEqual(second);
		expect(
			letters(getBookmarkLogos(configuration({ photos: { title: 'Backup Files' } })).photos!)
		).toBe('BF');
	});

	it('keys separate slugs independently while sharing a named group color', () => {
		const logos = getBookmarkLogos(
			configuration({
				photos: { title: 'Photos', group: 'Family' },
				backup: { title: 'Backup Files', group: 'Family' }
			})
		);
		expect(Object.keys(logos)).toEqual(['photos', 'backup']);
		expect(letters(logos.photos!)).toBe('PH');
		expect(letters(logos.backup!)).toBe('BF');
		expect(background(logos.photos!)).toBe(background(logos.backup!));
	});

	it('keeps colors stable through group insertion, declaration reordering and sorting', () => {
		const config = configuration({
			photos: { title: 'Photos', group: 'Family' },
			files: { title: 'Files' },
			other: { title: 'Named Other', group: 'Other' }
		});
		const original = getBookmarkLogos(config);
		const reordered = configuration({
			newcomer: { title: 'New group', group: 'A new group' },
			other: config.links.other!,
			files: config.links.files!,
			photos: config.links.photos!
		});
		reordered.site.order = 'alphabetical';
		reordered.appearance.primary_light_color = '#000000';
		reordered.appearance.primary_dark_color = '#ffffff';
		const updated = getBookmarkLogos(reordered);
		for (const id of Object.keys(original)) expect(updated[id]).toBe(original[id]);
	});

	it('uses a varied flat palette with opaque high-contrast colors and intrinsic 64px dimensions', () => {
		const config = configuration(
			Object.fromEntries(
				Array.from({ length: 100 }, (_, index) => [`link-${index}`, { title: 'Photos' }])
			)
		);
		const colors = new Set<string>();
		for (const svg of Object.values(getBookmarkLogos(config))) {
			expect(svg).toMatch(/^<svg\b[^>]*width="64"[^>]*height="64"/u);
			expect(svg).toContain('fill="#1f2937"');
			expect(svg).not.toMatch(/mix-blend-mode|opacity=|<title/u);
			const color = background(svg);
			colors.add(color);
			const contrast = (luminance(color) + 0.05) / (luminance('#1f2937') + 0.05);
			expect(contrast).toBeGreaterThanOrEqual(7);
		}
		expect(colors.size).toBeGreaterThan(1);
	});

	it('returns an empty record for an empty directory', () => {
		expect(getBookmarkLogos(configuration({}))).toEqual({});
	});
});
