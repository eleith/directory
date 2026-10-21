import { expect, type Page } from '@playwright/test';

export async function watchSearchStability(page: Page) {
	const imageRequests: string[] = [];
	page.on('request', (request) => {
		if (request.resourceType() === 'image') imageRequests.push(request.url());
	});
	const observation = await page.evaluateHandle(() => {
		const groups = document.querySelector('.groups')!;
		const status = document.querySelector('[role="status"]')!;
		const tiles = Array.from(groups.querySelectorAll('a.tile'));
		const images = tiles.map((tile) => tile.querySelector('img'));
		const marker = document.createElement('span');
		marker.dataset.noScriptMarker = 'same-document';
		document.body.append(marker);
		const bounds = () => tiles.map((tile) => tile.getBoundingClientRect().toJSON());
		const originalBounds = bounds();
		const statuses: string[] = [];
		let removedTiles = 0;
		let groupedIntervals = 0;
		const observer = new MutationObserver((records) => {
			statuses.push(status.textContent?.trim() ?? '');
			for (const record of records) {
				for (const removed of record.removedNodes) {
					if (!(removed instanceof Element)) continue;
					removedTiles += Number(removed.matches('a.tile'));
					removedTiles += removed.querySelectorAll('a.tile').length;
				}
			}
			if (groups.querySelector('section')) groupedIntervals++;
		});
		observer.observe(groups, { childList: true, subtree: true });
		observer.observe(status, { childList: true, subtree: true, characterData: true });
		return {
			read() {
				const currentTiles = Array.from(groups.querySelectorAll('a.tile'));
				return {
					tilesRetained:
						currentTiles.length === tiles.length &&
						currentTiles.every((tile, index) => tile === tiles[index]),
					imagesRetained: currentTiles.every(
						(tile, index) => tile.querySelector('img') === images[index]
					),
					boundsStable: JSON.stringify(bounds()) === JSON.stringify(originalBounds),
					gridY: groups.getBoundingClientRect().y,
					status: status.textContent?.trim(),
					statuses: [...statuses],
					removedTiles,
					groupedIntervals,
					documentRetained: marker.isConnected && document.body.contains(marker)
				};
			},
			stop() {
				observer.disconnect();
				marker.remove();
			}
		};
	});
	return {
		async read() {
			return {
				...(await observation.evaluate((watch) => watch.read())),
				imageRequests: [...imageRequests]
			};
		},
		async expectStable() {
			const state = await this.read();
			expect(state.tilesRetained).toBe(true);
			expect(state.imagesRetained).toBe(true);
			expect(state.boundsStable).toBe(true);
			expect(state.documentRetained).toBe(true);
			expect(state.removedTiles).toBe(0);
			expect(state.imageRequests).toEqual([]);
			return state;
		},
		async stop() {
			await observation.evaluate((watch) => watch.stop());
			await observation.dispose();
		}
	};
}
