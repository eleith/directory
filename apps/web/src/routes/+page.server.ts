import type { PageServerLoad } from './$types.js';

export const load = (() => ({
	title: 'Where',
	description: "A small directory for your family's homelab."
})) satisfies PageServerLoad;
