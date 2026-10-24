import { validateConfig } from '@directory/config';
import type { DirectoryLink } from '@directory/config/types';
import { describe, expect, it } from 'vitest';
import { getGroups } from './groups.js';

function directory(links: Record<string, Pick<DirectoryLink, 'title'> & Partial<DirectoryLink>>) {
	const config = validateConfig(
		{
			links: Object.fromEntries(
				Object.entries(links).map(([id, link]) => [id, { url: 'https://example.com', ...link }])
			)
		},
		{ env: {} }
	);
	return getGroups(config);
}

function groupLinkIds(display: ReturnType<typeof directory>) {
	return display.groups.map((group) => group.links.map((link) => link.id));
}

describe('prepared directory groups', () => {
	it('keeps an empty directory flat with no groups', () => {
		const display = directory({});
		expect(display.grouped).toBe(false);
		expect(display.groups).toEqual([]);
	});

	it('keeps links without groups in one unlabelled flat bucket', () => {
		const display = directory({ zebra: { title: 'Zebra' }, alpha: { title: 'Alpha' } });
		expect(display.grouped).toBe(false);
		expect(display.groups).toHaveLength(1);
		expect(display.groups[0]).toHaveProperty('id', 'ungrouped');
		expect(display.groups[0]).not.toHaveProperty('label');
		expect(groupLinkIds(display)).toEqual([['zebra', 'alpha']]);
	});

	it('preserves a configured logo path and resolves omissions independently of favicons', () => {
		const display = directory({
			'photo-album': { title: 'Photos', logo_path: '/public/photos.svg' },
			files: { title: 'Files', favicon_path: '/public/files.png', group: 'Tools' },
			plain: { title: 'No configured image' }
		});
		const links = Object.fromEntries(
			display.groups.flatMap((group) => group.links.map((link) => [link.id, link]))
		);
		expect(links['photo-album']!.logo_path).toBe('/public/photos.svg');
		expect(links.files!.logo_path).toBe('/bookmarks/files/logo');
		expect(links.files!.favicon_path).toBe('/public/files.png');
		expect(links.plain!.logo_path).toBe('/bookmarks/plain/logo');
		expect(Object.keys(links.plain!).sort()).toEqual([
			'admin_only',
			'id',
			'internal_only',
			'logo_path',
			'requires_auth',
			'tags',
			'title',
			'url'
		]);
	});

	it('preserves first group occurrence and link declaration order', () => {
		const display = directory({
			zebra: { title: 'Zebra', group: 'Tools' },
			photos: { title: 'Photos', group: 'Family' },
			alpha: { title: 'Alpha', group: 'Tools' },
			files: { title: 'Files', group: 'Family' }
		});
		expect(display.grouped).toBe(true);
		expect(display.groups.map((group) => [group.id, group.label])).toEqual([
			['named:Tools', 'Tools'],
			['named:Family', 'Family']
		]);
		expect(groupLinkIds(display)).toEqual([
			['zebra', 'alpha'],
			['photos', 'files']
		]);
	});

	it('keeps exact labels and a named Other distinct from the last missing-group bucket', () => {
		const display = directory({
			missing: { title: 'Missing' },
			named: { title: 'Named', group: 'Other' },
			spaced: { title: 'Spaced', group: ' Other ' },
			reserved: { title: 'Reserved', group: 'ungrouped' },
			another: { title: 'Another missing' }
		});
		expect(display.grouped).toBe(true);
		expect(display.groups.map((group) => [group.id, group.label])).toEqual([
			['named:Other', 'Other'],
			['named: Other ', ' Other '],
			['named:ungrouped', 'ungrouped'],
			['ungrouped', 'Other']
		]);
		expect(groupLinkIds(display)).toEqual([
			['named'],
			['spaced'],
			['reserved'],
			['missing', 'another']
		]);
		const allIds = display.groups.flatMap((group) => group.links.map((link) => link.id));
		expect(allIds).toHaveLength(5);
		expect(new Set(allIds).size).toBe(5);
	});

	it('preserves authored flat order regardless of numeric titles, accents or case', () => {
		const display = directory({
			ten: { title: 'Tool 10' },
			two: { title: 'Tool 2' },
			accent: { title: 'Éclair' },
			lower: { title: 'eclair' },
			upper: { title: 'ECLAIR' }
		});
		expect(display.grouped).toBe(false);
		expect(display.groups[0]).not.toHaveProperty('label');
		expect(groupLinkIds(display)).toEqual([['ten', 'two', 'accent', 'lower', 'upper']]);
	});

	it('keeps authored group and link order with ungrouped links last', () => {
		const display = directory({
			'missing-z': { title: 'Zebra' },
			'tool-ten': { title: 'Tool 10', group: 'Shelf 10' },
			'tool-two': { title: 'Tool 2', group: 'Shelf 10' },
			'shelf-two': { title: 'Shelf', group: 'Shelf 2' },
			other: { title: 'Other', group: 'Other' },
			'missing-a': { title: 'Alpha' }
		});
		expect(display.groups.map((group) => group.id)).toEqual([
			'named:Shelf 10',
			'named:Shelf 2',
			'named:Other',
			'ungrouped'
		]);
		expect(groupLinkIds(display)).toEqual([
			['tool-ten', 'tool-two'],
			['shelf-two'],
			['other'],
			['missing-z', 'missing-a']
		]);
	});

	it('keeps distinct group labels without normalizing accents or case', () => {
		const display = directory({
			accent: { title: 'First', group: 'Éclair' },
			lower: { title: 'Second', group: 'eclair' },
			upper: { title: 'Third', group: 'ECLAIR' }
		});
		expect(display.groups.map((group) => group.id)).toEqual([
			'named:Éclair',
			'named:eclair',
			'named:ECLAIR'
		]);
		expect(groupLinkIds(display)).toEqual([['accent'], ['lower'], ['upper']]);
	});
});
