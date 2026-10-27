import { createHash } from 'node:crypto';
import type { Renderer } from '@takumi-rs/core';
import { fromHtml } from '@takumi-rs/helpers/html';
import bundledFavicon from '../../../../static/favicon.png?inline';
import template from './open-graph.html?raw';

interface OpenGraphBranding {
	readonly url: string;
	readonly title: string;
	readonly description?: string | undefined;
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
	const title = boundedText(branding.title, 80);
	const description = boundedText(branding.description ?? '', 160);
	const favicon = branding.favicon ?? defaultFavicon;
	const key = createHash('sha256')
		.update(
			JSON.stringify([
				title,
				description,
				branding.url,
				branding.primaryLightColor,
				branding.primaryDarkColor
			])
		)
		.update(favicon)
		.digest('hex');
	if (cached?.key === key) return cached.image;

	const pending = draw(title, description, branding, favicon);
	cached = { key, image: pending };
	try {
		return await pending;
	} catch (error) {
		if (cached?.image === pending) cached = undefined;
		throw error;
	}
}

async function draw(
	title: string,
	description: string,
	branding: OpenGraphBranding,
	favicon: Uint8Array<ArrayBuffer>
) {
	const engine = await (renderer ??= import('@takumi-rs/core').then(
		({ Renderer }) => new Renderer({ cacheMaxBytes: 8 * 1024 * 1024 })
	));
	let fontSize = 88;
	if (title.length > 40) fontSize = 52;
	else if (title.length > 20) fontSize = 68;
	if (description) fontSize -= 16;
	const { node, css } = fromHtml(
		template
			.replaceAll('{{light}}', fullHex(branding.primaryLightColor))
			.replaceAll('{{dark}}', fullHex(branding.primaryDarkColor))
			.replaceAll('{{fontSize}}', String(fontSize))
			.replaceAll('{{gap}}', description ? '20' : '28')
			.replace(/\{\{(title|description|url)\}\}/g, (_match, field: string) => {
				if (field === 'url') return escapeHtml(branding.url);
				if (field === 'title') return escapeHtml(title);
				if (!description) return '';
				return `<div class="description">${escapeHtml(description)}</div>`;
			})
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

function boundedText(value: string, limit: number): string {
	const characters = Array.from(value.replace(/\s+/gu, ' ').trim());
	if (characters.length <= limit) return characters.join('');
	return characters.slice(0, limit - 1).join('') + '…';
}

function fullHex(color: string): string {
	if (color.length === 4) return '#' + color.slice(1).replace(/./g, '$&$&');
	return color;
}

function escapeHtml(value: string): string {
	return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
