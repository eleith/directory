<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import type { DisplayLink } from '$lib/display/types.js';
	import BookmarkLogo from './BookmarkLogo.svelte';
	import ButtonLink from './ui/ButtonLink.svelte';
	import Chip from './ui/Chip.svelte';
	import Input from './ui/Input.svelte';

	let {
		link,
		groupLabel,
		headingAttributes = {},
		reserveCloseSpace = false,
		onTagSearch
	}: {
		link: DisplayLink;
		groupLabel?: string | undefined;
		headingAttributes?: HTMLAttributes<HTMLHeadingElement>;
		reserveCloseSpace?: boolean;
		onTagSearch?: (query: string) => void;
	} = $props();
</script>

{#snippet chip(label: string, query: string, access = false)}
	{@const filterKind = access ? 'access' : 'tag'}
	<Chip
		class="tag"
		{access}
		aria-label={onTagSearch ? `Filter by ${filterKind}: ${label}` : undefined}
		onclick={onTagSearch ? () => onTagSearch?.(query) : undefined}>{label}</Chip
	>
{/snippet}

<div class="details">
	<div class="summary">
		<div class="identity" class:has-close-control={reserveCloseSpace}>
			<BookmarkLogo {link} />
			<div class="identity-copy">
				<h2 {...headingAttributes} id={headingAttributes.id ?? 'link-details-title'}>
					{link.title}
				</h2>
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
						<li>{@render chip('login', 'access:login', true)}</li>
					{/if}
					{#if link.internal_only}
						<li>{@render chip('internal', 'access:internal', true)}</li>
					{/if}
					{#if link.admin_only}
						<li aria-label="admin only">{@render chip('admin', 'access:admin', true)}</li>
					{/if}
					{#each link.tags as tag, index (index)}
						<li>{@render chip(tag.toLowerCase(), `tag:${tag.toLowerCase()}`)}</li>
					{/each}
				</ul>
			</div>
		{/if}
		<div class="destination">
			<div class="destination-address">
				<Input
					class="destination-value"
					aria-label="Destination"
					id={`destination-${link.id}`}
					type="url"
					value={link.url}
					readonly
					spellcheck="false"
				/>
				<ButtonLink
					class="open-service"
					href={link.url}
					target="_blank"
					rel="noopener noreferrer"
					aria-label={`Open ${link.title} (opens in a new tab)`}>Open</ButtonLink
				>
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

	.identity.has-close-control {
		padding-inline-end: 44px;
	}

	.identity-copy {
		min-width: 0;
	}

	h2,
	p,
	ul {
		margin: 0;
	}

	h2 {
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
	}

	.tags li {
		min-width: 0;
	}
</style>
