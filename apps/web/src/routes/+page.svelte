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
	<p>The directory is loaded. Dashboard links are coming next.</p>
	<p class="status">Configuration format {data.configurationVersion}</p>
	{#if data.signedIn}
		<form method="POST" action="?/signout">
			<button type="submit">Sign out</button>
		</form>
	{/if}
</main>

<style>
	main {
		max-width: var(--content-max-width);
		margin-inline: auto;
		padding: var(--space-8);
	}

	h1,
	p {
		margin-block-end: var(--space-5);
	}

	h1 {
		font-size: var(--font-size-heading);
		line-height: var(--line-height-heading);
	}

	.status {
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}

	button {
		color: var(--color-text);
		background: var(--color-surface-page);
		border: var(--border-width) solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		padding: var(--space-4) var(--space-5);
		cursor: pointer;
	}

	button:focus-visible {
		outline: var(--outline-focus);
		outline-offset: var(--space-1);
	}
</style>
