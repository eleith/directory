<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { page } from '$app/state';
	import ConfigUpdateNotice from '$lib/components/ConfigUpdateNotice.svelte';
	import DocumentHead from '$lib/components/DocumentHead.svelte';
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

<DocumentHead metadata={data.document} faviconPath={data.faviconPath} />

<ConfigUpdateNotice snapshotId={page.data.directory?.snapshotId} />
{@render children()}
