import { createHash } from 'node:crypto';
import { Avatar, Style } from '@dicebear/core';
import type { DirectoryConfiguration } from '@directory/config/types';
import initials from './initials-style.json';

const style = new Style(initials);
const backgrounds = ['#dbeafe', '#dcfce7', '#fef3c7', '#fce7f3', '#ede9fe', '#cffafe'];

export function renderBookmarkLogos(config: DirectoryConfiguration): Record<string, string> {
	return Object.fromEntries(
		Object.entries(config.links).map(([id, link]) => {
			const identity = link.group === undefined ? `link:${id}` : `named:${link.group}`;
			const colorIndex = createHash('sha256').update(identity).digest().readUInt32BE(0);
			const background = backgrounds[colorIndex % backgrounds.length]!;
			const svg = new Avatar(style, {
				seed: initialsSeed(link.title, id),
				backgroundColor: [background],
				textColor: ['#1f2937'],
				initialsVariant: ['alt'],
				lettersVariant: ['double'],
				size: 64,
				idRandomization: false
			}).toString();
			return [id, svg];
		})
	);
}

function initialsSeed(title: string, id: string): string {
	// DiceBear limits seeds to 1,024 Unicode characters and ignores text after @.
	const titleSeed = Array.from(title.split('@', 1)[0]!).slice(0, 1024).join('');
	if (/\p{L}/u.test(titleSeed)) return titleSeed;
	const slugSeed = Array.from(id).slice(0, 1024).join('');
	if (/\p{L}/u.test(slugSeed)) return slugSeed;
	return 'Directory';
}
