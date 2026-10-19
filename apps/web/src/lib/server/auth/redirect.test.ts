import { describe, expect, it } from 'vitest';
import { localRedirect } from './redirect.js';

const origin = 'https://directory.example';

describe('localRedirect', () => {
	it.each([
		['/', '/'],
		['/group?q=one#two', '/group?q=one#two'],
		['https://directory.example/links?q=1', '/links?q=1'],
		['links', '/links'],
		['//directory.example/links', '/links']
	])('keeps local returns: %s', (value, expected) => {
		expect(localRedirect(value, origin)).toBe(expected);
	});

	it.each([
		null,
		undefined,
		'',
		'https://evil.example/private',
		'//evil.example/private',
		'/\\evil.example/private',
		'javascript:alert(1)',
		'https://directory.example.evil.example/',
		'https://user:password@directory.example/',
		'https://directory.example//evil.example',
		'https://directory.example/..//evil.example',
		'http://directory.example/',
		'http://['
	])('rejects hostile or absent returns: %s', (value) => {
		expect(localRedirect(value, origin, '/safe')).toBe('/safe');
	});
});
