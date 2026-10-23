import { expect, test, type Page } from '@playwright/test';
import { startServer, type TestServer } from './support/server.js';

let server: TestServer;
const configuration = `site:
  title: Search shortcut fixture
links:
  archive:
    title: Household archive
    url: https://archive.example.test
  books:
    title: Books
    url: https://books.example.test
`;
const search = (page: Page) => page.getByRole('searchbox', { name: 'Search', exact: true });
const theme = (page: Page) =>
	page.getByRole('button', { name: 'Switch to dark theme', exact: true });

test.beforeAll(async () => {
	server = await startServer({ configuration, secret: null, origin: null });
	await server.ready();
});
test.afterAll(async () => {
	expect(await server.stop()).toEqual({ code: 0, signal: null });
});

type ShortcutOptions = Pick<
	KeyboardEventInit,
	| 'key'
	| 'code'
	| 'altKey'
	| 'ctrlKey'
	| 'metaKey'
	| 'shiftKey'
	| 'repeat'
	| 'isComposing'
	| 'keyCode'
	| 'modifierAltGraph'
>;

async function dispatchShortcut(page: Page, options: ShortcutOptions = {}) {
	return page.evaluate((options) => {
		const event = new KeyboardEvent('keydown', {
			bubbles: true,
			cancelable: true,
			composed: true,
			key: '/',
			code: 'Slash',
			altKey: true,
			...options
		});
		let target = document.activeElement;
		while (target?.shadowRoot?.activeElement) target = target.shadowRoot.activeElement;
		return target!.dispatchEvent(event);
	}, options);
}

test('Alt+/ focuses Search, selects the existing query and keeps results stable', async ({
	page
}) => {
	await page.goto(server.url);
	await expect(search(page)).toBeEnabled();
	await expect(search(page)).toHaveAttribute('placeholder', 'Search · Alt+/');
	await expect(search(page)).toHaveAttribute('aria-keyshortcuts', 'Alt+/');
	await page.keyboard.press('Alt+/');
	await expect(search(page)).toBeFocused();
	await search(page).fill('archive');
	const result = page.getByRole('list', { name: 'Search results', exact: true }).getByRole('link');
	await expect(result).toHaveCount(1);
	const original = await result.elementHandle();
	await theme(page).focus();
	await page.keyboard.press('Alt+/');
	await expect(search(page)).toBeFocused();
	await expect(search(page)).toHaveValue('archive');
	expect(
		await search(page).evaluate((node: HTMLInputElement) => [
			node.selectionStart,
			node.selectionEnd
		])
	).toEqual([0, 'archive'.length]);
	expect(await result.evaluate((node, previous) => node === previous, original)).toBe(true);
});

test('Mac hint and Option+/ character use the same focus action', async ({ page }) => {
	await page.addInitScript(() =>
		Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' })
	);
	await page.goto(server.url);
	await expect(search(page)).toHaveAttribute('placeholder', 'Search · ⌥/');
	await expect(search(page)).toHaveAccessibleName('Search');
	await theme(page).focus();
	expect(await dispatchShortcut(page, { key: '÷' })).toBe(false);
	await expect(search(page)).toBeFocused();
	await theme(page).focus();
	expect(await dispatchShortcut(page, { key: '/', code: 'Digit7', shiftKey: true })).toBe(false);
	await expect(search(page)).toBeFocused();
});

test('other modifiers, repeats, IME and handled keys are not consumed', async ({ page }) => {
	await page.goto(server.url);
	await expect(search(page)).toBeEnabled();
	for (const options of [
		{ altKey: false },
		{ ctrlKey: true },
		{ metaKey: true },
		{ shiftKey: true, key: '?' },
		{ key: 'k', code: 'KeyK' },
		{ repeat: true },
		{ isComposing: true },
		{ keyCode: 229 },
		{ modifierAltGraph: true }
	] satisfies ShortcutOptions[]) {
		await theme(page).focus();
		expect(await dispatchShortcut(page, options)).toBe(true);
		await expect(theme(page)).toBeFocused();
	}
	await theme(page).evaluate((node) => {
		const event = new KeyboardEvent('keydown', {
			bubbles: true,
			cancelable: true,
			key: '/',
			altKey: true
		});
		event.preventDefault();
		node.dispatchEvent(event);
	});
	await expect(theme(page)).toBeFocused();
	await search(page).evaluate((node: HTMLInputElement) => {
		node.disabled = true;
	});
	expect(await dispatchShortcut(page)).toBe(true);
	await expect(theme(page)).toBeFocused();
});

test('editing fields and shadow editors retain their keystrokes', async ({ page }) => {
	await page.goto(server.url);
	await expect(search(page)).toBeEnabled();
	await page.evaluate(() => {
		const fields = document.createElement('div');
		fields.innerHTML =
			'<input id="shortcut-input"><textarea id="shortcut-textarea"></textarea><select id="shortcut-select"><option>Choice</option></select><div id="shortcut-content" contenteditable="true">Editable</div><div id="shortcut-role" role="textbox" tabindex="0">Editor</div><div id="shortcut-shadow"></div>';
		document.body.append(fields);
		fields
			.querySelector('#shortcut-shadow')!
			.attachShadow({ mode: 'open' })
			.append(document.createElement('input'));
	});
	for (const selector of [
		'#directory-search',
		'#shortcut-input',
		'#shortcut-textarea',
		'#shortcut-select',
		'#shortcut-content',
		'#shortcut-role',
		'#shortcut-shadow input'
	]) {
		const editor = page.locator(selector);
		await editor.focus();
		expect(await dispatchShortcut(page, { key: '÷' })).toBe(true);
		await expect(editor).toBeFocused();
	}
});

test('an open details dialog keeps focus instead of activating Search', async ({ page }) => {
	await page.goto(server.url);
	await expect(search(page)).toBeEnabled();
	await page.getByRole('link', { name: 'Household archive', exact: true }).click();
	await expect(page.getByRole('dialog')).toBeVisible();
	const external = page.getByRole('link', {
		name: 'Open Household archive (opens in a new tab)',
		exact: true
	});
	await expect(external).toBeFocused();
	const close = page.getByRole('button', { name: 'Close', exact: true });
	const destination = page.getByRole('textbox', { name: 'Destination', exact: true });
	await expect(destination).toHaveJSProperty('readOnly', true);
	for (const control of [external, close, destination]) {
		await control.focus();
		await page.keyboard.press('Alt+/');
		await expect(control).toBeFocused();
		expect(await dispatchShortcut(page)).toBe(true);
		await expect(control).toBeFocused();
	}
});

test('without JavaScript Search remains disabled and ordinary links still work', async ({
	browser
}) => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	try {
		const page = await context.newPage();
		await page.goto(server.url);
		await expect(search(page)).toBeDisabled();
		await page.getByRole('link', { name: 'Household archive', exact: true }).focus();
		expect(await dispatchShortcut(page)).toBe(true);
		await page.keyboard.press('Enter');
		await expect(
			page.getByRole('heading', { name: 'Household archive', exact: true })
		).toBeVisible();
	} finally {
		await context.close();
	}
});
