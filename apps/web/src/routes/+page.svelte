<script lang="ts">
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>{data.title} — Homelab dashboard</title>
	<meta name="description" content={data.description} />
</svelte:head>

<main>
	<h1><span aria-hidden="true">📍</span> {data.title}</h1>
	<p>{data.description}</p>
	<p>The workspace is ready. Dashboard configuration and links are coming next.</p>
</main>

<style>
	main {
		max-width: var(--content-width);
		margin-inline: auto;
		padding: var(--space-page);
	}

	h1 {
		font-size: var(--font-heading);
		line-height: var(--line-heading);
	}
</style>
