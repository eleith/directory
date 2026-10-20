import { constants } from 'node:fs';
import { open, realpath, stat, type FileHandle } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { BigIntStats } from 'node:fs';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

interface ImageFile {
	bytes: Uint8Array<ArrayBuffer>;
	contentType: string;
}

const imageTypes: Readonly<Record<string, string>> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.svg': 'image/svg+xml'
};

function contained(root: string, target: string): boolean {
	const path = relative(root, target);
	return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function sameDirectory(before: BigIntStats, after: BigIntStats): boolean {
	return (
		before.isDirectory() &&
		after.isDirectory() &&
		before.dev === after.dev &&
		before.ino === after.ino
	);
}

function sameFileContent(before: BigIntStats, after: BigIntStats): boolean {
	return (
		before.dev === after.dev &&
		before.ino === after.ino &&
		before.size === after.size &&
		before.mtimeNs === after.mtimeNs &&
		before.ctimeNs === after.ctimeNs
	);
}

export async function readImage(
	publicDir: string,
	publicPath: string
): Promise<ImageFile | undefined> {
	if (!publicPath.startsWith('/public/') || /[%\\?#]/.test(publicPath)) return undefined;
	for (const character of publicPath) {
		const code = character.codePointAt(0)!;
		if (code < 32 || code === 127) return undefined;
	}
	const segments = publicPath.slice('/public/'.length).split('/');
	if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
		return undefined;
	}
	const extension = extname(publicPath).toLowerCase();
	const contentType = imageTypes[extension];
	if (!contentType) return undefined;

	let file: FileHandle | undefined;
	let image: ImageFile | undefined;
	try {
		const root = await realpath(publicDir);
		const rootBefore = await stat(root, { bigint: true });
		if (!rootBefore.isDirectory()) return undefined;
		const candidate = await realpath(resolve(root, ...segments));
		if (!contained(root, candidate)) return undefined;
		file = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
		const before = await file.stat({ bigint: true });
		if (!before.isFile() || before.size <= 0n || before.size > BigInt(MAX_IMAGE_BYTES)) {
			return undefined;
		}
		// Linux deployment: validate the opened inode, not a second pathname lookup.
		const openedPath = await realpath(`/proc/self/fd/${file.fd}`);
		if (!contained(root, openedPath)) return undefined;

		const buffer = Buffer.allocUnsafe(Number(before.size) + 1);
		let length = 0;
		while (length < buffer.length) {
			const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
			if (bytesRead === 0) break;
			length += bytesRead;
			if (length > Number(before.size)) return undefined;
		}
		const after = await file.stat({ bigint: true });
		const rootAfter = await stat(root, { bigint: true });
		if (
			length !== Number(before.size) ||
			!sameFileContent(before, after) ||
			!sameDirectory(rootBefore, rootAfter)
		) {
			return undefined;
		}
		const bytes = buffer.subarray(0, length);
		if (!matchesImage(bytes, extension)) return undefined;
		image = { bytes: new Uint8Array(bytes), contentType };
	} catch {
		return undefined;
	} finally {
		try {
			await file?.close();
		} catch {
			image = undefined;
		}
	}
	return image;
}

function matchesImage(bytes: Buffer, extension: string): boolean {
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
