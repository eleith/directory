import { describe, expect, it } from 'vitest';
import { load } from './+page.server.js';

describe('bootstrap page', () => {
	it('loads page copy and the compiled package format version for the initial HTML', () => {
		expect(load()).toEqual({
			title: 'Where',
			description: "A small directory for your family's homelab.",
			configurationVersion: 1
		});
	});
});
