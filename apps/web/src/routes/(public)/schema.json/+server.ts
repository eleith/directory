import { json } from '@sveltejs/kit';
import editorSchema from '@directory/config/schema.json' with { type: 'json' };

export function GET(): Response {
	return json(editorSchema, {
		headers: {
			'content-type': 'application/schema+json; charset=utf-8',
			'cache-control': 'no-store'
		}
	});
}
