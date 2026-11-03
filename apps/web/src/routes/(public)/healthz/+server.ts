import type { RequestHandler } from '@sveltejs/kit';

export const GET = (() =>
	Response.json(
		{ status: 'ok' },
		{ headers: { 'cache-control': 'no-store' } }
	)) satisfies RequestHandler;
