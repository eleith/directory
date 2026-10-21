import type { LayoutServerLoad } from './$types.js';

export const load = (({ locals }) => {
	const { primary_light_color, primary_dark_color } = locals.snapshot.display.appearance;
	return { appearance: { primary_light_color, primary_dark_color } };
}) satisfies LayoutServerLoad;
