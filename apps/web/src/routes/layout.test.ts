import { validateConfig } from '@directory/config';
import { describe, expect, it } from 'vitest';
import { prepareSnapshot } from '../lib/server/config/snapshot.js';
import { load } from './+layout.server.js';

function event(favicon_path?: string) {
	const site: Record<string, string> = {
		title: 'PRIVATE_LAYOUT_TITLE',
		logo_path: '/public/private-logo.svg'
	};
	if (favicon_path !== undefined) site.favicon_path = favicon_path;
	const snapshot = prepareSnapshot(
		validateConfig(
			{
				site,
				auth: { credentials: { username: 'PRIVATE_USERNAME', password: 'PRIVATE_PASSWORD' } },
				links: {}
			},
			{ env: {} }
		)
	);
	return {
		locals: {
			snapshot,
			publicDir: '/PRIVATE_PUBLIC_ROOT',
			session: { user: { name: 'PRIVATE_IDENTITY' }, expires: '2099-01-01' },
			authentication: undefined
		}
	} as Parameters<typeof load>[0];
}

describe('shared favicon layout data', () => {
	it('returns only the bundled URI when the source is omitted', () => {
		expect(load(event())).toEqual({ faviconPath: '/favicon.svg' });
	});

	it.each(['/public/PRIVATE_SOURCE.png', '/public/café family.svg'])(
		'returns only the constant alias for configured source %s',
		(source) => {
			const data = load(event(source));
			expect(data).toEqual({ faviconPath: '/favicon' });
			expect(JSON.stringify(data)).not.toContain(source);
			expect(JSON.stringify(data)).not.toContain('PRIVATE_');
		}
	);

	it('uses each request capture rather than a replacement or display metadata', () => {
		const captured = event('/public/PRIVATE_SOURCE.svg');
		const replacement = event();
		captured.locals.snapshot = {
			...captured.locals.snapshot,
			display: replacement.locals.snapshot.display
		};
		expect(load(replacement)).toEqual({ faviconPath: '/favicon.svg' });
		expect(load(captured)).toEqual({ faviconPath: '/favicon' });
	});
});
