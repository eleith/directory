export function matchesImageFormat(bytes: Buffer, extension: string): boolean {
	switch (extension) {
		case '.png':
			return (
				bytes.length >= 33 &&
				bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
				bytes.readUInt32BE(8) === 13 &&
				bytes.toString('latin1', 12, 16) === 'IHDR' &&
				bytes.readUInt32BE(16) > 0 &&
				bytes.readUInt32BE(20) > 0
			);
		case '.jpg':
		case '.jpeg':
			return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
		case '.gif':
			return (
				bytes.length >= 10 &&
				['GIF87a', 'GIF89a'].includes(bytes.toString('latin1', 0, 6)) &&
				bytes.readUInt16LE(6) > 0 &&
				bytes.readUInt16LE(8) > 0
			);
		case '.webp':
			return (
				bytes.length >= 12 &&
				bytes.toString('latin1', 0, 4) === 'RIFF' &&
				bytes.toString('latin1', 8, 12) === 'WEBP'
			);
		case '.svg':
			return isSvg(bytes);
		default:
			return false;
	}
}

// Recognize trusted operator SVG, not XML validity or safe active content.
function isSvg(bytes: Buffer): boolean {
	let text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimStart();
	if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text)) return false;
	if (/^<\?xml[\t\n\r ]/.test(text)) {
		const end = text.indexOf('?>');
		if (end === -1) return false;
		const declaration = text.slice(0, end);
		const encoding = /\bencoding\s*=\s*(["'])(.*?)\1/i.exec(declaration);
		if (/\bencoding\s*=/i.test(declaration) && encoding?.[2]?.toLowerCase() !== 'utf-8') {
			return false;
		}
		text = text.slice(end + 2).trimStart();
	}
	while (text.startsWith('<!--')) {
		const end = text.indexOf('-->');
		if (end === -1) return false;
		text = text.slice(end + 3).trimStart();
	}
	return /^<svg(?:[\t\n\r ][^<>]*|\/?)>/.test(text);
}
