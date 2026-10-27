import { createHash } from 'node:crypto';
import type { Renderer } from '@takumi-rs/core';
import { fromHtml } from '@takumi-rs/helpers/html';
import bundledFavicon from '../../../../static/favicon.png?inline';
import template from './open-graph.html?raw';

interface OpenGraphBranding {
	readonly title: string;
	readonly primaryLightColor: string;
	readonly primaryDarkColor: string;
	readonly favicon?: Uint8Array<ArrayBuffer> | undefined;
}

const defaultFavicon = Buffer.from(bundledFavicon.slice(bundledFavicon.indexOf(',') + 1), 'base64');
let renderer: Promise<Renderer> | undefined;
let cached: { key: string; image: Promise<Uint8Array<ArrayBuffer>> } | undefined;

export async function renderOpenGraph(
	branding: OpenGraphBranding
): Promise<Uint8Array<ArrayBuffer>> {
	const title = boundedTitle(branding.title);
	const favicon = branding.favicon ?? defaultFavicon;
	const key = createHash('sha256')
		.update(JSON.stringify([title, branding.primaryLightColor, branding.primaryDarkColor]))
		.update(favicon)
		.digest('hex');
	if (cached?.key === key) return cached.image;

	const pending = draw(title, branding, favicon);
	cached = { key, image: pending };
	try {
		return await pending;
	} catch (error) {
		if (cached?.image === pending) cached = undefined;
		throw error;
	}
}

async function draw(title: string, branding: OpenGraphBranding, favicon: Uint8Array<ArrayBuffer>) {
	const engine = await (renderer ??= import('@takumi-rs/core').then(
		({ Renderer }) => new Renderer({ cacheMaxBytes: 8 * 1024 * 1024 })
	));
	let fontSize = 88;
	if (title.length > 40) fontSize = 52;
	else if (title.length > 20) fontSize = 68;
	const { node, css } = fromHtml(
		template
			.replaceAll('{{light}}', fullHex(branding.primaryLightColor))
			.replaceAll('{{dark}}', fullHex(branding.primaryDarkColor))
			.replaceAll('{{fontSize}}', String(fontSize))
			.replace('{{title}}', () => escapeHtml(title))
			.replace(/>\s+</g, '><')
			.trim()
	);
	const render = (icon: Uint8Array<ArrayBuffer>) =>
		engine.render(node, {
			width: 1200,
			height: 630,
			format: 'png',
			css,
			images: [{ src: 'favicon', data: icon }]
		});
	try {
		return await render(favicon);
	} catch (error) {
		if (favicon === defaultFavicon) throw error;
		return render(defaultFavicon);
	}
}

function boundedTitle(title: string): string {
	const characters = Array.from(title.replace(/\s+/gu, ' ').trim());
	if (characters.length <= 80) return characters.join('');
	return characters.slice(0, 79).join('') + '…';
}

function fullHex(color: string): string {
	if (color.length === 4) return '#' + color.slice(1).replace(/./g, '$&$&');
	return color;
}

function escapeHtml(value: string): string {
	return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
