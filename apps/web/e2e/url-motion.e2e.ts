import { expect, test, type Page } from '@playwright/test';
import { clientManifest, directoryScript, navigateQuery } from './support/details.js';
import { startServer, type TestServer } from './support/server.js';

const engineScript = '/' + clientManifest['src/lib/search/engine.ts']!.file;
const configuration = `site:
  title: URL and motion fixture
  footer: Ask the household maintainer.
links:
  archive:
    title: Family archive
    url: https://archive.example.test/
    group: Media
    tags: family photos, backup
    requires_auth: true
  travel:
    title: Travel albums
    url: https://travel.example.test/
    group: Media
    tags: travel
  shared:
    title: Shared albums
    url: https://shared.example.test/
    group: Records
    tags: family photos
`;
let server: TestServer;

const search = (page: Page) => page.getByRole('searchbox', { name: 'Search', exact: true });
const dialog = (page: Page) => page.locator('section[role="dialog"]');
const overlay = (page: Page) => page.locator('[data-dialog-overlay]');
const archiveTile = (page: Page) => page.locator('a.tile[href^="/?link=archive"]');
const archiveAction = (page: Page) =>
	page.getByRole('link', { name: 'Open Family archive (opens in a new tab)', exact: true });

async function pauseDetailMotion(page: Page, state: 'open' | 'closed') {
	await page.evaluate((state) => {
		const pause = () => {
			const elements = document.querySelectorAll(
				`[data-dialog-overlay][data-state="${state}"], section[role="dialog"][data-state="${state}"]`
			);
			const animations = [...elements].flatMap((element) => element.getAnimations());
			if (animations.length !== 2) return;
			for (const animation of animations) {
				if (!(animation instanceof CSSAnimation)) return;
				animation.pause();
				animation.currentTime = Number(animation.effect!.getTiming().duration) / 2;
			}
			observer.disconnect();
		};
		// Pause before painting, rather than racing a delayed animationstart event.
		const observer = new MutationObserver(pause);
		observer.observe(document.body, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ['data-state']
		});
		pause();
	}, state);
}

async function completeDetailMotion(page: Page) {
	await page.evaluate(async () => {
		const elements = document.querySelectorAll('[data-dialog-overlay], section[role="dialog"]');
		const animations = [...elements].flatMap((element) => element.getAnimations());
		for (const animation of animations) {
			animation.playbackRate = 10;
			animation.play();
		}
		await Promise.all(animations.map((animation) => animation.finished));
	});
}

async function expectPausedMotion(page: Page) {
	await expect
		.poll(() =>
			page.evaluate(() => {
				const elements = document.querySelectorAll('[data-dialog-overlay], section[role="dialog"]');
				const animations = [...elements].flatMap((element) => element.getAnimations());
				return (
					animations.length === 2 &&
					animations.every((animation) => animation.playState === 'paused')
				);
			})
		)
		.toBe(true);
}

test.beforeAll(async () => {
	server = await startServer({ configuration, secret: null, origin: null });
	await server.ready();
});
test.afterAll(async () => {
	expect(await server.stop()).toEqual({ code: 0, signal: null });
});

test('normal and exact queries survive reload and sharing, with native query-preserving new-tab links and Clear', async ({
	page,
	context
}) => {
	await page.goto(server.url);
	await expect(search(page)).toBeEnabled();
	const historyLength = await page.evaluate(() => history.length);
	await search(page).pressSequentially('archive');
	await expect(page).toHaveURL(`${server.url}/?q=archive`);
	expect(await page.evaluate(() => history.length)).toBe(historyLength);
	for (const [query, titles] of [
		['archive', ['Family archive']],
		['tag:family photos', ['Family archive', 'Shared albums']]
	] as [string, string[]][]) {
		await search(page).fill(query);
		const parameters = new URLSearchParams({ q: query });
		await expect(page).toHaveURL(`${server.url}/?${parameters}`);
		await expect(page.locator('.tile-title')).toHaveText(titles);
		const detailParameters = new URLSearchParams({ link: 'archive', q: query });
		await expect(archiveTile(page)).toHaveAttribute('href', `/?${detailParameters}`);
		await page.reload();
		await expect(search(page)).toHaveValue(query);
		await expect(search(page)).not.toBeFocused();
		await expect(page.locator('.tile-title')).toHaveText(titles);
		const shared = await context.newPage();
		try {
			await shared.goto(page.url());
			await expect(search(shared)).toHaveValue(query);
			await expect(search(shared)).not.toBeFocused();
			await expect(shared.locator('.tile-title')).toHaveText(titles);
		} finally {
			await shared.close();
		}
	}
	const href = '/?link=archive&q=tag%3Afamily+photos';
	await expect(archiveTile(page)).toHaveAttribute('href', href);
	await expect(archiveTile(page)).toHaveAttribute('data-sveltekit-preload-data', 'off');
	for (const options of [
		{ modifiers: ['Control'] as ['Control'] },
		{ button: 'middle' as const }
	]) {
		const opened = context.waitForEvent('page');
		await archiveTile(page).click(options);
		const popup = await opened;
		try {
			await expect(popup).toHaveURL(server.url + href);
			await expect(
				popup.getByRole('dialog', { name: 'Family archive', exact: true })
			).toBeVisible();
		} finally {
			await popup.close();
		}
		await expect(page).toHaveURL(`${server.url}/?q=tag%3Afamily+photos`);
		await expect(dialog(page)).toHaveCount(0);
	}
	const beforeClear = await page.evaluate(() => history.length);
	await page.getByRole('button', { name: 'Clear search', exact: true }).click();
	await expect(page).toHaveURL(`${server.url}/`);
	expect(await page.evaluate(() => history.length)).toBe(beforeClear);
	await expect(search(page)).toBeFocused();
	await expect(archiveTile(page)).toHaveAttribute('href', '/?link=archive');
	await expect(page.locator('.groups h2')).toHaveText(['Media', 'Records']);
});

test('ordinary query Back and Forward follow the URL; direct close preserves q even for a nonmatching selection', async ({
	page
}) => {
	await page.goto(`${server.url}/?q=archive`);
	await expect(page.locator('.tile-title')).toHaveText(['Family archive']);
	await navigateQuery(page, '/?q=tag%3Afamily+photos');
	await expect(page.locator('.tile-title')).toHaveText(['Family archive', 'Shared albums']);
	await page.goBack();
	await expect(page).toHaveURL(`${server.url}/?q=archive`);
	await expect(search(page)).toHaveValue('archive');
	await expect(page.locator('.tile-title')).toHaveText(['Family archive']);
	await page.goForward();
	await expect(search(page)).toHaveValue('tag:family photos');
	await expect(page.locator('.tile-title')).toHaveText(['Family archive', 'Shared albums']);
	await page.goto(`${server.url}/?link=travel&q=archive`);
	await expect(page.getByRole('dialog', { name: 'Travel albums', exact: true })).toBeVisible();
	const historyLength = await page.evaluate(() => history.length);
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(dialog(page)).toHaveCount(0);
	await expect(page).toHaveURL(`${server.url}/?q=archive`);
	expect(await page.evaluate(() => history.length)).toBe(historyLength);
	await expect(search(page)).toHaveValue('archive');
	await expect(page.locator('.tile-title')).toHaveText(['Family archive']);
	await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
});

test('chip queries wait for the outro; rapid Forward cancels the old query and focus completion', async ({
	page
}) => {
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await page.goto(`${server.url}/?q=archive`);
	await expect(page.locator('.tile-title')).toHaveText(['Family archive']);
	await pauseDetailMotion(page, 'closed');
	await archiveTile(page).click();
	await expect(archiveAction(page)).toBeFocused();
	await page.getByRole('button', { name: 'Filter by tag: family photos', exact: true }).click();
	await expect(dialog(page)).toHaveAttribute('data-state', 'closed');
	await expectPausedMotion(page);
	await expect(page).toHaveURL(`${server.url}/?q=archive`);
	await expect(search(page)).toHaveValue('archive');
	await expect(search(page)).not.toBeFocused();
	await page.goForward();
	await expect(page).toHaveURL(`${server.url}/?link=archive&q=archive`);
	await expect(dialog(page)).toHaveAttribute('data-state', 'open');
	await completeDetailMotion(page);
	await expect(archiveAction(page)).toBeFocused();
	await expect(dialog(page)).toHaveCount(1);
	await expect(search(page)).toHaveValue('archive');
	await pauseDetailMotion(page, 'closed');
	await page.goBack();
	await expect(dialog(page)).toHaveAttribute('data-state', 'closed');
	await expectPausedMotion(page);
	await completeDetailMotion(page);
	await expect(dialog(page)).toHaveCount(0);
	await expect(archiveTile(page)).toBeFocused();
	await expect(page).toHaveURL(`${server.url}/?q=archive`);
	await expect(search(page)).toHaveValue('archive');
	await page.goto(`${server.url}/?link=archive&q=archive`);
	await expect(archiveAction(page)).toBeFocused();
	await pauseDetailMotion(page, 'closed');
	const historyLength = await page.evaluate(() => history.length);
	await page.getByRole('button', { name: 'Filter by tag: family photos', exact: true }).click();
	await expect(dialog(page)).toHaveAttribute('data-state', 'closed');
	await expectPausedMotion(page);
	await expect(page).toHaveURL(`${server.url}/?q=archive`);
	await expect(search(page)).not.toBeFocused();
	await completeDetailMotion(page);
	await expect(dialog(page)).toHaveCount(0);
	await expect(page).toHaveURL(`${server.url}/?q=tag%3Afamily+photos`);
	await expect(search(page)).toHaveValue('tag:family photos');
	await expect(search(page)).toBeFocused();
	await expect(page.locator('.tile-title')).toHaveText(['Family archive', 'Shared albums']);
	expect(await page.evaluate(() => history.length)).toBe(historyLength);
});

test('held direct hydration shows only the directory, then one animated modal with no plain-card flash', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	const release = Promise.withResolvers<void>();
	const requested = Promise.withResolvers<void>();
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => {
		if (/hydration/i.test(message.text())) errors.push(message.text());
	});
	await page.route(`**${directoryScript}`, async (route) => {
		requested.resolve();
		await release.promise;
		await route.continue();
	});
	try {
		const response = await page.goto(`${server.url}/?link=archive&q=tag%3Afamily+photos`, {
			waitUntil: 'commit'
		});
		const html = await response!.text();
		expect(html).toMatch(/<noscript\b[^>]*>[\s\S]*Back to directory[\s\S]*<\/noscript>/);
		await requested.promise;
		await expect(search(page)).toBeDisabled();
		await expect(page.locator('.tile')).toHaveCount(3);
		await expect(page.locator('section.details')).toHaveCount(0);
		await expect(page.getByRole('region', { name: 'Family archive', exact: true })).toHaveCount(0);
		await expect(dialog(page)).toHaveCount(0);
		await pauseDetailMotion(page, 'open');
		release.resolve();
		await expectPausedMotion(page);
		await expect(dialog(page)).toHaveCount(1);
		await expect(dialog(page)).toHaveAttribute('data-state', 'open');
		await expect(dialog(page)).toHaveCSS('animation-name', /card-fade-in$/);
		await expect(dialog(page)).toHaveCSS('animation-duration', '0.15s');
		await expect(dialog(page)).toHaveCSS('animation-timing-function', 'ease-out');
		const opacity = await dialog(page).evaluate((node) => Number(getComputedStyle(node).opacity));
		expect(opacity).toBeGreaterThan(0);
		expect(opacity).toBeLessThan(1);
		await expect(overlay(page)).toHaveCSS('animation-name', /backdrop-fade-in$/);
		await expect(page.getByRole('link', { name: 'Back to directory', exact: true })).toHaveCount(0);
		await completeDetailMotion(page);
		await expect(archiveAction(page)).toBeFocused();
		await expect(page.locator('.tile-title')).toHaveText(['Family archive', 'Shared albums']);
		expect(errors).toEqual([]);
	} finally {
		release.resolve();
		await page.unrouteAll({ behavior: 'wait' });
	}
});

test('every dismissal retains inert closed content through its real outro; reduced motion removes it immediately', async ({
	page
}) => {
	for (const [dismissal, width] of [
		['Close', 360],
		['Escape', 1280],
		['tag', 360],
		['backdrop', 1280],
		['Back', 1280]
	] as const) {
		await page.setViewportSize({ width, height: 900 });
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await page.goto(`${server.url}/?q=archive`);
		await expect(page.locator('.tile-title')).toHaveText(['Family archive']);
		await pauseDetailMotion(page, 'closed');
		await archiveTile(page).click();
		await expect(archiveAction(page)).toBeFocused();
		await completeDetailMotion(page);
		if (dismissal === 'Close')
			await page.getByRole('button', { name: 'Close', exact: true }).click();
		if (dismissal === 'Escape') await page.keyboard.press('Escape');
		if (dismissal === 'tag')
			await page.getByRole('button', { name: 'Filter by tag: family photos', exact: true }).click();
		if (dismissal === 'backdrop') await overlay(page).click({ position: { x: 5, y: 5 } });
		if (dismissal === 'Back') await page.goBack();
		await expect(dialog(page)).toHaveAttribute('data-state', 'closed');
		await expect(overlay(page)).toHaveAttribute('data-state', 'closed');
		await expectPausedMotion(page);
		await expect(dialog(page)).toHaveJSProperty('inert', true);
		await expect(dialog(page)).toContainText('Family archive');
		await expect(dialog(page)).toHaveCSS(
			'animation-name',
			width === 360 ? /sheet-slide-down$/ : /card-fade-out$/
		);
		await expect(dialog(page)).toHaveCSS('animation-duration', width === 360 ? '0.2s' : '0.15s');
		await expect(dialog(page)).toHaveCSS('animation-timing-function', 'ease-in');
		await expect(overlay(page)).toHaveCSS('animation-name', /backdrop-fade-out$/);
		await expect(overlay(page)).toHaveCSS('animation-duration', '0.15s');
		await expect(overlay(page)).toHaveCSS('animation-timing-function', 'ease-in');
		await expect(search(page)).not.toBeFocused();
		await expect(archiveTile(page)).not.toBeFocused();
		await expect(page).toHaveURL(`${server.url}/?q=archive`);
		await completeDetailMotion(page);
		await expect(dialog(page)).toHaveCount(0);
		await expect(overlay(page)).toHaveCount(0);
		if (dismissal === 'tag') {
			await expect(page).toHaveURL(`${server.url}/?q=tag%3Afamily+photos`);
			await expect(search(page)).toBeFocused();
			await page.goForward();
			await expect(page).toHaveURL(`${server.url}/?link=archive&q=archive`);
			await expect(search(page)).toHaveValue('archive');
			await expect(archiveAction(page)).toBeFocused();
			await completeDetailMotion(page);
			await pauseDetailMotion(page, 'closed');
			await page.goBack();
			await expect(dialog(page)).toHaveAttribute('data-state', 'closed');
			await expectPausedMotion(page);
			await completeDetailMotion(page);
			await expect(dialog(page)).toHaveCount(0);
			await expect(page).toHaveURL(`${server.url}/?q=tag%3Afamily+photos`);
			await expect(archiveTile(page)).toBeFocused();
		} else {
			await expect(archiveTile(page)).toBeFocused();
		}
	}
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.goto(`${server.url}/?q=archive`);
	await expect(page.locator('.tile-title')).toHaveText(['Family archive']);
	await archiveTile(page).click();
	await expect(archiveAction(page)).toBeFocused();
	await expect(dialog(page)).toHaveCSS('animation-name', 'none');
	await expect(overlay(page)).toHaveCSS('animation-name', 'none');
	await page.evaluate(() => {
		document.addEventListener('animationstart', (event) => {
			const element = event.target;
			if (element instanceof HTMLElement && element.dataset.state === 'closed')
				document.documentElement.dataset.detailExitAnimation = event.animationName;
		});
	});
	await page.keyboard.press('Escape');
	await expect(dialog(page)).toHaveCount(0);
	await expect(overlay(page)).toHaveCount(0);
	await expect(archiveTile(page)).toBeFocused();
	await expect(page.locator('html')).not.toHaveAttribute('data-detail-exit-animation');
});

test('positive counts and keyboard help stay announced but occupy no visible feedback space', async ({
	page
}) => {
	const release = Promise.withResolvers<void>();
	const requested = Promise.withResolvers<void>();
	await page.route(`**${engineScript}`, async (route) => {
		requested.resolve();
		await release.promise;
		await route.continue();
	});
	try {
		await page.goto(server.url);
		await expect(search(page)).toBeEnabled();
		const before = (await page.locator('.groups').boundingBox())!;
		await search(page).click();
		await requested.promise;
		await expect(page.getByRole('status')).toBeEmpty();
		expect(await page.locator('.groups').boundingBox()).toEqual(before);
		await search(page).fill('tag:family photos');
		const status = page.getByRole('status');
		await expect(status).toHaveText('Loading search…');
		expect((await status.locator('p').boundingBox())!.height).toBeGreaterThan(1);
		release.resolve();
		await expect(page.locator('.tile-title')).toHaveText(['Family archive', 'Shared albums']);
		await expect(status).toHaveText('2 bookmarks found.');
		const results = page.getByRole('list', { name: 'Search results', exact: true });
		await expect(results).toHaveAttribute('aria-describedby', 'search-keyboard-hint');
		await expect(results).toHaveAccessibleDescription(
			'Use Tab or arrow keys to move, Enter for details, Escape to return to Search.'
		);
		for (const text of [status.locator('p'), page.locator('#search-keyboard-hint')]) {
			await expect(text).toHaveCSS('position', 'absolute');
			await expect(text).toHaveCSS('clip-path', 'inset(50%)');
			expect((await text.boundingBox())!.height).toBe(1);
		}
		const feedback = page.locator('.search-feedback');
		expect((await feedback.boundingBox())!.height).toBe(0);
		await expect(feedback).toHaveCSS('margin-block-end', '0px');
		await search(page).fill('archive');
		await expect(status).toHaveText('1 bookmark found.');
		await expect(status.locator('p')).toHaveCSS('clip-path', 'inset(50%)');
		expect((await feedback.boundingBox())!.height).toBe(0);
		await search(page).fill('tag:missing');
		await expect(status).toHaveText('No bookmarks found.');
		await expect(status.locator('p')).toBeVisible();
		expect((await status.locator('p').boundingBox())!.height).toBeGreaterThan(1);
		await expect(feedback).not.toHaveCSS('margin-block-end', '0px');
	} finally {
		release.resolve();
		await page.unrouteAll({ behavior: 'wait' });
	}
});
