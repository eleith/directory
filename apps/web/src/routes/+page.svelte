<script lang="ts">
	import DetailContent from '$lib/components/DetailContent.svelte';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();

	const selectedGroup = $derived(
		data.directory.groups.find((group) =>
			group.links.some((link) => link.id === data.selectedLinkId)
		)
	);
	const selectedLink = $derived(
		selectedGroup?.links.find((link) => link.id === data.selectedLinkId)
	);
</script>

<svelte:head>
	<title>{data.directory.site.title}</title>
	<meta name="description" content={data.directory.site.description} />
</svelte:head>

<main>
	<header>
		<div class="site-copy">
			<h1>{data.directory.site.title}</h1>
			{#if data.directory.site.description}
				<p class="description">{data.directory.site.description}</p>
			{/if}
		</div>
		{#if data.signedIn}
			<form method="POST" action="?/signout">
				<button type="submit">Sign out</button>
			</form>
		{/if}
	</header>

	{#if selectedLink}
		<section class="details" aria-labelledby="link-details-title">
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- Root-only URLs must stay absolute in SSR. -->
			<a class="back" href="/" data-sveltekit-preload-data="off">Back to directory</a>
			<DetailContent link={selectedLink} groupLabel={selectedGroup?.label} />
		</section>
	{/if}

	<div class="groups">
		{#each data.directory.groups as group (group.id)}
			<section aria-label={group.label ?? 'Directory links'}>
				{#if group.label}
					<h2>{group.label}</h2>
				{/if}
				<ul class="link-grid">
					{#each group.links as link (link.id)}
						<li>
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- Root-only URLs must stay absolute in SSR. -->
							<a class="card" href={`/?link=${link.id}`} data-sveltekit-preload-data="off">
								<img src={link.logo_path} alt="" width="64" height="64" loading="lazy" />
								{link.title}
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{:else}
			<p class="empty">No bookmarks yet.</p>
		{/each}
	</div>

	{#if data.directory.site.footer}
		<footer>{data.directory.site.footer}</footer>
	{/if}
</main>

<style>
	main {
		max-width: 76rem;
		margin-inline: auto;
		padding: var(--space-8) var(--space-5);
		overflow-wrap: anywhere;
	}

	header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: var(--space-5);
		margin-block-end: var(--space-8);
	}

	.site-copy {
		min-width: 0;
		flex: 1 1 16rem;
	}

	h1 {
		font-size: var(--font-size-heading);
		line-height: var(--line-height-heading);
	}

	.description {
		margin-block-start: var(--space-4);
		color: var(--color-text-muted);
		white-space: pre-line;
	}

	.groups {
		display: grid;
		gap: var(--space-8);
	}

	h2 {
		margin-block-end: var(--space-5);
		font-size: var(--font-size-base);
	}

	.link-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 14rem), 1fr));
		gap: var(--space-5);
		padding: 0;
		list-style: none;
	}

	.card {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-4);
		height: 100%;
		padding: var(--space-5);
		background: var(--color-surface-card);
		border: var(--border-width) solid var(--color-border-subtle);
		border-radius: var(--radius-sm);
		color: var(--color-text);
		text-decoration: none;
		font-weight: 600;
	}

	.card img {
		display: block;
		border-radius: var(--radius-sm);
	}

	.card:hover {
		border-color: var(--color-border-strong);
		text-decoration: underline;
	}

	.details {
		margin-block-end: var(--space-8);
		padding: var(--space-5);
		background: var(--color-surface-card);
		border: var(--border-width) solid var(--color-border-subtle);
		border-radius: var(--radius-sm);
	}

	.back {
		display: inline-block;
		margin-block-end: var(--space-8);
		color: var(--color-text);
		text-underline-offset: 0.2em;
	}

	.empty,
	footer {
		color: var(--color-text-muted);
	}

	footer {
		margin-block-start: var(--space-8);
		padding-block-start: var(--space-8);
		border-block-start: var(--border-width) solid var(--color-border-subtle);
		white-space: pre-line;
	}

	button {
		color: var(--color-text);
		background: var(--color-surface-page);
		border: var(--border-width) solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		padding: var(--space-4) var(--space-5);
		cursor: pointer;
	}

	a:focus-visible,
	button:focus-visible {
		outline: var(--outline-focus);
		outline-offset: var(--space-1);
	}

	@media (min-width: 48rem) {
		main {
			padding: var(--space-8);
		}

		.details {
			padding: var(--space-8);
		}
	}
</style>
