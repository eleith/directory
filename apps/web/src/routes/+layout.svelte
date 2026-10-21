<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';
	import '../lib/styles/reset.css';
	import '../lib/styles/theme.css';

	let { children, data }: { children: Snippet; data: LayoutData } = $props();
</script>

<svelte:head>
	<link rel="icon" href={data.faviconPath} />
</svelte:head>

{@render children()}
