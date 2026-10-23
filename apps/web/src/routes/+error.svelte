<script lang="ts">
	import { page } from '$app/state';
	import ButtonLink from '$lib/components/ui/ButtonLink.svelte';
</script>

<svelte:head>
	<title>Error {page.status}</title>
</svelte:head>

<main class="error-page">
	<p class="status">{page.status}</p>
	{#if page.status === 404}
		<h1>Page not found</h1>
	{:else if page.status === 401 || page.status === 403}
		<h1>Unable to open this page</h1>
	{:else}
		<h1>Something went wrong</h1>
	{/if}
	<ButtonLink href="/" variant="primary" data-sveltekit-reload>Back to home</ButtonLink>
</main>

<style>
	.error-page {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-5);
		min-height: 100svh;
		max-width: 30rem;
		margin-inline: auto;
		padding: var(--space-8) var(--space-5);
		text-align: center;
	}

	.status {
		font-size: 3rem;
		font-weight: 700;
		line-height: var(--line-height-heading);
		color: var(--color-text-muted);
	}

	h1 {
		font-size: 1.5rem;
		line-height: var(--line-height-heading);
		overflow-wrap: anywhere;
	}
</style>
