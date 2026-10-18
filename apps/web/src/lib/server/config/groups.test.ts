import { validateConfig } from '@where/config';
import type { WhereLink, WhereSite } from '@where/config/types';
import { describe, expect, it } from 'vitest';
import { getGroups } from './groups.js';

function directory(
	links: Record<string, Pick<WhereLink, 'title'> & Partial<WhereLink>>,
	order: WhereSite['order'] = 'configured'
) {
	const config = validateConfig(
		{
			site: { order },
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

	it('sorts flat link titles alphabetically with numeric order and stable base-sensitive ties', () => {
		const display = directory(
			{
				ten: { title: 'Tool 10' },
				two: { title: 'Tool 2' },
				accent: { title: 'Éclair' },
				lower: { title: 'eclair' },
				upper: { title: 'ECLAIR' }
			},
			'alphabetical'
		);
		expect(display.grouped).toBe(false);
		expect(display.groups[0]).not.toHaveProperty('label');
		expect(groupLinkIds(display)).toEqual([['accent', 'lower', 'upper', 'two', 'ten']]);
	});

	it('sorts named groups and their links but leaves the missing-group bucket last', () => {
		const display = directory(
			{
				'missing-z': { title: 'Zebra' },
				'tool-ten': { title: 'Tool 10', group: 'Shelf 10' },
				'tool-two': { title: 'Tool 2', group: 'Shelf 10' },
				'shelf-two': { title: 'Shelf', group: 'Shelf 2' },
				other: { title: 'Other', group: 'Other' },
				'missing-a': { title: 'Alpha' }
			},
			'alphabetical'
		);
		expect(display.groups.map((group) => group.id)).toEqual([
			'named:Other',
			'named:Shelf 2',
			'named:Shelf 10',
			'ungrouped'
		]);
		expect(groupLinkIds(display)).toEqual([
			['other'],
			['shelf-two'],
			['tool-two', 'tool-ten'],
			['missing-a', 'missing-z']
		]);
	});

	it('preserves declaration order for equal group labels under the collator', () => {
		const display = directory(
			{
				accent: { title: 'First', group: 'Éclair' },
				lower: { title: 'Second', group: 'eclair' },
				upper: { title: 'Third', group: 'ECLAIR' }
			},
			'alphabetical'
		);
		expect(display.groups.map((group) => group.id)).toEqual([
			'named:Éclair',
			'named:eclair',
			'named:ECLAIR'
		]);
		expect(groupLinkIds(display)).toEqual([['accent'], ['lower'], ['upper']]);
	});
});
