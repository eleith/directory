import { configurationVersion } from '@directory/config';
import type { PageServerLoad } from './$types.js';

export const load = (({ locals }) => ({
	title: locals.snapshot.display.site.title,
	description: locals.snapshot.display.site.description,
	configurationVersion
})) satisfies PageServerLoad;
