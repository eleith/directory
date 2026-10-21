<script lang="ts">
	import { onMount } from 'svelte';
	import { afterNavigate, beforeNavigate, pushState, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import BookmarkLogo from '$lib/components/BookmarkLogo.svelte';
	import DetailContent from '$lib/components/DetailContent.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import Search from '$lib/components/Search.svelte';
	import type { DisplayLink } from '$lib/display/types.js';
	import type { SearchResult } from '$lib/search/engine.js';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();

	let searchResults = $state<SearchResult[] | null>(null);
	let DetailDialog = $state<typeof import('$lib/components/DetailDialog.svelte').default>();
	let dialogImport: Promise<typeof import('$lib/components/DetailDialog.svelte')> | undefined;
	let mounted = false;
	let openRequestVersion = 0;
	let closing = false;
	let returnTile: HTMLAnchorElement | undefined;
	let directoryHeading: HTMLHeadingElement | undefined = $state();

	const selectedId = $derived.by(() => {
		if (page.state.directoryDetail === null) return null;
		if (page.state.directoryDetail) return page.state.directoryDetail.id;
		return data.selectedLinkId;
	});
	const selectedGroup = $derived(
		data.directory.groups.find((group) => group.links.some((link) => link.id === selectedId))
	);
	const selectedLink = $derived(selectedGroup?.links.find((link) => link.id === selectedId));

	function cancelPendingOpen() {
		openRequestVersion++;
		closing = false;
	}

	function loadDialog() {
		dialogImport ??= import('$lib/components/DetailDialog.svelte').catch((error: unknown) => {
			dialogImport = undefined;
			throw error;
		});
		return dialogImport;
	}

	async function enhanceDirectDetails() {
		if (!selectedLink || DetailDialog) return;
		const requestVersion = ++openRequestVersion;
		const snapshot = data.directory;
		try {
			const module = await loadDialog();
			if (!mounted || openRequestVersion !== requestVersion || data.directory !== snapshot) return;
			DetailDialog = module.default;
		} catch {
			// Keep the usable server-rendered section on a failed direct-entry enhancement.
		}
	}

	async function openDetails(event: MouseEvent, id: string) {
		if (event.defaultPrevented || event.button !== 0) return;
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		const tile = event.currentTarget as HTMLAnchorElement;
		const href = tile.href;
		event.preventDefault();
		const requestVersion = ++openRequestVersion;
		const snapshot = data.directory;
		try {
			const module = await loadDialog();
			if (!mounted || openRequestVersion !== requestVersion || data.directory !== snapshot) return;
			returnTile = tile;
			closing = false;
			DetailDialog = module.default;
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- This absolute href comes from the real tile anchor.
			pushState(href, { ...page.state, directoryDetail: { id, fromGrid: true } });
		} catch {
			if (!mounted || openRequestVersion !== requestVersion || data.directory !== snapshot) return;
			location.assign(href);
		}
	}

	function closeDetails() {
		if (closing) return;
		openRequestVersion++;
		closing = true;
		if (page.state.directoryDetail?.fromGrid) {
			history.back();
			return;
		}
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- Root-only URLs must stay absolute.
		replaceState('/', { ...page.state, directoryDetail: null });
	}

	function returnFocus() {
		if (returnTile?.isConnected) {
			returnTile.focus({ preventScroll: true });
			return;
		}
		directoryHeading?.focus({ preventScroll: true });
	}

	beforeNavigate(() => {
		cancelPendingOpen();
		returnTile = undefined;
	});
	afterNavigate((navigation) => {
		if (navigation.type !== 'enter') void enhanceDirectDetails();
	});
	onMount(() => {
		mounted = true;
		void enhanceDirectDetails();
		window.addEventListener('popstate', cancelPendingOpen);
		return () => {
			mounted = false;
			openRequestVersion++;
			window.removeEventListener('popstate', cancelPendingOpen);
		};
	});
</script>

<svelte:head>
	<title>{data.directory.site.title}</title>
	<meta name="description" content={data.directory.site.description} />
</svelte:head>

<main>
	<header>
		<div class="site-brand">
			<Logo
				source={data.directory.site.logo_path}
				fallback="/favicon.svg"
				size={48}
				loading="eager"
			/>
			<div class="site-copy">
				<h1 bind:this={directoryHeading} tabindex="-1">{data.directory.site.title}</h1>
				{#if data.directory.site.description}
					<p class="description">{data.directory.site.description}</p>
				{/if}
			</div>
		</div>
		<div class="header-actions">
			<Search directory={data.directory} bind:results={searchResults} />
			<ThemeToggle />
			{#if data.signedIn}
				<form method="POST" action="?/signout">
					<button type="submit">Sign out</button>
				</form>
			{/if}
		</div>
	</header>

	{#if selectedLink && DetailDialog}
		<DetailDialog
			link={selectedLink}
			groupLabel={selectedGroup?.label}
			onClose={closeDetails}
			onReturnFocus={returnFocus}
		/>
	{:else if selectedLink}
		<section class="details" aria-labelledby="link-details-title">
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- Root-only URLs must stay absolute in SSR. -->
			<a class="back" href="/" data-sveltekit-preload-data="off">Back to directory</a>
			<DetailContent link={selectedLink} groupLabel={selectedGroup?.label} />
		</section>
	{/if}

	{#snippet tile(link: DisplayLink, groupLabel: string | undefined)}
		<!-- eslint-disable svelte/no-navigation-without-resolve -- Root-only URLs must stay absolute in SSR. -->
		<a
			class="tile"
			href={`/?link=${link.id}`}
			data-sveltekit-preload-data="off"
			onclick={(event) => openDetails(event, link.id)}
		>
			<BookmarkLogo {link} loading="lazy" />
			<span>{link.title}</span>
			{#if groupLabel}
				<small class="group-caption">{groupLabel}</small>
			{/if}
		</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	{/snippet}

	<div class="groups">
		{#if searchResults !== null}
			<section aria-label="Search results">
				<ul class="link-grid">
					{#each searchResults as result (result.link.id)}
						<li>{@render tile(result.link, result.groupLabel)}</li>
					{/each}
				</ul>
			</section>
		{:else}
			{#each data.directory.groups as group (group.id)}
				<section aria-label={group.label ?? 'Directory links'}>
					{#if group.label}
						<h2>{group.label}</h2>
					{/if}
					<ul class="link-grid">
						{#each group.links as link (link.id)}
							<li>
								{@render tile(link, undefined)}
							</li>
						{/each}
					</ul>
				</section>
			{:else}
				<p class="empty">
					No bookmarks yet. Add links to the directory configuration to get started.
				</p>
			{/each}
		{/if}
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
		margin-block-end: var(--space-9);
	}

	.header-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		flex-wrap: wrap;
		gap: var(--space-4);
		margin-inline-start: auto;
		max-width: 100%;
		flex: 1 1 22rem;
	}

	.site-brand {
		display: flex;
		align-items: flex-start;
		gap: var(--space-4);
		min-width: 0;
		flex: 1 1 16rem;
	}

	.site-brand :global(img) {
		flex-shrink: 0;
	}

	.site-copy {
		min-width: 0;
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
		gap: var(--space-9);
	}

	h2 {
		margin-block-end: var(--space-5);
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.link-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, 6rem);
		gap: var(--space-8) var(--space-5);
		padding: 0;
		list-style: none;
	}

	.tile {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-4);
		height: 100%;
		padding-block: var(--space-4);
		border-radius: var(--radius-sm);
		color: var(--color-text);
		text-align: center;
		text-decoration: none;
		font-weight: 600;
		line-height: var(--line-height-heading);
	}

	.group-caption {
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		font-weight: 400;
	}

	.tile:hover {
		background: var(--color-surface-card);
		text-decoration: underline;
	}

	.details {
		margin-block-end: var(--space-9);
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
		text-decoration-color: var(--color-primary);
	}

	.empty,
	footer {
		color: var(--color-text-muted);
	}

	footer {
		margin-block-start: var(--space-9);
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
			padding: var(--space-9) var(--space-8);
		}

		.link-grid {
			column-gap: var(--space-8);
		}

		.details {
			padding: var(--space-8);
		}
	}
</style>
