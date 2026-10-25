import { json, type RequestHandler } from '@sveltejs/kit';

export const GET = (({ locals }) =>
	json(
		{ snapshotId: locals.snapshot.display.snapshotId },
		{ headers: { 'cache-control': 'private, no-store' } }
	)) satisfies RequestHandler;
