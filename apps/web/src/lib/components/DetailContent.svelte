<script lang="ts">
	import type { Snippet } from 'svelte';
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
	<div class="summary">
		<div class="identity">
			<BookmarkLogo {link} />
			<div class="identity-copy">
				{#if title}
					{@render title(link.title)}
				{:else}
					<h2 id="link-details-title">{link.title}</h2>
				{/if}
				{#if groupLabel}
					<p class="category">{groupLabel}</p>
				{/if}
			</div>
		</div>
		{#if link.description}
			<p class="description">{link.description}</p>
		{/if}
	</div>
	<div class="metadata">
		{#if link.requires_auth || link.internal_only || link.admin_only || link.tags.length > 0}
			<div class="metadata-group">
				<ul class="tags" aria-label="Tags">
					{#if link.requires_auth}
						<li class="access-tag">login</li>
					{/if}
					{#if link.internal_only}
						<li class="access-tag">internal</li>
					{/if}
					{#if link.admin_only}
						<li class="access-tag" aria-label="admin only">admin</li>
					{/if}
					{#each link.tags as tag, index (index)}
						<li>{tag.toLowerCase()}</li>
					{/each}
				</ul>
			</div>
		{/if}
		<div class="destination">
			<div class="destination-address">
				<div class="destination-value">
					{#if link.favicon_path !== undefined}
						<Logo source={link.favicon_path} fallback={`/bookmarks/${link.id}/logo`} size={24} />
					{/if}
					<input
						class="url"
						aria-label="Destination"
						id={`destination-${link.id}`}
						type="url"
						value={link.url}
						readonly
						spellcheck="false"
					/>
				</div>
				<!-- eslint-disable svelte/no-navigation-without-resolve -- Prepared service URLs are external destinations, not application routes. -->
				<a
					class="open-service"
					href={link.url}
					target="_blank"
					rel="noopener noreferrer"
					aria-label={`Open ${link.title} (opens in a new tab)`}>Open</a
				>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			</div>
		</div>
	</div>
</div>

<style>
	.details {
		display: grid;
		gap: calc(var(--space-4) * 2);
		min-width: 0;
		padding-block-start: calc(var(--space-5) + var(--space-1) * 2);
		overflow-wrap: anywhere;
	}

	.summary,
	.metadata-group,
	.destination {
		padding-inline: calc(var(--space-5) + var(--space-1) * 2);
	}

	.summary {
		display: grid;
		align-content: start;
		gap: var(--space-5);
		min-block-size: 8rem;
	}

	.identity {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		min-width: 0;
	}

	.identity :global(img) {
		flex-shrink: 0;
	}

	.identity-copy {
		min-width: 0;
	}

	.details :global(h2),
	p,
	ul {
		margin: 0;
	}

	.details :global(h2) {
		font-size: 1.5rem;
		line-height: var(--line-height-heading);
	}

	.category {
		margin-block-start: var(--space-1);
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}

	.description {
		white-space: pre-line;
		text-align: start;
	}

	.destination-address {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: var(--space-4);
		min-width: 0;
	}

	.destination-value {
		display: flex;
		align-items: center;
		min-width: 0;
		min-height: 48px;
		background: var(--color-surface-muted);
		border: var(--border-width) solid var(--color-border-subtle);
		border-radius: var(--radius-control);
	}

	.destination-value :global(img) {
		flex-shrink: 0;
		margin-inline-start: var(--space-4);
	}

	.url {
		align-self: stretch;
		min-width: 0;
		width: 100%;
		padding: var(--space-4);
		font: inherit;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		background: transparent;
		border: 0;
		border-radius: inherit;
	}

	.url:focus-visible {
		outline: var(--outline-focus);
		outline-offset: var(--space-1);
	}

	.metadata {
		display: grid;
		gap: calc(var(--space-4) * 2);
	}

	.destination {
		padding-block-start: calc(var(--space-4) * 2);
		padding-block-end: calc(var(--space-5) + var(--space-1) * 2);
		background: color-mix(in srgb, var(--color-text) 7%, var(--color-surface-card));
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
		color: var(--color-text);
		background: color-mix(in srgb, var(--color-text) 15%, var(--color-surface-card));
		border: var(--border-width) solid var(--color-border-strong);
		border-radius: var(--radius-control);
	}

	.tags .access-tag {
		background: color-mix(in srgb, var(--color-primary) 12%, var(--color-surface-card));
	}

	.open-service {
		display: grid;
		place-items: center;
		width: auto;
		min-width: 5rem;
		min-height: 48px;
		padding: var(--space-4) var(--space-5);
		color: var(--color-on-primary);
		background: var(--color-primary);
		border-radius: var(--radius-control);
		font-weight: 600;
		text-align: center;
		text-decoration: none;
	}

	.open-service:hover {
		text-decoration: underline;
	}

	.open-service:focus-visible {
		outline: var(--outline-focus);
		outline-offset: var(--space-1);
	}
</style>
