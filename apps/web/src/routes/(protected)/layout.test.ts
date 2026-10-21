import { validateConfig } from '@directory/config';
import { describe, expect, it } from 'vitest';
import { prepareSnapshot } from '../../lib/server/config/snapshot.js';
import { load } from './+layout.server.js';

function event(primary_light_color = '#13579b', primary_dark_color = '#c4d6e8') {
	const snapshot = prepareSnapshot(
		validateConfig(
			{
				site: {
					title: 'PRIVATE_LAYOUT_TITLE',
					logo_path: '/public/PRIVATE_LOGO.svg',
					favicon_path: '/public/PRIVATE_FAVICON.svg'
				},
				appearance: { primary_light_color, primary_dark_color },
				auth: { credentials: { username: 'PRIVATE_USERNAME', password: 'PRIVATE_PASSWORD' } },
				links: {
					private: { title: 'PRIVATE_LINK', url: 'https://private.example.test' }
				}
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

describe('protected appearance layout data', () => {
	it('allowlists only two color inputs without mutating or returning the source object', () => {
		const captured = event();
		const snapshot = captured.locals.snapshot;
		const appearance = { ...snapshot.display.appearance, source: 'PRIVATE_APPEARANCE_SOURCE' };
		captured.locals.snapshot = {
			...snapshot,
			display: { ...snapshot.display, appearance }
		};
		const before = JSON.stringify(captured.locals);
		const data = load(captured);

		expect(data).toEqual({
			appearance: { primary_light_color: '#13579b', primary_dark_color: '#c4d6e8' }
		});
		expect(data.appearance).not.toBe(appearance);
		expect(JSON.stringify(data)).not.toContain('PRIVATE_');
		expect(JSON.stringify(data)).not.toContain('2099-01-01');
		expect(JSON.stringify(captured.locals)).toBe(before);
	});

	it('selects the captured display inputs, not private configuration colors', () => {
		const captured = event();
		const replacement = event('#abc', '#def');
		captured.locals.snapshot = {
			...replacement.locals.snapshot,
			display: captured.locals.snapshot.display
		};
		expect(load(captured)).toEqual({
			appearance: { primary_light_color: '#13579b', primary_dark_color: '#c4d6e8' }
		});
	});

	it('keeps the request capture immutable when a later request receives a replacement', () => {
		const captured = event();
		const snapshot = captured.locals.snapshot;
		const before = JSON.stringify(snapshot);
		const data = load(captured);
		const replacement = event('#abc', '#def');

		expect(load(replacement)).toEqual({
			appearance: { primary_light_color: '#abc', primary_dark_color: '#def' }
		});
		expect(load(captured)).toEqual(data);
		expect(data).toEqual({
			appearance: { primary_light_color: '#13579b', primary_dark_color: '#c4d6e8' }
		});
		expect(captured.locals.snapshot).toBe(snapshot);
		expect(Object.isFrozen(snapshot.display.appearance)).toBe(true);
		expect(JSON.stringify(snapshot)).toBe(before);
	});
});
