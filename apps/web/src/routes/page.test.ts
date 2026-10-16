import { describe, expect, it } from 'vitest';
import { load } from './+page.server.js';

describe('bootstrap page', () => {
	it('loads the title and description for the initial HTML', () => {
		expect(load()).toEqual({
			title: 'Where',
			description: "A small directory for your family's homelab."
		});
	});
});
