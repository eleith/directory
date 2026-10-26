import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { mkdtemp, mkdir, open, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_IMAGE_BYTES, readMountedImage } from './read-mounted-image.js';

vi.mock('node:fs/promises', async (original) => {
	const fs = await original<typeof import('node:fs/promises')>();
	return { ...fs, open: vi.fn(fs.open), realpath: vi.fn(fs.realpath) };
});

const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>');
const png = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=',
	'base64'
);
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const jpeg = Buffer.from(
	'/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==',
	'base64'
);
const webp = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
let directory: string;
let root: string;
let handles: FileHandle[];

beforeEach(async () => {
	vi.mocked(realpath).mockReset().mockImplementation(fs.realpath);
	vi.mocked(open)
		.mockReset()
		.mockImplementation(async (...args) => {
			const file = await fs.open(...args);
			handles.push(file);
			return file;
		});
	handles = [];
	directory = await mkdtemp(join(tmpdir(), 'directory-assets-'));
	root = join(directory, 'public');
	await mkdir(root);
});

afterEach(async () => {
	for (const handle of handles) {
		expect(handle.fd).toBe(-1);
	}
	vi.restoreAllMocks();
	await rm(directory, { recursive: true, force: true });
});

async function put(name: string, bytes: string | Uint8Array = svg) {
	await writeFile(join(root, name), bytes);
}

describe('bounded mounted images', () => {
	it.each([
		['icon.png', png, 'image/png'],
		['icon.JPG', jpeg, 'image/jpeg'],
		['icon.jpeg', jpeg, 'image/jpeg'],
		['icon.gif', gif, 'image/gif'],
		['icon.webp', webp, 'image/webp'],
		['icon.SVG', svg, 'image/svg+xml']
	] as const)(
		'reads supported %s bytes into an owned ArrayBuffer',
		async (name, bytes, contentType) => {
			await put(name, bytes);
			const image = await readMountedImage(root, `/public/${name}`);
			expect(image?.contentType).toBe(contentType);
			expect(image?.bytes).toEqual(new Uint8Array(bytes));
			expect(image?.bytes.buffer).toBeInstanceOf(ArrayBuffer);
			expect(image?.bytes.byteLength).toBe(image?.bytes.buffer.byteLength);
			expect(open).toHaveBeenCalledWith(
				join(root, name),
				constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
			);
		}
	);

	it('accepts decoded Unicode/spaces, and nested paths without decoding again', async () => {
		await mkdir(join(root, 'family'));
		await put('family/café icon.svg');
		expect(await readMountedImage(root, '/public/family/café icon.svg')).toBeDefined();
		expect(await readMountedImage(root, '/public/family/caf%C3%A9%20icon.svg')).toBeUndefined();
	});

	it.each([
		'/public/',
		'/public/../outside.svg',
		'/public/a/../../outside.svg',
		'/public/./icon.svg',
		'/public//icon.svg',
		'/public/a\\icon.svg',
		'/public/icon.svg?x',
		'/public/icon.svg#x',
		'/public/icon.svg\n',
		'/public/icon\0.svg',
		'/other/icon.svg',
		'/public/icon.txt',
		'/public/%252e.svg'
	])('rejects unsafe path %j before filesystem access', async (path) => {
		expect(await readMountedImage(root, path)).toBeUndefined();
		expect(realpath).not.toHaveBeenCalled();
		expect(open).not.toHaveBeenCalled();
	});

	it('returns undefined for absent roots/images, directories, empty files and unreadable opens', async () => {
		expect(await readMountedImage(join(directory, 'absent'), '/public/icon.svg')).toBeUndefined();
		expect(await readMountedImage(root, '/public/missing.svg')).toBeUndefined();
		await mkdir(join(root, 'folder.svg'));
		expect(await readMountedImage(root, '/public/folder.svg')).toBeUndefined();
		await put('empty.svg', '');
		expect(await readMountedImage(root, '/public/empty.svg')).toBeUndefined();
		await put('icon.svg');
		vi.mocked(open).mockRejectedValueOnce(
			Object.assign(new Error('PRIVATE_PATH'), { code: 'EACCES' })
		);
		expect(await readMountedImage(root, '/public/icon.svg')).toBeUndefined();
	});

	it('allows symlinks inside the canonical root, including a symlinked root', async () => {
		await put('icon.svg');
		await symlink('icon.svg', join(root, 'alias.svg'));
		await symlink(root, join(directory, 'mounted'));
		expect(await readMountedImage(join(directory, 'mounted'), '/public/alias.svg')).toBeDefined();
	});

	it('rejects sibling-prefix escape and ancestor symlinks outside the root', async () => {
		const sibling = `${root}-private`;
		await mkdir(sibling);
		await writeFile(join(sibling, 'secret.svg'), svg);
		await symlink(join(sibling, 'secret.svg'), join(root, 'escape.svg'));
		await symlink(sibling, join(root, 'outside'));
		expect(await readMountedImage(root, '/public/escape.svg')).toBeUndefined();
		expect(await readMountedImage(root, '/public/outside/secret.svg')).toBeUndefined();
		expect(open).not.toHaveBeenCalled();
	});

	it('does not block on a FIFO and closes its descriptor', async () => {
		await promisify(execFile)('mkfifo', [join(root, 'pipe.svg')]);
		expect(await readMountedImage(root, '/public/pipe.svg')).toBeUndefined();
	}, 2000);

	it('accepts exactly the byte cap and rejects oversized bytes', async () => {
		const exact = Buffer.concat([
			Buffer.from('<svg>'),
			Buffer.alloc(MAX_IMAGE_BYTES - 11, 32),
			Buffer.from('</svg>')
		]);
		await put('exact.svg', exact);
		expect((await readMountedImage(root, '/public/exact.svg'))?.bytes.length).toBe(MAX_IMAGE_BYTES);
		await put('large.svg', Buffer.concat([exact, Buffer.from(' ')]));
		expect(await readMountedImage(root, '/public/large.svg')).toBeUndefined();
	});

	it.each(['grow', 'shrink', 'rewrite'] as const)(
		'rejects an ordinary concurrent %s on the same opened descriptor',
		async (change) => {
			await put('icon.svg');
			const normalOpen = vi.mocked(open).getMockImplementation()!;
			vi.mocked(open).mockImplementationOnce(async (...args) => {
				const file = await normalOpen(...args);
				const originalStat = file.stat.bind(file);
				vi.spyOn(file, 'stat').mockImplementationOnce(async () => {
					const before = await originalStat({ bigint: true });
					if (change === 'grow')
						await fs.appendFile(join(root, 'icon.svg'), ' '.repeat(MAX_IMAGE_BYTES));
					if (change === 'shrink') await fs.truncate(join(root, 'icon.svg'), 1);
					if (change === 'rewrite')
						await writeFile(join(root, 'icon.svg'), Buffer.alloc(svg.length, 32));
					return before;
				});
				return file;
			});
			expect(await readMountedImage(root, '/public/icon.svg')).toBeUndefined();
		}
	);

	it('rejects changed metadata even when the read bytes were a valid image', async () => {
		await put('icon.svg');
		const normalOpen = vi.mocked(open).getMockImplementation()!;
		vi.mocked(open).mockImplementationOnce(async (...args) => {
			const file = await normalOpen(...args);
			const originalStat = file.stat.bind(file);
			vi.spyOn(file, 'stat')
				.mockImplementationOnce(() => originalStat({ bigint: true }))
				.mockImplementationOnce(async () => {
					await fs.utimes(join(root, 'icon.svg'), new Date(0), new Date(0));
					return originalStat({ bigint: true });
				});
			return file;
		});
		expect(await readMountedImage(root, '/public/icon.svg')).toBeUndefined();
	});

	it('accepts an unrelated directory-entry change while reading an image', async () => {
		await put('icon.svg');
		const normalOpen = vi.mocked(open).getMockImplementation()!;
		vi.mocked(open).mockImplementationOnce(async (...args) => {
			const file = await normalOpen(...args);
			const originalStat = file.stat.bind(file);
			vi.spyOn(file, 'stat')
				.mockImplementationOnce(() => originalStat({ bigint: true }))
				.mockImplementationOnce(async () => {
					await put('unrelated.svg');
					return originalStat({ bigint: true });
				});
			return file;
		});
		expect((await readMountedImage(root, '/public/icon.svg'))?.bytes).toEqual(new Uint8Array(svg));
	});

	it('rejects an ordinary root-directory replacement after opening the image', async () => {
		await put('icon.svg');
		const normalOpen = vi.mocked(open).getMockImplementation()!;
		vi.mocked(open).mockImplementationOnce(async (...args) => {
			const file = await normalOpen(...args);
			const originalStat = file.stat.bind(file);
			vi.spyOn(file, 'stat')
				.mockImplementationOnce(() => originalStat({ bigint: true }))
				.mockImplementationOnce(async () => {
					await rename(root, `${root}-old`);
					await mkdir(root);
					await put('icon.svg');
					return originalStat({ bigint: true });
				});
			return file;
		});
		expect(await readMountedImage(root, '/public/icon.svg')).toBeUndefined();
	});

	it('checks the opened fd after a controlled ancestor swap outside the root', async () => {
		await mkdir(join(root, 'icons'));
		await put('icons/icon.svg');
		const outside = join(directory, 'outside');
		await mkdir(outside);
		await writeFile(join(outside, 'icon.svg'), svg);
		vi.mocked(realpath)
			.mockImplementationOnce(fs.realpath)
			.mockImplementationOnce(async (path) => {
				const candidate = await fs.realpath(path);
				await rename(join(root, 'icons'), join(root, 'old-icons'));
				await symlink(outside, join(root, 'icons'));
				return candidate;
			});
		expect(await readMountedImage(root, '/public/icons/icon.svg')).toBeUndefined();
		expect(handles).toHaveLength(1);
	});

	it('rejects a final-component symlink swapped in after realpath', async () => {
		await put('icon.svg');
		await put('other.svg');
		vi.mocked(realpath)
			.mockImplementationOnce(fs.realpath)
			.mockImplementationOnce(async (path) => {
				const candidate = await fs.realpath(path);
				await rm(join(root, 'icon.svg'));
				await symlink('other.svg', join(root, 'icon.svg'));
				return candidate;
			});
		expect(await readMountedImage(root, '/public/icon.svg')).toBeUndefined();
		expect(handles).toHaveLength(0);
	});

	it('fails closed when proc fd lookup is unavailable, without reopening', async () => {
		await put('icon.svg');
		vi.mocked(realpath)
			.mockImplementationOnce(fs.realpath)
			.mockImplementationOnce(fs.realpath)
			.mockRejectedValueOnce(new Error('proc unavailable'));
		expect(await readMountedImage(root, '/public/icon.svg')).toBeUndefined();
		expect(open).toHaveBeenCalledTimes(1);
	});

	it('rejects an image when closing its descriptor reports an error', async () => {
		await put('icon.svg');
		const normalOpen = vi.mocked(open).getMockImplementation()!;
		vi.mocked(open).mockImplementationOnce(async (...args) => {
			const file = await normalOpen(...args);
			const close = file.close.bind(file);
			vi.spyOn(file, 'close').mockImplementationOnce(async () => {
				await close();
				throw new Error('PRIVATE_CLOSE_FAILURE');
			});
			return file;
		});
		expect(await readMountedImage(root, '/public/icon.svg')).toBeUndefined();
	});

	it('closes on read and post-open stat errors', async () => {
		await put('icon.svg');
		const normalOpen = vi.mocked(open).getMockImplementation()!;
		vi.mocked(open).mockImplementationOnce(async (...args) => {
			const file = await normalOpen(...args);
			vi.spyOn(file, 'read').mockRejectedValueOnce(new Error('read failed'));
			return file;
		});
		expect(await readMountedImage(root, '/public/icon.svg')).toBeUndefined();
		vi.mocked(open).mockImplementationOnce(async (...args) => {
			const file = await normalOpen(...args);
			vi.spyOn(file, 'stat').mockRejectedValueOnce(new Error('stat failed'));
			return file;
		});
		expect(await readMountedImage(root, '/public/icon.svg')).toBeUndefined();
	});
});

describe('extension-matched image headers', () => {
	it.each([
		['icon.png', svg],
		['icon.svg', png],
		['icon.jpg', gif],
		['icon.gif', webp],
		['icon.webp', jpeg],
		['icon.png', png.subarray(0, 30)],
		['icon.gif', gif.subarray(0, 9)],
		['icon.jpeg', jpeg.subarray(0, 2)],
		['icon.webp', webp.subarray(0, 11)],
		['icon.png', Buffer.from('<html>not an image</html>')]
	])('rejects disguised bytes or an incomplete header for %s', async (name, bytes) => {
		await put(name, bytes);
		expect(await readMountedImage(root, `/public/${name}`)).toBeUndefined();
	});

	it.each([
		['icon.png', png.subarray(0, 33)],
		['icon.jpeg', jpeg.subarray(0, 3)],
		['icon.gif', gif.subarray(0, 10)],
		['icon.webp', webp.subarray(0, 12)]
	])('recognizes %s without requiring complete codec data', async (name, bytes) => {
		await put(name, bytes);
		expect((await readMountedImage(root, `/public/${name}`))?.bytes).toEqual(new Uint8Array(bytes));
	});

	it.each([
		'<svg/>',
		'<!-- first -->\n<!-- second --> <svg/>',
		'<?xml version="1.0"?>\n<svg/>',
		"<?xml version='1.0' encoding='utf-8'?><svg/>",
		'\ufeff<?xml version="1.0" encoding="UTF-8"?>\n<!-- icon -->\n<svg xmlns="http://www.w3.org/2000/svg"><text>Home &amp; family</text></svg>',
		'<svg><text><![CDATA[<hello> & anything]]></text></svg><!-- end & -->',
		'<svg viewBox="0 0 1 1"><path d="M0 0" /></svg>'
	])('recognizes an SVG document with XML prolog/comments', async (text) => {
		await put('icon.svg', text);
		expect(await readMountedImage(root, '/public/icon.svg')).toBeDefined();
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
	])('rejects non-SVG roots, unsupported encodings and DTD/entity markup', async (text) => {
		await put('icon.svg', text);
		expect(await readMountedImage(root, '/public/icon.svg')).toBeUndefined();
	});

	it('recognizes an SVG root without validating descendant XML grammar', async () => {
		await put('icon.svg', '<svg><path bad=value>&unknown;</svg>');
		expect(await readMountedImage(root, '/public/icon.svg')).toBeDefined();
	});

	it('compares magic bytes without masking their high bits', async () => {
		const disguised = Buffer.from(gif);
		disguised[0] = disguised[0]! | 0x80;
		await put('icon.gif', disguised);
		expect(await readMountedImage(root, '/public/icon.gif')).toBeUndefined();
	});

	it('rejects invalid UTF-8 and bounded long non-SVG prefixes', async () => {
		await put(
			'icon.svg',
			Buffer.concat([Buffer.from('<svg>'), Buffer.from([0xff]), Buffer.from('</svg>')])
		);
		expect(await readMountedImage(root, '/public/icon.svg')).toBeUndefined();
		await put('icon.svg', ' '.repeat(MAX_IMAGE_BYTES - 6) + '<html>');
		expect(await readMountedImage(root, '/public/icon.svg')).toBeUndefined();
		await put('icon.svg', '<svg' + ' '.repeat(MAX_IMAGE_BYTES - 4));
		expect(await readMountedImage(root, '/public/icon.svg')).toBeUndefined();
	});
});
