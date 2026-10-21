<script lang="ts">
	import type { Snippet } from 'svelte';
	import IconArrowSquareOut from 'virtual:icons/ph/arrow-square-out';
	import type { DisplayLink } from '$lib/display/types.js';
	import BookmarkLogo from './BookmarkLogo.svelte';
	import Logo from './Logo.svelte';

	let {
		link,
		groupLabel,
		title
	}: {
		link: DisplayLink;
		groupLabel?: string | undefined;
		title?: Snippet<[string]>;
	} = $props();
</script>

<div class="details">
	<BookmarkLogo {link} />
	{#if title}
		{@render title(link.title)}
	{:else}
		<h2 id="link-details-title">{link.title}</h2>
	{/if}
	{#if groupLabel}
		<p class="group">{groupLabel}</p>
	{/if}
	{#if link.description}
		<p class="description">{link.description}</p>
	{/if}
	{#if link.tags.length > 0}
		<ul class="tags" aria-label="Tags">
			{#each link.tags as tag, index (index)}
				<li>{tag}</li>
			{/each}
		</ul>
	{/if}
	{#if link.requires_auth || link.internal_only || link.admin_only}
		<ul class="hints" aria-label="Service information">
			{#if link.requires_auth}
				<li>Requires authentication</li>
			{/if}
			{#if link.internal_only}
				<li>Internal only</li>
			{/if}
			{#if link.admin_only}
				<li>Admin only</li>
			{/if}
		</ul>
	{/if}
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- Prepared service URLs are external destinations, not application routes. -->
	<a href={link.url} target="_blank" rel="noopener noreferrer">
		{#if link.favicon_path !== undefined}
			<Logo source={link.favicon_path} fallback={`/bookmarks/${link.id}/logo`} size={24} />
		{/if}
		<span>Open service <span class="new-tab">(opens in a new tab)</span></span>
		<IconArrowSquareOut aria-hidden="true" focusable="false" />
	</a>
</div>

<style>
	.details {
		display: grid;
		gap: var(--space-4);
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.details :global(h2),
	p,
	ul {
		margin: 0;
	}

	.details :global(h2) {
		font-size: var(--font-size-heading);
		line-height: var(--line-height-heading);
	}

	.group,
	.hints,
	.new-tab {
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}

	.description {
		white-space: pre-line;
	}

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		padding: 0;
		list-style: none;
		font-size: var(--font-size-sm);
	}

	.tags li {
		min-width: 0;
		padding: var(--space-1) var(--space-4);
		border: var(--border-width) solid var(--color-border-strong);
		border-radius: var(--radius-sm);
	}

	.hints {
		padding-inline-start: 1.25rem;
	}

	a {
		display: inline-flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-4);
		justify-self: start;
		max-width: 100%;
		color: inherit;
		text-underline-offset: 0.2em;
	}

	a:focus-visible {
		outline: var(--outline-focus);
		outline-offset: var(--space-1);
	}
</style>
