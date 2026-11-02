import { expect, it, vi } from 'vitest';
import { isRedirect, type RequestEvent } from '@sveltejs/kit';
import { signInAction } from './actions.js';
import { logger } from '../logger.js';

vi.mock('../logger.js', () => ({ logger: { error: vi.fn() } }));

it('keeps unexpected action failures out of logs and redirects', async () => {
	const origin = 'https://directory.example';
	const sentinel = 'private-token-from-native-error';
	const request = new Request(`${origin}/signin`, {
		method: 'POST',
		headers: { origin },
		body: new URLSearchParams({ redirectTo: '/safe' })
	});
	const event = {
		request,
		url: new URL(request.url),
		getClientAddress: () => '192.0.2.1'
	} as RequestEvent;
	const auth = { handler: vi.fn().mockRejectedValue(new Error(sentinel)) };
	const failure: unknown = await signInAction(event, auth, origin, 'credentials').catch(
		(error: unknown) => error
	);

	expect(isRedirect(failure)).toBe(true);
	if (!isRedirect(failure)) throw new Error('Expected a safe action redirect.');
	const location = new URL(failure.location, origin);
	expect(location.origin).toBe(origin);
	expect(location.pathname).toBe('/signin');
	expect(location.searchParams.get('callbackUrl')).toBe('/safe');
	expect(location.searchParams.has('error')).toBe(true);
	expect(failure.location).not.toContain(sentinel);
	expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(sentinel);
});
