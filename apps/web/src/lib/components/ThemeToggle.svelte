<script lang="ts">
	import { onMount } from 'svelte';

	type Preference = 'system' | 'dark' | 'light';
	let preference = $state<Preference>('system');
	let ready = $state(false);

	function applyTheme() {
		let appliedTheme = preference;
		if (preference === 'system') {
			appliedTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
		}
		document.documentElement.dataset.themePreference = preference;
		document.documentElement.dataset.theme = appliedTheme;
	}

	function cycleTheme() {
		if (preference === 'system') {
			preference = 'dark';
		} else if (preference === 'dark') {
			preference = 'light';
		} else {
			preference = 'system';
		}
		applyTheme();
		try {
			window.localStorage.setItem('directory.theme', preference);
		} catch {
			// Keep the in-memory preference when storage is blocked.
		}
	}

	onMount(() => {
		const restored = document.documentElement.dataset.themePreference;
		if (restored === 'dark' || restored === 'light' || restored === 'system') {
			preference = restored;
		}
		applyTheme();
		ready = true;
	});
</script>

<button type="button" disabled={!ready} onclick={cycleTheme}>
	{#if preference === 'system'}
		<span class="visually-hidden">Switch to dark theme</span>
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z" />
		</svg>
	{:else if preference === 'dark'}
		<span class="visually-hidden">Switch to light theme</span>
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<circle cx="12" cy="12" r="4" />
			<path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
		</svg>
	{:else}
		<span class="visually-hidden">Use system theme</span>
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M6 3v4m0 6v8M12 3v10m0 6v2M18 3v2m0 6v10M3 7h6v6H3zm6 6h6v6H9zm6-8h6v6h-6z" />
		</svg>
	{/if}
</button>

<style>
	button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 44px;
		min-height: 44px;
		padding: var(--space-4);
		color: var(--color-text);
		background: var(--color-surface-page);
		border: var(--border-width) solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.5;
		cursor: default;
	}

	button:focus-visible {
		outline: var(--outline-focus);
		outline-offset: var(--space-1);
	}

	svg {
		width: 1.25rem;
		height: 1.25rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
