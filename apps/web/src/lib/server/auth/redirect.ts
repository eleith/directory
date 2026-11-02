export function localRedirect(
	value: string | null | undefined,
	origin: string,
	fallback = '/'
): string {
	if (!value) return fallback;
	try {
		const url = new URL(value, origin);
		if (url.origin !== origin || url.username || url.password) return fallback;
		// A same-origin URL can still become protocol-relative when serialized as a path.
		if (url.pathname.startsWith('//')) return fallback;
		return url.pathname + url.search + url.hash;
	} catch {
		return fallback;
	}
}

export function isSignInError(location: string, origin: string): boolean {
	try {
		const url = new URL(location, origin);
		return url.origin === origin && url.pathname === '/signin' && url.searchParams.has('error');
	} catch {
		return false;
	}
}

export function signInLocation(callbackUrl: string, failed = false): string {
	const query = new URLSearchParams({ callbackUrl });
	if (failed) query.set('error', 'signin');
	return `/signin?${query}`;
}
