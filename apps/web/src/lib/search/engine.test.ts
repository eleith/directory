import { describe, expect, it } from 'vitest';
import type { DirectoryContent, DisplayGroup, DisplayLink } from '#lib/display/types.js';
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

function directory(groups: readonly DisplayGroup[]): DirectoryContent {
	return Object.freeze({
		snapshotId: 'unit-snapshot',
		site: Object.freeze({
			title: 'Common site masthead',
			description: '',
			footer: '',
			logo_path: '/favicon.png',
			favicon_path: '/favicon.png',
			open_links_in_new_tab: true
		}),
		appearance: Object.freeze({ primary_light_color: '#111', primary_dark_color: '#eee' }),
		grouped: true,
		groups: Object.freeze(groups)
	});
}

function ids(search: ReturnType<typeof createSearch>, query: string) {
	return search(query).map((result) => result.link.id);
}

describe('exact prefix search', () => {
	it('matches whole prepared tags with case folding and trimmed query edges', () => {
		const search = createSearch(
			directory([
				{
					id: 'flat',
					links: [
						link('tagged', { tags: Object.freeze(['Family Photos', 'ops: status / v2!']) }),
						link('longer', { tags: Object.freeze(['Family Photos archive']) }),
						link('title', { title: 'Family Photos' }),
						link('description', { description: 'Family Photos' })
					]
				}
			])
		);
		expect(ids(search, ' \tTaG:  FAMILY PHOTOS \n')).toEqual(['tagged']);
		expect(ids(search, 'tag:OPS: STATUS / V2!')).toEqual(['tagged']);
		for (const query of ['tag:family', 'tag:photos', 'tag:family phots', 'tag:family  photos']) {
			expect(search(query)).toEqual([]);
		}
	});

	it('treats the entire tag remainder literally without quotes, operators or stacked prefixes', () => {
		const search = createSearch(
			directory([
				{
					id: 'flat',
					links: [
						link('photos', { tags: Object.freeze(['photos']), requires_auth: true }),
						link('backup', { tags: Object.freeze(['backup']) }),
						link('literal', {
							tags: Object.freeze([
								'photos access:login',
								'photos OR backup',
								'photos/backup',
								'tag:photos',
								'photos extra'
							])
						})
					]
				}
			])
		);
		for (const query of [
			'tag:photos access:login',
			'tag:photos OR backup',
			'tag:photos/backup',
			'tag:tag:photos',
			'tag:photos extra'
		]) {
			expect(ids(search, query)).toEqual(['literal']);
		}
		expect(search('tag:"photos"')).toEqual([]);
		expect(search('tag:photos | backup')).toEqual([]);
	});

	it('matches only the corresponding true access boolean, not tags or other public text', () => {
		const stringFlags = Object.freeze({
			...link('string-flags'),
			requires_auth: 'true',
			internal_only: 'true',
			admin_only: 'true'
		}) as unknown as DisplayLink;
		const search = createSearch(
			directory([
				{
					id: 'flat',
					links: [
						link('login', { requires_auth: true }),
						link('internal', { internal_only: true }),
						link('admin', { admin_only: true }),
						link('disabled'),
						link('decoy', {
							title: 'access:login access:internal access:admin',
							description: 'Requires authentication Internal only Admin only',
							tags: Object.freeze(['login', 'internal', 'admin', 'access:login'])
						}),
						stringFlags
					]
				}
			])
		);
		expect(ids(search, ' AcCeSs: LOGIN ')).toEqual(['login']);
		expect(ids(search, 'access:internal')).toEqual(['internal']);
		expect(ids(search, 'access:admin')).toEqual(['admin']);
	});

	it('returns no results for empty known prefixes and invalid access values without fuzzy fallback', () => {
		const search = createSearch(
			directory([
				{
					id: 'flat',
					links: [
						link('decoy', { title: 'tag: access:owner', tags: Object.freeze(['']) }),
						link('enabled', { requires_auth: true, internal_only: true, admin_only: true })
					]
				}
			])
		);
		for (const query of [
			'tag:',
			' TAG: \t ',
			'access:',
			' ACCESS: \n ',
			'access:owner',
			'access:logn',
			'access:login extra',
			'access:login access:admin',
			'access:login/admin',
			'access:login OR admin',
			'access:"login"'
		]) {
			expect(search(query)).toEqual([]);
		}
	});

	it('leaves other prefixes and non-leading prefix text to normal Fuse search', () => {
		const search = createSearch(
			directory([
				{
					id: 'flat',
					links: [
						link('unknown', { title: 'topic:nebula' }),
						link('embedded-tag', { title: 'notes tag:observatory' }),
						link('embedded-access', { title: 'notes access:login' })
					]
				}
			])
		);
		expect(ids(search, 'topic:nebula')).toEqual(['unknown']);
		expect(ids(search, 'notes tag:observatory')).toEqual(['embedded-tag']);
		expect(ids(search, 'notes access:login')).toEqual(['embedded-access']);
	});

	it('preserves prepared display order, original references and frozen inputs across groups', () => {
		const bookmarks = Object.freeze([
			link('zulu', { tags: Object.freeze(['Shared']), requires_auth: true }),
			link('alpha', { tags: Object.freeze(['shared']), requires_auth: true }),
			link('middle', { tags: Object.freeze(['SHARED']), requires_auth: true })
		]);
		const snapshot = directory(
			Object.freeze([
				Object.freeze({
					id: 'first',
					label: 'First group',
					links: Object.freeze([bookmarks[0]!, bookmarks[1]!])
				}),
				Object.freeze({ id: 'second', links: Object.freeze([bookmarks[2]!]) })
			])
		);
		const before = JSON.stringify(snapshot);
		const search = createSearch(snapshot);
		for (const query of ['tag:shared', 'access:login']) {
			const results = search(query);
			expect(results).toEqual([
				{ link: bookmarks[0], groupLabel: 'First group' },
				{ link: bookmarks[1], groupLabel: 'First group' },
				{ link: bookmarks[2], groupLabel: undefined }
			]);
			for (const [index, result] of results.entries()) {
				expect(result.link).toBe(bookmarks[index]);
			}
		}
		expect(JSON.stringify(snapshot)).toBe(before);
	});
});

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

	it('indexes only the enabled true advisory labels', () => {
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
