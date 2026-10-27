export interface DocumentMetadata {
	title: string;
	description: string;
	url: string;
	image: {
		url: string;
		type: string;
		width?: number;
		height?: number;
	};
}

export function documentMetadata(
	site: { title: string; description: string },
	origin: string,
	supplied?: { path: string; contentType: string }
): DocumentMetadata {
	let image: DocumentMetadata['image'];
	if (supplied) {
		image = {
			url: new URL(supplied.path, origin).href,
			type: supplied.contentType
		};
	} else {
		image = {
			url: new URL('/images/og.png', origin).href,
			type: 'image/png',
			width: 1200,
			height: 630
		};
	}
	return {
		title: site.title,
		description: site.description,
		url: new URL('/', origin).href,
		image
	};
}
