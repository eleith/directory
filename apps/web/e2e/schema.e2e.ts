import editorSchema from '@directory/config/schema.json' with { type: 'json' };
import { expect, test } from '@playwright/test';
import {
	configuration,
	privateSentinels,
	siteDescription,
	siteTitle
} from './support/configuration.js';
import { startServer } from './support/server.js';

test('the production editor schema is public and contains no instance configuration', async () => {
	const server = await startServer({ configuration: configuration() });
	try {
		await server.ready();
		const home = await server.fetch('/', { headers: { accept: 'application/json' } });
		expect(home.status).toBe(401);
		for (const method of ['GET', 'HEAD']) {
			const response = await server.fetch('/schema.json?include=config&path=/private.yaml', {
				method
			});
			expect(response.status).toBe(200);
			expect(response.headers.get('content-type')).toBe('application/schema+json; charset=utf-8');
			expect(response.headers.get('cache-control')).toContain('no-store');
			expect(response.headers.get('x-content-type-options')).toBe('nosniff');
			expect(response.headers.has('location')).toBe(false);
			const text = await response.text();
			if (method === 'HEAD') {
				expect(text).toBe('');
				continue;
			}
			expect(JSON.parse(text)).toEqual(editorSchema);
			for (const value of [
				...privateSentinels,
				siteTitle,
				siteDescription,
				server.path,
				server.origin
			]) {
				expect(text).not.toContain(value);
			}
		}
	} finally {
		expect(await server.stop()).toEqual({ code: 0, signal: null });
	}
});
