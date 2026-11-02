import { expect, it } from 'vitest';
import { authenticationHeaders, CLIENT_ADDRESS_HEADER } from './request.js';

it('uses the adapter address rather than browser-supplied client IP headers', () => {
	const request = new Request('https://directory.example/signin', {
		headers: {
			origin: 'https://another.example',
			[CLIENT_ADDRESS_HEADER]: '198.51.100.1',
			'x-real-ip': '198.51.100.2',
			'x-forwarded-for': '198.51.100.3'
		}
	});
	const headers = authenticationHeaders({
		request,
		getClientAddress: () => '192.0.2.1'
	});

	expect(headers.get(CLIENT_ADDRESS_HEADER)).toBe('192.0.2.1');
	// The browser Origin is evidence for CSRF checks, not something to normalize.
	expect(headers.get('origin')).toBe(request.headers.get('origin'));
	expect(request.headers.get(CLIENT_ADDRESS_HEADER)).toBe('198.51.100.1');
});
