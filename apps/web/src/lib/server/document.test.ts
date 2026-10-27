import { describe, expect, it } from 'vitest';
import { documentMetadata } from './document.js';

describe('document metadata', () => {
	it('publishes the title, description and generated PNG with its known dimensions', () => {
		expect(
			documentMetadata(
				{ title: 'Home & family', description: 'Public site description' },
				'https://directory.example'
			)
		).toEqual({
			title: 'Home & family',
			description: 'Public site description',
			url: 'https://directory.example/',
			image: {
				url: 'https://directory.example/images/og.png',
				type: 'image/png',
				width: 1200,
				height: 630
			}
		});
	});

	it.each([
		{ name: 'public text', description: 'Public site description' },
		{ name: 'empty text', description: '' },
		{ name: 'whitespace', description: ' \t\n ' },
		{
			name: 'full, unescaped text',
			description: `  <Home> & "family" 'notes'\n${'Full text. '.repeat(200)}  `
		}
	])('preserves the public site description object with $name', ({ description }) => {
		const site = { title: '<Home> & "family"', description };
		const before = { ...site };
		const metadata = documentMetadata(site, 'https://directory.example');
		expect(metadata).toMatchObject(site);
		expect(site).toEqual(before);
	});

	it.each(['png', 'jpeg', 'svg+xml', 'gif', 'webp'])(
		'links a supplied image with its actual MIME type image/%s and no guessed dimensions',
		(format) => {
			const metadata = documentMetadata(
				{ title: 'Home', description: '' },
				'http://localhost:3000',
				{
					path: '/public/images/café family.svg',
					contentType: `image/${format}`
				}
			);
			expect(metadata.image).toEqual({
				url: 'http://localhost:3000/public/images/caf%C3%A9%20family.svg',
				type: `image/${format}`
			});
		}
	);
});
