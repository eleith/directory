import { isRedirect, type RequestEvent } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { logger } from '../logger.js';
import { isSignInError, localRedirect, signInLocation } from './redirect.js';
import { hasExpectedOrigin } from './request.js';

type HandleInput = Parameters<Handle>[0];

export interface AccessPolicy {
	readonly origin: string;
	readonly strategy: 'credentials' | 'oidc';
}

export async function protectAuthRequest(
	{ event, resolve }: HandleInput,
	policy: AccessPolicy
): Promise<Response> {
	let response: Response;
	if (!hasExpectedOrigin(event, policy.origin)) {
		response = denied(403);
	} else if (isUnsafeMethod(event) && event.request.headers.get('origin') !== policy.origin) {
		response = denied(403);
	} else if (isRawAuthPath(event) && !isOidcCallback(event, policy)) {
		response = denied(404);
	} else {
		try {
			response = await resolve(event);
		} catch (failure) {
			if (isRedirect(failure)) {
				response = new Response(null, {
					status: failure.status,
					headers: { location: failure.location }
				});
			} else {
				logger.error('Authentication request failed (auth_request_failed).');
				response = denied(500);
			}
		}
	}
	const headers = new Headers(response.headers);
	const location = headers.get('location');
	if (location && isSignInError(location, policy.origin)) {
		const destination = new URL(location, policy.origin);
		const callbackUrl = localRedirect(destination.searchParams.get('callbackUrl'), policy.origin);
		let error = 'signin';
		if (
			policy.strategy === 'credentials' &&
			destination.searchParams.get('error') === 'credentials'
		) {
			error = 'credentials';
		}
		headers.set('location', `${signInLocation(callbackUrl)}&error=${error}`);
	}
	headers.set('cache-control', 'private, no-store');
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}

export async function requireSignIn(
	{ event, resolve }: HandleInput,
	policy: AccessPolicy
): Promise<Response> {
	event.locals.session = null;
	const routeId = event.route.id ?? '';
	const publicRoute = isInGroup(routeId, '/(public)');
	if (publicRoute) return resolve(event);
	try {
		event.locals.session = await event.locals.auth();
	} catch {
		logger.error('Authentication session failed (auth_session_failed).');
		return denied(401);
	}
	if (event.locals.session?.user) return resolve(event);
	const endpoint = isInGroup(routeId, '/(protected)/(endpoints)');
	if (!endpoint && isHtmlNavigation(event)) {
		const callbackUrl = localRedirect(event.url.pathname + event.url.search, policy.origin);
		return new Response(null, {
			status: 303,
			headers: { location: signInLocation(callbackUrl) }
		});
	}
	return denied(401);
}

function isInGroup(routeId: string, group: string): boolean {
	return routeId === group || routeId.startsWith(`${group}/`);
}

function isUnsafeMethod(event: RequestEvent): boolean {
	return !['GET', 'HEAD', 'OPTIONS'].includes(event.request.method);
}

function isRawAuthPath(event: RequestEvent): boolean {
	return event.url.pathname === '/auth' || event.url.pathname.startsWith('/auth/');
}

function isOidcCallback(event: RequestEvent, policy: AccessPolicy): boolean {
	return (
		policy.strategy === 'oidc' &&
		event.request.method === 'GET' &&
		!event.isDataRequest &&
		event.url.pathname === '/auth/callback/oidc'
	);
}

function isHtmlNavigation(event: RequestEvent): boolean {
	if (event.request.method !== 'GET' || event.isDataRequest) return false;
	const accept = event.request.headers.get('accept') ?? '';
	if (accept.includes('application/json')) return false;
	for (const part of accept.split(',')) {
		const [type, ...parameters] = part.trim().split(';');
		if (type !== 'text/html') continue;
		let excluded = false;
		for (const parameter of parameters) {
			if (/^\s*q=0(?:\.0*)?\s*$/.test(parameter)) {
				excluded = true;
				break;
			}
		}
		if (!excluded) return true;
	}
	return false;
}

function denied(status: number): Response {
	return new Response(status === 404 ? 'Not found' : 'Access denied', { status });
}
