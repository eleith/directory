import { isRedirect, redirect, type RequestEvent } from '@sveltejs/kit';
import type { SvelteKitAuth } from '@auth/sveltekit';
import { logger } from '../logger.js';
import { isSignInError, localRedirect, signInLocation } from './redirect.js';
import { requireActionOrigin } from './request.js';

type AuthJsHandlers = ReturnType<typeof SvelteKitAuth>;

export async function signInAction(
	event: RequestEvent,
	origin: string,
	strategy: 'credentials' | 'oidc',
	authJs: AuthJsHandlers
): Promise<void> {
	requireActionOrigin(event, origin);
	let callbackUrl = '/';
	try {
		const submitted = await event.request.clone().formData();
		callbackUrl = localRedirect(stringField(submitted, 'redirectTo'), origin);
		const body = new URLSearchParams({ redirectTo: callbackUrl, providerId: strategy });
		if (strategy === 'credentials') {
			body.set('username', stringField(submitted, 'username') ?? '');
			body.set('password', stringField(submitted, 'password') ?? '');
		}
		await authJs.signIn(prepareFormEvent(event, body));
	} catch (failure) {
		handleActionFailure(failure, origin, callbackUrl);
	}
}

export async function signOutAction(
	event: RequestEvent,
	origin: string,
	authJs: AuthJsHandlers
): Promise<void> {
	requireActionOrigin(event, origin);
	let callbackUrl = '/';
	try {
		const submitted = await event.request.clone().formData();
		callbackUrl = localRedirect(stringField(submitted, 'redirectTo'), origin);
		const body = new URLSearchParams({ redirectTo: callbackUrl });
		await authJs.signOut(prepareFormEvent(event, body));
	} catch (failure) {
		handleActionFailure(failure, origin, callbackUrl);
	}
}

function prepareFormEvent(event: RequestEvent, body: URLSearchParams): RequestEvent {
	const headers = new Headers(event.request.headers);
	headers.set('content-type', 'application/x-www-form-urlencoded');
	headers.delete('content-length');
	return {
		...event,
		request: new Request(event.request.url, { method: 'POST', headers, body })
	};
}

function handleActionFailure(failure: unknown, origin: string, callbackUrl: string): never {
	if (isRedirect(failure)) {
		if (isSignInError(failure.location, origin)) redirect(303, signInLocation(callbackUrl, true));
		throw failure;
	}
	logger.error('Authentication action failed (auth_action_failed).');
	redirect(303, signInLocation(callbackUrl, true));
}

function stringField(form: FormData, name: string): string | null {
	const values = form.getAll(name);
	if (values.length !== 1) return null;
	const value = values[0];
	if (typeof value !== 'string') return null;
	return value;
}
