import { validateConfig } from '@directory/config';
import { describe, expect, it } from 'vitest';
import { prepareSnapshot } from '../lib/server/directory/snapshot.js';
import { load } from './+layout.server.js';

function event(site: Record<string, string> = {}) {
	const snapshot = prepareSnapshot(
		validateConfig(
			{
				site: { title: 'PRIVATE_LAYOUT_TITLE', description: 'PRIVATE_DESCRIPTION', ...site },
				appearance: { primary_light_color: '#13579b', primary_dark_color: '#c4d6e8' },
				auth: {
					origin: 'https://private-auth.example.test',
					secret: 'PRIVATE_SESSION_SECRET_AT_LEAST_32_CHARACTERS',
					credentials: { username: 'PRIVATE_USERNAME', password: 'PRIVATE_PASSWORD' }
				},
				links: { private: { title: 'PRIVATE_LINK', url: 'https://private.example.test' } }
			},
			{ env: {} }
		)
	);
	return {
		locals: {
			snapshot,
			publicDir: '/PRIVATE_PUBLIC_ROOT',
			configPath: '/PRIVATE_CONFIG_ROOT/directory.yaml',
			session: { user: { name: 'PRIVATE_IDENTITY' }, expires: '2099-01-01' },
			authentication: undefined
		}
	} as unknown as Parameters<typeof load>[0];
}

describe('public branding layout data', () => {
	it('returns only constant aliases, with no appearance or private payload', () => {
		const captured = event();
		const before = JSON.stringify(captured.locals);
		const data = load(captured);
		expect(data).toEqual({ faviconPath: '/favicon.svg', logoPath: '/favicon.svg' });
		expect(JSON.stringify(captured.locals)).toBe(before);
	});

	it('passes explicit resolved bundled selections through without mounted aliases', () => {
		const captured = event({ logo_path: '/favicon.svg', favicon_path: '/favicon.svg' });
		expect(load(captured)).toEqual({ faviconPath: '/favicon.svg', logoPath: '/favicon.svg' });
	});

	it.each(['/public/PRIVATE_SOURCE.png', '/public/café family.svg'])(
		'publishes constant aliases, never configured source %s or image bytes',
		(source) => {
			const captured = event({ logo_path: source, favicon_path: source });
			captured.locals.snapshot = {
				...captured.locals.snapshot,
				assets: {
					referencedPaths: [source],
					brandingPaths: [source],
					bookmarkLogos: { private: 'PRIVATE_SVG_BYTES' }
				}
			};
			const data = load(captured);
			expect(data).toEqual({ faviconPath: '/favicon', logoPath: '/logo' });
			expect(JSON.stringify(data)).not.toContain(source);
			expect(JSON.stringify(data)).not.toContain('PRIVATE_');
		}
	);

	it('selects aliases only from captured configuration without reading display data', () => {
		const captured = event({ logo_path: '/public/PRIVATE_LOGO.svg' });
		captured.locals.snapshot = {
			...captured.locals.snapshot,
			get display(): never {
				throw new Error('Root layout must not read display data');
			}
		};
		expect(load(captured)).toEqual({ faviconPath: '/favicon.svg', logoPath: '/logo' });
	});

	it('preserves the immutable request capture when a later request gets a replacement', () => {
		const captured = event({ favicon_path: '/public/PRIVATE_ICON.svg' });
		const snapshot = captured.locals.snapshot;
		const before = JSON.stringify(snapshot);
		const data = load(captured);
		const replacement = event();
		expect(load(replacement)).not.toEqual(data);
		expect(load(captured)).toEqual(data);
		expect(data).toEqual({ faviconPath: '/favicon', logoPath: '/favicon.svg' });
		expect(captured.locals.snapshot).toBe(snapshot);
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(JSON.stringify(snapshot)).toBe(before);
	});
});
