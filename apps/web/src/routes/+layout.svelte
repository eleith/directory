<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import type { LayoutData } from './$types';
	import '../lib/styles/reset.css';
	import '../lib/styles/theme.css';

	let { children, data }: { children: Snippet; data: LayoutData } = $props();

	onMount(() => {
		const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
		function followSystem() {
			if (document.documentElement.dataset.themePreference === 'system') {
				document.documentElement.dataset.theme = mediaQuery.matches ? 'dark' : 'light';
			}
		}
		followSystem();
		mediaQuery.addEventListener('change', followSystem);
		return () => mediaQuery.removeEventListener('change', followSystem);
	});
</script>

<svelte:head>
	<link rel="icon" href={data.faviconPath} />
</svelte:head>

{@render children()}
