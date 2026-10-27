<script lang="ts">
	import type { DocumentMetadata } from '$lib/server/document.js';

	let { metadata, faviconPath }: { metadata: DocumentMetadata; faviconPath: string } = $props();
</script>

<svelte:head>
	<link rel="icon" href={faviconPath} />
	<meta property="og:type" content="website" />
	<meta property="og:title" content={metadata.title} />
	<meta property="og:site_name" content={metadata.title} />
	<meta property="og:url" content={metadata.url} />
	<meta property="og:image" content={metadata.image.url} />
	<meta property="og:image:alt" content={`Preview of ${metadata.title}`} />
	<meta property="og:image:type" content={metadata.image.type} />
	{#if metadata.image.width !== undefined}
		<meta property="og:image:width" content={String(metadata.image.width)} />
	{/if}
	{#if metadata.image.height !== undefined}
		<meta property="og:image:height" content={String(metadata.image.height)} />
	{/if}
	{#if metadata.image.url.startsWith('https:')}
		<meta property="og:image:secure_url" content={metadata.image.url} />
	{/if}
</svelte:head>
