import { describe, expect, it } from 'vitest';
import { documentMetadata } from './document.js';

describe('document metadata', () => {
	it('publishes the title and generated PNG with its known dimensions', () => {
		expect(documentMetadata('Home & family', 'https://directory.example')).toEqual({
			title: 'Home & family',
			url: 'https://directory.example/',
			image: {
				url: 'https://directory.example/images/og.png',
				type: 'image/png',
				width: 1200,
				height: 630
			}
		});
	});

	it.each(['png', 'jpeg', 'svg+xml', 'gif', 'webp'])(
		'links a supplied image with its actual MIME type image/%s and no guessed dimensions',
		(format) => {
			const metadata = documentMetadata('Home', 'http://localhost:3000', {
				path: '/public/images/café family.svg',
				contentType: `image/${format}`
			});
			expect(metadata.image).toEqual({
				url: 'http://localhost:3000/public/images/caf%C3%A9%20family.svg',
				type: `image/${format}`
			});
		}
	);
});
