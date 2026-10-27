import { validateConfig } from '@directory/config';
import { describe, expect, it } from 'vitest';
import { prepareSnapshot } from '../../../../../lib/server/directory/snapshot.js';
import { GET } from './+server.js';

const sentinel = 'PRIVATE-version-endpoint-config';

function snapshot(title: string) {
	return prepareSnapshot(
		validateConfig(
			{
				site: { url: 'https://private-auth.example.test', title, description: sentinel },
				auth: {
					secret: `${sentinel}-session-secret`,
					credentials: { username: sentinel, password: sentinel }
				},
				links: {
					photos: { title: sentinel, url: 'https://private.example.test', tags: [sentinel] }
				}
			},
			{ env: {} }
		)
	);
}

function event(captured: ReturnType<typeof snapshot>) {
	return { locals: { snapshot: captured } } as Parameters<typeof GET>[0];
}

describe('accepted configuration version endpoint', () => {
	it('returns only the captured opaque revision with private no-store caching', async () => {
		const captured = snapshot('Family');
		const response = await GET(event(captured));
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(response.headers.get('content-type')).toContain('application/json');
		const text = await response.text();
		expect(JSON.parse(text)).toEqual({ snapshotId: captured.display.snapshotId });
	});

	it('keeps an older request capture independent of a later snapshot', async () => {
		const first = snapshot('First');
		const next = snapshot('Next');
		const firstResponse = await GET(event(first));
		const nextResponse = await GET(event(next));
		expect(first.display.snapshotId).not.toBe(next.display.snapshotId);
		expect(await firstResponse.json()).toEqual({ snapshotId: first.display.snapshotId });
		expect(await nextResponse.json()).toEqual({ snapshotId: next.display.snapshotId });
	});
});
