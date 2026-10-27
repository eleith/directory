import { validateConfig } from '@directory/config';
import { describe, expect, it } from 'vitest';
import { themeStyleTag } from './appearance.js';
import { prepareSnapshot } from './directory/snapshot.js';

function snapshot(light: string, dark: string) {
	return prepareSnapshot(
		validateConfig(
			{
				site: {
					url: 'https://private-auth.example.test',
					title: 'PRIVATE_TITLE',
					description: 'PRIVATE_DESCRIPTION',
					logo_path: '/public/PRIVATE_LOGO.svg'
				},
				appearance: { primary_light_color: light, primary_dark_color: dark },
				auth: {
					secret: 'PRIVATE_SESSION_SECRET_AT_LEAST_32_CHARACTERS',
					credentials: { username: 'PRIVATE_USERNAME', password: 'PRIVATE_PASSWORD' }
				},
				links: { private: { title: 'PRIVATE_LINK', url: 'https://private.example.test' } }
			},
			{ env: {} }
		)
	);
}

describe('server-owned theme style', () => {
	it.each([
		['#13579b', '#c4d6e8', '#ffffff', '#000000'],
		['#abc', '#13579b', '#171717', '#f5f5f5'],
		['#000', '#fff', '#ffffff', '#000000'],
		['#fff', '#000', '#171717', '#f5f5f5']
	])(
		'emits only semantic primary and readable foreground pairs for %s / %s',
		(light, dark, onLight, onDark) => {
			const captured = snapshot(light, dark);
			const before = JSON.stringify(captured);
			const style = themeStyleTag(captured.display.appearance);
			expect(style).toBe(
				`<style>:root{--color-primary:light-dark(${light},${dark});--color-on-primary:light-dark(${onLight},${onDark})}</style>`
			);
			expect(Object.isFrozen(captured.display.appearance)).toBe(true);
			expect(JSON.stringify(captured)).toBe(before);
		}
	);

	it('selects only the two published colors, without traversing extra appearance fields', () => {
		const appearance = {
			primary_light_color: '#abc',
			primary_dark_color: '#13579b',
			get font_path(): never {
				throw new Error('Theme must not read fonts');
			},
			get configuration(): never {
				throw new Error('Theme must not traverse configuration');
			}
		};
		expect(themeStyleTag(appearance)).toBe(
			'<style>:root{--color-primary:light-dark(#abc,#13579b);--color-on-primary:light-dark(#171717,#f5f5f5)}</style>'
		);
	});

	it('keeps a captured theme unchanged after another snapshot is published', () => {
		const captured = snapshot('#13579b', '#c4d6e8');
		const before = JSON.stringify(captured);
		const style = themeStyleTag(captured.display.appearance);
		const replacement = snapshot('#abc', '#def');
		expect(themeStyleTag(replacement.display.appearance)).not.toBe(style);
		expect(themeStyleTag(captured.display.appearance)).toBe(style);
		expect(JSON.stringify(captured)).toBe(before);
	});
});
