import { Renderer, type Node } from '@takumi-rs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const branding = {
	title: 'Home Server',
	primaryLightColor: '#0f766e',
	primaryDarkColor: '#5eead4'
};

beforeEach(() => vi.resetModules());
afterEach(() => vi.restoreAllMocks());

async function loadRenderOpenGraph() {
	return (await import('./render-open-graph.js')).renderOpenGraph;
}

function expectPng(bytes: Uint8Array) {
	const png = Buffer.from(bytes);
	expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
	expect(png.readUInt32BE(16)).toBe(1200);
	expect(png.readUInt32BE(20)).toBe(630);
}

function textContent(node: Node): string {
	if (node.type === 'text') return node.text;
	if (node.type === 'container') return (node.children ?? []).map(textContent).join('');
	return '';
}

describe('generated Open Graph images', () => {
	it('renders a PNG with the same bundled folder favicon used by the app', async () => {
		const generate = await loadRenderOpenGraph();
		const bytes = await generate(branding);
		expectPng(bytes);
		const pixels = await new Renderer().render(
			{ type: 'image', src: bytes, width: 1200, height: 630 },
			{ width: 1200, height: 630, format: 'raw' }
		);
		let yellow = 0;
		for (let offset = 0; offset < pixels.length; offset += 4) {
			if (pixels[offset]! > 230 && pixels[offset + 1]! > 150 && pixels[offset + 2]! < 130) yellow++;
		}
		expect(yellow).toBeGreaterThan(1000);
	});

	it('uses supplied favicon bytes and both appearance colors', async () => {
		const generate = await loadRenderOpenGraph();
		const original = await generate(branding);
		const favicon = new TextEncoder().encode(
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#c026d3"/></svg>'
		);
		expect(await generate({ ...branding, favicon })).not.toEqual(original);
		expect(await generate({ ...branding, primaryLightColor: '#b45309' })).not.toEqual(original);
		expect(await generate({ ...branding, primaryDarkColor: '#fbbf24' })).not.toEqual(original);
	});

	it('deduplicates simultaneous renders and retains only the most recent image', async () => {
		const generate = await loadRenderOpenGraph();
		const draw = vi.spyOn(Renderer.prototype, 'render');
		const [first, second] = await Promise.all([generate(branding), generate(branding)]);
		expect(first).toBe(second);
		expect(await generate(branding)).toBe(first);
		expect(draw).toHaveBeenCalledTimes(1);
		await generate({ ...branding, title: 'Another home' });
		await generate(branding);
		expect(draw).toHaveBeenCalledTimes(3);
	});

	it('invalidates by favicon bytes rather than filesystem path or config revision', async () => {
		const generate = await loadRenderOpenGraph();
		const draw = vi.spyOn(Renderer.prototype, 'render');
		const icon = (color: string) =>
			new TextEncoder().encode(
				`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="${color}" d="M0 0h64v64H0z"/></svg>`
			);
		const first = await generate({ ...branding, favicon: icon('#ec4899') });
		expect(await generate({ ...branding, favicon: icon('#ec4899') })).toBe(first);
		expect(await generate({ ...branding, favicon: icon('#2563eb') })).not.toEqual(first);
		expect(draw).toHaveBeenCalledTimes(2);
	});

	it('retries with the bundled mark when the renderer rejects a supplied favicon', async () => {
		const generate = await loadRenderOpenGraph();
		const draw = vi.spyOn(Renderer.prototype, 'render');
		draw.mockRejectedValueOnce(new Error('PRIVATE_DECODER_ERROR'));
		expectPng(await generate({ ...branding, favicon: new Uint8Array([1, 2, 3]) }));
		expect(draw).toHaveBeenCalledTimes(2);
	});

	it('does not permanently cache a failed render', async () => {
		const generate = await loadRenderOpenGraph();
		vi.spyOn(Renderer.prototype, 'render').mockRejectedValueOnce(new Error('Rendering failed'));
		await expect(generate(branding)).rejects.toThrow('Rendering failed');
		expectPng(await generate(branding));
	});

	it('passes the title as escaped text, not HTML or template substitutions', async () => {
		const generate = await loadRenderOpenGraph();
		const draw = vi.spyOn(Renderer.prototype, 'render');
		const title = '<img src="https://example.test"> & {{dark}} $&';
		await generate({ ...branding, title });
		expect(textContent(draw.mock.calls[0]![0] as Node)).toBe(title);
	});

	it('bounds long titles and keeps their layout on the card', async () => {
		const generate = await loadRenderOpenGraph();
		const draw = vi.spyOn(Renderer.prototype, 'render');
		await generate({ ...branding, title: 'W'.repeat(2000) });
		const call = draw.mock.calls[0]!;
		expect(textContent(call[0] as Node)).toBe('W'.repeat(79) + '…');
		const layout = await new Renderer().measure(call[0], call[1]);
		expect(layout.children[1]!.height).toBeLessThanOrEqual(240);
	});

	it('does not fetch remote images or fonts', async () => {
		const fetch = vi.spyOn(globalThis, 'fetch');
		const generate = await loadRenderOpenGraph();
		await generate(branding);
		expect(fetch).not.toHaveBeenCalled();
	});
});
