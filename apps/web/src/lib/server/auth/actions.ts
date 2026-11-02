import { isRedirect, redirect, type RequestEvent } from '@sveltejs/kit';
import { parseSetCookieHeader, toCookieOptions } from 'better-auth/cookies';
import { logger } from '../logger.js';
import type { Auth } from './index.js';
import { localRedirect, signInLocation } from './redirect.js';
import { authenticationHeaders, requireActionOrigin } from './request.js';

export async function signInAction(
	event: RequestEvent,
	auth: Pick<Auth, 'handler'>,
	origin: string,
	strategy: 'credentials' | 'oidc'
): Promise<void> {
	requireActionOrigin(event, origin);
	let callbackUrl = '/';
	try {
		const submitted = await event.request.clone().formData();
		callbackUrl = localRedirect(stringField(submitted, 'redirectTo'), origin);
		let response: Response;
		if (strategy === 'credentials') {
			response = await submitAuth(event, auth, origin, '/sign-in/credentials', {
				username: stringField(submitted, 'username') ?? '',
				password: stringField(submitted, 'password') ?? ''
			});
		} else {
			response = await submitAuth(event, auth, origin, '/sign-in/social', {
				provider: 'oidc',
				callbackURL: callbackUrl,
				errorCallbackURL: signInLocation(callbackUrl, true)
			});
		}
		if (!response.ok) {
			const error =
				strategy === 'credentials' && response.status === 401 ? 'credentials' : 'signin';
			redirect(303, `${signInLocation(callbackUrl)}&error=${error}`);
		}
		if (strategy === 'oidc') {
			// Only the native provider response can choose an external destination.
			const destination = new URL(response.headers.get('location') ?? '');
			if (!['https:', 'http:'].includes(destination.protocol)) {
				throw new Error('Invalid authentication destination.');
			}
			redirect(303, destination.href);
		}
		redirect(303, callbackUrl);
	} catch (failure) {
		handleActionFailure(failure, callbackUrl);
	}
}

export async function signOutAction(
	event: RequestEvent,
	auth: Pick<Auth, 'handler'>,
	origin: string
): Promise<void> {
	requireActionOrigin(event, origin);
	let callbackUrl = '/';
	try {
		const submitted = await event.request.clone().formData();
		callbackUrl = localRedirect(stringField(submitted, 'redirectTo'), origin);
		const response = await submitAuth(event, auth, origin, '/sign-out', {});
		if (!response.ok) redirect(303, signInLocation(callbackUrl, true));
		redirect(303, callbackUrl);
	} catch (failure) {
		handleActionFailure(failure, callbackUrl);
	}
}

async function submitAuth(
	event: RequestEvent,
	auth: Pick<Auth, 'handler'>,
	origin: string,
	path: string,
	body: Record<string, string>
): Promise<Response> {
	const headers = authenticationHeaders(event);
	headers.set('content-type', 'application/json');
	headers.delete('content-length');
	// Use the HTTP handler, not auth.api: native throttling lives in the router.
	const response = await auth.handler(
		new Request(new URL(`/auth${path}`, origin), {
			method: 'POST',
			headers,
			body: JSON.stringify(body)
		})
	);
	// The same native cookie helpers used by sveltekitCookies, without bypassing the router.
	for (const [name, attributes] of parseSetCookieHeader(response.headers.get('set-cookie') ?? '')) {
		event.cookies.set(name, attributes.value, {
			...toCookieOptions(attributes),
			path: attributes.path || '/'
		});
	}
	return response;
}

function handleActionFailure(failure: unknown, callbackUrl: string): never {
	if (isRedirect(failure)) throw failure;
	logger.error('Authentication action failed (auth_action_failed).');
	redirect(303, signInLocation(callbackUrl, true));
}

function stringField(form: FormData, name: string): string | null {
	const values = form.getAll(name);
	if (values.length !== 1) return null;
	const value = values[0];
	return typeof value === 'string' ? value : null;
}
