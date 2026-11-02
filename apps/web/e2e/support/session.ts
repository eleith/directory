import { applySetCookies } from 'better-auth/cookies';

/** Carry the complete native login cookie jar, including any chunked cookies. */
export function responseCookieHeader(response: Response): string {
	const headers = new Headers();
	applySetCookies(headers, response.headers.getSetCookie());
	return headers.get('cookie') ?? '';
}
