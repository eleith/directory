<script lang="ts">
	import { page } from '$app/state';
	import { SvelteURL } from 'svelte/reactivity';

	let { snapshotId }: { snapshotId: string | undefined } = $props();
	let documentSnapshotId: string | undefined;
	let updateAvailable = $state(false);
	let refreshHref = $state('');
	const checkInterval = 5_000;
	const requestTimeout = 5_000;
	const maximumRetryDelay = 60_000;
	let checkingEnabled = false;
	let request: AbortController | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let retryDelay = checkInterval;

	$effect(() => {
		const currentURL = new SvelteURL((page.shallow?.url ?? page.url).href);
		currentURL.hash = '';
		refreshHref = currentURL.href;
	});

	$effect(() => {
		if (!snapshotId || updateAvailable) return;
		documentSnapshotId ??= snapshotId;
		return startChecking();
	});

	function startChecking() {
		checkingEnabled = true;
		retryDelay = checkInterval;
		document.addEventListener('visibilitychange', resumeChecking);
		window.addEventListener('focus', resumeChecking);
		window.addEventListener('online', resumeChecking);
		window.addEventListener('offline', pauseChecking);
		void checkForUpdates();
		return stopChecking;
	}

	function stopChecking() {
		checkingEnabled = false;
		pauseChecking();
		document.removeEventListener('visibilitychange', resumeChecking);
		window.removeEventListener('focus', resumeChecking);
		window.removeEventListener('online', resumeChecking);
		window.removeEventListener('offline', pauseChecking);
	}

	function canCheckForUpdates(): boolean {
		if (!checkingEnabled || request) return false;
		return !document.hidden && navigator.onLine;
	}

	async function checkForUpdates() {
		if (!canCheckForUpdates()) return;
		const controller = new AbortController();
		request = controller;
		try {
			const response = await fetch('/config/version', {
				credentials: 'same-origin',
				cache: 'no-store',
				redirect: 'error',
				headers: { accept: 'application/json' },
				signal: AbortSignal.any([controller.signal, AbortSignal.timeout(requestTimeout)])
			});
			if (request !== controller || controller.signal.aborted) return;
			if (response.status === 401 || response.status === 403) {
				stopChecking();
				return;
			}
			if (!response.ok) throw new Error('Configuration version unavailable.');
			const latestSnapshotId = readSnapshotId(await response.json());
			if (request !== controller || controller.signal.aborted) return;
			if (latestSnapshotId === undefined) throw new Error('Invalid configuration version.');
			retryDelay = checkInterval;
			if (latestSnapshotId !== documentSnapshotId) {
				updateAvailable = true;
				stopChecking();
			}
		} catch {
			if (request === controller && !controller.signal.aborted) {
				retryDelay = Math.min(retryDelay * 2, maximumRetryDelay);
			}
		} finally {
			if (request === controller) {
				request = undefined;
				scheduleCheck();
			}
		}
	}

	function scheduleCheck() {
		clearTimeout(timer);
		timer = undefined;
		if (!canCheckForUpdates()) return;
		timer = setTimeout(() => {
			void checkForUpdates();
		}, retryDelay);
	}

	function pauseChecking() {
		clearTimeout(timer);
		timer = undefined;
		request?.abort();
		request = undefined;
	}

	function resumeChecking() {
		if (document.hidden || !navigator.onLine) {
			pauseChecking();
			return;
		}
		clearTimeout(timer);
		timer = undefined;
		void checkForUpdates();
	}

	function readSnapshotId(value: unknown): string | undefined {
		if (typeof value !== 'object' || value === null) return;
		if (!('snapshotId' in value) || typeof value.snapshotId !== 'string') return;
		if (value.snapshotId.length === 0) return;
		return value.snapshotId;
	}
</script>

<div class="update-notice" aria-live="polite" aria-atomic="true">
	{#if snapshotId && updateAvailable}
		<div class="message-bar">
			<p>Updates available</p>
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- The current absolute document URL must keep shallow query changes. -->
			<a href={refreshHref} data-sveltekit-reload aria-label="Refresh page">Refresh</a>
		</div>
	{/if}
</div>

<style>
	.update-notice {
		position: sticky;
		inset-block-start: 0;
		z-index: 5;
		color: var(--color-on-primary);
		background: var(--color-primary);
	}

	.message-bar {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-wrap: wrap;
		text-align: center;
		gap: var(--space-4);
		min-height: 44px;
		padding-inline: var(--space-5);
	}

	a {
		display: inline-flex;
		align-items: center;
		min-width: 44px;
		min-height: 44px;
		padding-inline: var(--space-4);
		color: inherit;
		font-weight: 600;
		text-decoration: underline;
		text-underline-offset: 0.2em;
		border-radius: var(--radius-sm);
	}

	a:hover {
		text-decoration-thickness: 2px;
	}

	a:focus-visible {
		outline: 2px solid currentColor;
		outline-offset: -2px;
	}
</style>
