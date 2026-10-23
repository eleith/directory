import { expect, test } from '@playwright/test';
import { configuration, credentialsAuth } from './support/configuration.js';
import { startServer } from './support/server.js';

function expectBaselineHeaders(response: Response) {
	expect(response.headers.get('x-content-type-options')).toBe('nosniff');
	expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
}

for (const authentication of ['none', 'credentials'] as const) {
	test(`baseline headers cover application responses without changing static caching (${authentication})`, async () => {
		let auth = '';
		let pagePath = '/';
		let dataPath = '/__data.json';
		if (authentication === 'credentials') {
			auth = credentialsAuth;
			pagePath = '/signin';
			dataPath = '/signin/__data.json';
		}
		const server = await startServer({ configuration: configuration(auth) });
		try {
			await server.ready();
			const html = await server.fetch(pagePath, { headers: { accept: 'text/html' } });
			expect(html.status).toBe(200);
			expectBaselineHeaders(html);
			expect(html.headers.get('content-security-policy')).toBeTruthy();
			if (authentication === 'credentials') {
				expect(html.headers.get('cache-control')).toBe('private, no-store');
			} else {
				const cacheControl = html.headers.get('cache-control') ?? '';
				expect(cacheControl).not.toContain('private');
				expect(cacheControl).not.toContain('no-store');
			}
			const markup = await html.text();
			const data = await server.fetch(dataPath);
			expect(data.status).toBe(200);
			expect(data.headers.get('content-type')).toContain('application/json');
			expectBaselineHeaders(data);
			const health = await server.fetch('/healthz', { method: 'HEAD' });
			expect(health.status).toBe(200);
			expect(await health.text()).toBe('');
			expectBaselineHeaders(health);
			const missing = await server.fetch('/unknown', { headers: { accept: 'application/json' } });
			expect(missing.status).toBe(authentication === 'credentials' ? 401 : 404);
			expectBaselineHeaders(missing);
			if (authentication === 'credentials') {
				const redirect = await server.fetch('/', { headers: { accept: 'text/html' } });
				expect(redirect.status).toBe(303);
				expect(new URL(redirect.headers.get('location')!, server.url).pathname).toBe('/signin');
				expectBaselineHeaders(redirect);
			}
			const scriptPath = markup.match(/_app\/immutable\/[^"'\s]+\.js/)?.[0];
			expect(scriptPath).toBeDefined();
			for (const method of ['GET', 'HEAD']) {
				const script = await server.fetch(`/${scriptPath!}`, { method });
				expect(script.status).toBe(200);
				expect(script.headers.get('content-type')).toContain('javascript');
				expect(script.headers.get('cache-control')).toContain('immutable');
				expect(script.headers.get('cache-control')).not.toContain('private');
				expect(script.headers.get('cache-control')).not.toContain('no-store');
				if (method === 'HEAD') expect(await script.text()).toBe('');
			}
		} finally {
			await server.stop();
		}
	});
}
