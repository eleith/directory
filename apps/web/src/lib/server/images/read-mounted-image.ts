import { constants } from 'node:fs';
import { open, realpath, stat, type FileHandle } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { BigIntStats } from 'node:fs';
import { matchesImageFormat } from './image-format.js';

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

export async function readMountedImage(
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
		if (!matchesImageFormat(bytes, extension)) return undefined;
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
