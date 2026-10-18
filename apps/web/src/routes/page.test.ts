import { validateConfig } from '@where/config';
import { describe, expect, it } from 'vitest';
import { prepareSnapshot } from '../lib/server/config/snapshot.js';
import { load } from './+page.server.js';

describe('directory shell', () => {
	it('reads site copy from the request snapshot and excludes private data and links', () => {
		const snapshot = prepareSnapshot(
			validateConfig(
				{
					site: { title: 'Home Server', description: 'Useful things running at home.' },
					auth: { credentials: { username: 'PRIVATE_USERNAME', password: 'PRIVATE_PASSWORD' } },
					links: { photos: { title: 'PRIVATE_LINK', url: 'https://photos.example.com' } }
				},
				{ env: {} }
			)
		);
		const data = load({ locals: { snapshot } } as Parameters<typeof load>[0]);
		expect(data).toEqual({
			title: 'Home Server',
			description: 'Useful things running at home.',
			configurationVersion: 1
		});
		expect(JSON.stringify(data)).not.toContain('PRIVATE_');
	});
});
