import { describe, expect, it } from 'vitest';
import { isSameConfiguration, validateConfig } from './index.js';

function configuration() {
	return validateConfig({
		site: { title: 'Home', description: 'Household apps' },
		links: {
			photos: { title: 'Photos', url: 'https://photos.example.com' },
			music: { title: 'Music', url: 'https://music.example.com' }
		}
	});
}

describe('isSameConfiguration', () => {
	it('compares independently loaded values without treating ordinary mapping order as a change', () => {
		const previous = configuration();
		const next = validateConfig({
			...previous,
			site: { description: previous.site.description, title: previous.site.title }
		});
		expect(Object.keys(next.site)).not.toEqual(Object.keys(previous.site));
		expect(isSameConfiguration(next, previous)).toBe(true);
		next.site.title = 'Changed';
		expect(isSameConfiguration(next, previous)).toBe(false);
	});

	it('treats bookmark declaration order as a change even when values match', () => {
		const previous = configuration();
		const next = configuration();
		next.links = { music: next.links.music!, photos: next.links.photos! };
		expect(next).toEqual(previous);
		expect(isSameConfiguration(next, previous)).toBe(false);
	});
});
