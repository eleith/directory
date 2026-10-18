import { describe, expect, it } from 'vitest';
import { GET } from './+server.js';

describe('readiness response', () => {
	it('returns only generic status, without configuration or paths', async () => {
		const response = GET();
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('content-type')).toContain('application/json');
		expect(await response.json()).toEqual({ status: 'ok' });
	});
});
