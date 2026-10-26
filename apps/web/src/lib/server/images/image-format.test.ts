import { describe, expect, it } from 'vitest';
import { matchesImageFormat } from './image-format.js';

const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
const pngHeader = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=',
	'base64'
).subarray(0, 33);
const jpegHeader = Buffer.from([0xff, 0xd8, 0xff]);
const gifHeader = Buffer.concat([Buffer.from('GIF89a'), Buffer.from([1, 0, 1, 0])]);
const webpHeader = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);

describe('image format recognition', () => {
	it.each([
		['.png', svg],
		['.jpg', gifHeader],
		['.gif', webpHeader],
		['.webp', pngHeader],
		['.png', pngHeader.subarray(0, 30)],
		['.gif', gifHeader.subarray(0, 9)],
		['.jpeg', jpegHeader.subarray(0, 2)],
		['.webp', webpHeader.subarray(0, 11)],
		['.png', Buffer.from('<html>not an image</html>')]
	] as const)('rejects mismatched bytes or an incomplete %s header', (extension, bytes) => {
		expect(matchesImageFormat(bytes, extension)).toBe(false);
	});

	it.each([
		['.png', pngHeader],
		['.jpeg', jpegHeader],
		['.gif', gifHeader],
		['.webp', webpHeader]
	] as const)('recognizes %s without requiring complete codec data', (extension, bytes) => {
		expect(matchesImageFormat(bytes, extension)).toBe(true);
	});

	it.each([
		'<svg/>',
		'<!-- first -->\n<!-- second --> <svg/>',
		'<?xml version="1.0"?>\n<svg/>',
		"<?xml version='1.0' encoding='utf-8'?><svg/>",
		'\ufeff<?xml version="1.0" encoding="UTF-8"?>\n<!-- icon -->\n<svg xmlns="http://www.w3.org/2000/svg"><text>Home &amp; family</text></svg>',
		'<svg><text><![CDATA[<hello> & anything]]></text></svg><!-- end & -->',
		'<svg viewBox="0 0 1 1"><path d="M0 0" /></svg>'
	])('recognizes an SVG document with XML prolog/comments', (text) => {
		expect(matchesImageFormat(Buffer.from(text), '.svg')).toBe(true);
	});

	it.each([
		'<html><svg/></html>',
		'<?xml version="1.0"?><!-- icon --><html><svg/></html>',
		'<!-- <svg/> -->',
		'not xml <svg/>',
		'<svgish/>',
		'<svg',
		'<!-- unclosed <svg/>',
		'<?xml version="1.0" <svg/>',
		'<!DOCTYPE svg><svg/>',
		'<!doctype svg><svg/>',
		'<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///private">]><svg>&x;</svg>',
		'<svg><!ENTITY x "value"></svg>',
		'<?xml version="1.0" encoding="ISO-8859-1"?><svg/>',
		'<svg><script/></svg><!DOCTYPE html>'
	])('rejects non-SVG roots, unsupported encodings and DTD/entity markup', (text) => {
		expect(matchesImageFormat(Buffer.from(text), '.svg')).toBe(false);
	});

	it('recognizes an SVG root without validating descendant XML grammar', () => {
		expect(matchesImageFormat(Buffer.from('<svg><path bad=value>&unknown;</svg>'), '.svg')).toBe(
			true
		);
	});

	it('compares magic bytes without masking their high bits', () => {
		const disguised = Buffer.from(gifHeader);
		disguised[0] = disguised[0]! | 0x80;
		expect(matchesImageFormat(disguised, '.gif')).toBe(false);
	});
});
