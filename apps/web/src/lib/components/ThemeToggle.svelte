<script lang="ts">
	import { onMount } from 'svelte';
	import IconMoon from 'virtual:icons/ph/moon';
	import IconSunDim from 'virtual:icons/ph/sun-dim';
	import IconFaders from 'virtual:icons/ph/faders';

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
		<IconMoon class="icon-moon" aria-hidden="true" focusable="false" />
	{:else if preference === 'dark'}
		<span class="visually-hidden">Switch to light theme</span>
		<IconSunDim class="icon-sun-dim" aria-hidden="true" focusable="false" />
	{:else}
		<span class="visually-hidden">Use system theme</span>
		<IconFaders class="icon-faders" aria-hidden="true" focusable="false" />
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
		font-size: 1.25rem;
		color: var(--color-text-muted);
		background: transparent;
		border: 0;
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	button:hover {
		background: var(--color-surface-muted);
	}

	button:disabled {
		opacity: 0.5;
		cursor: default;
	}

	button:focus-visible {
		outline: var(--outline-focus);
		outline-offset: var(--space-1);
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
