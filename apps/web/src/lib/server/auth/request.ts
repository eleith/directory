import { error, type RequestEvent } from '@sveltejs/kit';

export const CLIENT_ADDRESS_HEADER = 'x-directory-client-address';

export function authenticationHeaders(
	event: Pick<RequestEvent, 'request' | 'getClientAddress'>
): Headers {
	const headers = new Headers(event.request.headers);
	// The adapter owns client-address/proxy policy. Never trust a browser-supplied IP header.
	headers.set(CLIENT_ADDRESS_HEADER, event.getClientAddress());
	return headers;
}

export function hasExpectedOrigin(event: RequestEvent, origin: string): boolean {
	return event.url.origin === origin && new URL(event.request.url).origin === origin;
}

export function requireActionOrigin(event: RequestEvent, origin: string): void {
	if (
		event.request.method !== 'POST' ||
		!hasExpectedOrigin(event, origin) ||
		event.request.headers.get('origin') !== origin
	) {
		error(403, 'Forbidden');
	}
}
