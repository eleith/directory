import { describe, expect, it } from 'vitest';
import type { DirectoryDisplay, DisplayGroup, DisplayLink } from '$lib/display/types.js';
import { createSearch } from './engine.js';

function link(id: string, fields: Partial<DisplayLink> = {}): DisplayLink {
	return Object.freeze({
		id,
		title: id,
		url: `https://${id}.example.test/`,
		logo_path: `/bookmarks/${id}/logo`,
		tags: Object.freeze([]),
		requires_auth: false,
		internal_only: false,
		admin_only: false,
		...fields
	});
}

function directory(groups: readonly DisplayGroup[]): DirectoryDisplay {
	return Object.freeze({
		snapshotId: 'unit-snapshot',
		site: Object.freeze({ title: 'Common site masthead', description: '', footer: '' }),
		appearance: Object.freeze({ primary_light_color: '#111', primary_dark_color: '#eee' }),
		grouped: true,
		groups: Object.freeze(groups)
	});
}

function ids(search: ReturnType<typeof createSearch>, query: string) {
	return search(query).map((result) => result.link.id);
}

describe('weighted full-build token search', () => {
	it('ranks title above prepared tags, description and remaining public text', () => {
		const search = createSearch(
			directory([
				{
					id: 'one',
					links: [
						link('description', { description: 'amberquartz' }),
						link('tag', { tags: Object.freeze(['amberquartz']) }),
						link('title', { title: 'amberquartz' })
					]
				},
				{ id: 'two', label: 'amberquartz', links: [link('public')] }
			])
		);
		expect(ids(search, 'amberquartz')).toEqual(['title', 'tag', 'description', 'public']);
	});

	it('handles real typos, fragments, unordered words and cross-field discovery', () => {
		const search = createSearch(
			directory([
				{
					id: 'media',
					links: [
						link('jellyfin', { title: 'Jellyfin' }),
						link('navidrome', { title: 'Navidrome' }),
						link('immich', {
							title: 'Immich',
							tags: Object.freeze(['backup']),
							description: 'Photos for the family'
						})
					]
				}
			])
		);
		expect(ids(search, 'jelyfin')).toEqual(['jellyfin']);
		expect(ids(search, 'drome')).toEqual(['navidrome']);
		expect(ids(search, 'immich backup')).toEqual(['immich']);
		expect(ids(search, 'backup immich')).toEqual(['immich']);
		expect(ids(search, 'family photos')).toEqual(['immich']);
		expect(ids(search, 'photos family')).toEqual(['immich']);
		expect(ids(search, 'immich astrophysics')).toEqual([]);
	});

	it('searches deep multiline descriptions and long queries without truncation', () => {
		const ending = 'copper lantern telescope meadow archive orchard constellation';
		const search = createSearch(
			directory([
				{
					id: 'flat',
					links: [
						link('long', { description: 'Ordinary instructions.\n'.repeat(100) + ending }),
						link('partial', { description: 'copper lantern telescope meadow archive orchard' })
					]
				}
			])
		);
		expect(ids(search, 'constellation orchard meadow telescope lantern archive copper')).toEqual([
			'long'
		]);
		expect(ids(search, 'constellation')).toEqual(['long']);
	});

	it('keeps all terms when a query exceeds the token bitmask fast path', () => {
		const terms =
			'acorn bronze canyon dolphin eclipse fern glacier harbor ivory jasmine kettle lagoon magnet nectar olive prism quarry ribbon sapphire thunder umber velvet walnut xenon yarrow zephyr copper lantern telescope meadow archive orchard constellation notebook music'.split(
				' '
			);
		const search = createSearch(
			directory([
				{
					id: 'flat',
					links: [
						link('complete', { description: terms.join(' ') }),
						link('incomplete', { description: terms.slice(0, 32).join(' ') })
					]
				}
			])
		);
		expect(ids(search, terms.toReversed().join(' '))).toEqual(['complete']);
	});

	it('uses readonly prepared tags, configured group labels, slug and URL; preserves link references', () => {
		const bookmark = link('observatory-slug', {
			title: 'Weather',
			url: 'https://climate.example.test/barometer',
			tags: Object.freeze(['rainfall', 'daily notes'])
		});
		const search = createSearch(
			directory(
				Object.freeze([
					Object.freeze({
						id: 'internal-group-identity',
						label: 'Sky watchers',
						links: Object.freeze([bookmark])
					}),
					Object.freeze({ id: 'ungrouped', links: Object.freeze([link('ungrouped')]) })
				])
			)
		);
		for (const query of [
			'rainfall',
			'notes',
			'watchers',
			'observatory-slug',
			'climate',
			'barometer'
		]) {
			expect(search(query)).toEqual([{ link: bookmark, groupLabel: 'Sky watchers' }]);
			expect(search(query)[0]!.link).toBe(bookmark);
		}
		expect(search('ungrouped')[0]!.groupLabel).toBeUndefined();
		expect(search('internal-group-identity')).toEqual([]);
	});

	it('indexes only the visible true advisory labels', () => {
		const search = createSearch(
			directory([
				{
					id: 'flat',
					links: [
						link('enabled', { requires_auth: true, internal_only: true, admin_only: true }),
						link('disabled')
					]
				}
			])
		);
		for (const query of ['Requires authentication', 'Internal only', 'Admin only']) {
			expect(ids(search, query)).toEqual(['enabled']);
		}
	});

	it('never traverses unknown private fields, image references, bytes or common site copy', () => {
		const bookmark = Object.freeze({
			...link('ordinary'),
			logo_path: '/public/velvetlogo.svg',
			favicon_path: '/public/zephyrfavicon.png',
			auth: { password: 'secretquokka' },
			unknown: 'hiddenwombat',
			filesystem: '/private/saffronvault',
			bytes: 'binarynarwhal',
			generatedSVG: '<svg>vectorplatypus</svg>'
		});
		const snapshot = {
			...directory([{ id: 'flat', links: [bookmark] }]),
			auth: 'credentialpenguin'
		};
		const search = createSearch(snapshot);
		for (const query of [
			'velvetlogo',
			'zephyrfavicon',
			'secretquokka',
			'hiddenwombat',
			'saffronvault',
			'binarynarwhal',
			'vectorplatypus',
			'credentialpenguin',
			'masthead'
		]) {
			expect(search(query)).toEqual([]);
		}
	});

	it('keeps equal-score matches in configured display order across groups', () => {
		const search = createSearch(
			directory([
				{
					id: 'first',
					links: [
						link('zulu', { title: 'Shared service' }),
						link('alpha', { title: 'Shared service' })
					]
				},
				{ id: 'second', links: [link('middle', { title: 'Shared service' })] }
			])
		);
		expect(ids(search, 'shared')).toEqual(['zulu', 'alpha', 'middle']);
		expect(search('')).toEqual([]);
		expect(search(' \n\t ')).toEqual([]);
		expect(search('zzzxxyyqqq')).toEqual([]);
	});
});
