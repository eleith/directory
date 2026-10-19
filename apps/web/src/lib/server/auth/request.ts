import { error, type RequestEvent } from '@sveltejs/kit';

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
