<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import IconSignOut from 'virtual:icons/ph/sign-out';
	import { beforeNavigate, pushState, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import BookmarkLogo from '$lib/components/bookmarks/BookmarkLogo.svelte';
	import BookmarkDetails from '$lib/components/bookmarks/BookmarkDetails.svelte';
	import BookmarkDetailsDialog from '$lib/components/bookmarks/BookmarkDetailsDialog.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import BookmarkSearch from '$lib/components/search/BookmarkSearch.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { nextResultIndex } from '$lib/search/result-navigation.js';
	import type { DisplayLink } from '$lib/display/types.js';
	import type { SearchResult } from '$lib/search/engine.js';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();

	// Kit shallow routing updates page.state, not page.url.
	const searchQuery = $derived(page.state.directoryQuery ?? page.url.searchParams.get('q') ?? '');
	let searchResults = $state<SearchResult[] | null>(null);
	let searchStatus = $state<'idle' | 'loading' | 'ready' | 'failed'>('idle');
	let searchInput = $state<HTMLInputElement>();
	let resultList = $state<HTMLUListElement>();
	let mounted = $state(false);
	let isClosingDetails = false;
	let pendingFilterQuery: string | undefined;
	let returnTile: HTMLAnchorElement | undefined;
	let directoryHeading: HTMLHeadingElement | undefined = $state();

	const selectedId = $derived.by(() => {
		if (page.state.directoryDetail === null) return null;
		if (page.state.directoryDetail) return page.state.directoryDetail.id;
		return data.selectedLinkId;
	});
	const directoryURL = $derived.by(() => {
		const parameters = new SvelteURLSearchParams();
		if (searchQuery) parameters.set('q', searchQuery);
		return parameters.size ? `/?${parameters}` : '/';
	});
	const selectedGroup = $derived(
		data.directory.groups.find((group) => group.links.some((link) => link.id === selectedId))
	);
	const selectedLink = $derived(selectedGroup?.links.find((link) => link.id === selectedId));

	$effect(() => {
		if (selectedLink) {
			isClosingDetails = false;
			pendingFilterQuery = undefined;
		}
	});

	function setSearchQuery(query: string) {
		if (query === searchQuery) return;
		const parameters = new SvelteURLSearchParams();
		if (selectedId !== null) parameters.set('link', selectedId);
		if (query) parameters.set('q', query);
		const url = parameters.size ? `/?${parameters}` : '/';
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- Query URLs stay absolute in this root-only directory.
		replaceState(url, { ...page.state, directoryQuery: query });
	}

	function detailURL(id: string) {
		const parameters = new SvelteURLSearchParams({ link: id });
		if (searchQuery) parameters.set('q', searchQuery);
		return `/?${parameters}`;
	}

	function findResultLink(id: string) {
		const links = resultList?.querySelectorAll<HTMLAnchorElement>('a.tile') ?? [];
		return Array.from(links).find((link) => new URL(link.href).searchParams.get('link') === id);
	}

	function enterResults(activateSingle: boolean) {
		const firstResult = resultList?.querySelector<HTMLAnchorElement>('a.tile');
		if (!firstResult) return;
		if (activateSingle) firstResult.click();
		else firstResult.focus();
	}

	function navigateResults(event: KeyboardEvent) {
		if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
		if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			searchInput?.focus();
			return;
		}
		if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
			return;
		const links = Array.from(resultList?.querySelectorAll<HTMLAnchorElement>('a.tile') ?? []);
		const currentIndex = links.indexOf(event.target as HTMLAnchorElement);
		if (currentIndex === -1) return;
		event.preventDefault();
		const positions = links.map((link) => link.getBoundingClientRect());
		const nextIndex = nextResultIndex(positions, currentIndex, event.key);
		links[nextIndex]?.focus();
	}

	function focusSearch(event: KeyboardEvent) {
		if (event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229)
			return;
		if (!event.altKey || event.ctrlKey || event.metaKey || event.getModifierState('AltGraph'))
			return;
		// Option+/ reports ÷ on common Mac layouts.
		const slashKey = event.key === '/' || (event.code === 'Slash' && !event.shiftKey);
		if (!slashKey) return;
		if (!searchInput || searchInput.disabled) return;
		if (selectedLink && mounted) return;
		const editing = event
			.composedPath()
			.some(
				(target) =>
					target instanceof HTMLElement &&
					(target.isContentEditable || target.matches('input, textarea, select, [role="textbox"]'))
			);
		if (editing) return;
		event.preventDefault();
		searchInput.focus();
		searchInput.select();
	}

	function openDetails(event: MouseEvent, id: string) {
		if (event.defaultPrevented || event.button !== 0) return;
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		const tile = event.currentTarget as HTMLAnchorElement;
		const href = tile.href;
		event.preventDefault();
		returnTile = tile;
		pendingFilterQuery = undefined;
		isClosingDetails = false;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- This absolute href comes from the real tile anchor.
		pushState(href, { ...page.state, directoryDetail: { id, fromGrid: true } });
	}

	function closeDetails() {
		if (isClosingDetails) return;
		isClosingDetails = true;
		if (page.state.directoryDetail?.fromGrid) {
			history.back();
			return;
		}
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- Root-only URLs must stay absolute.
		replaceState(directoryURL, { ...page.state, directoryDetail: null });
	}

	function selectDetailFilter(query: string) {
		if (isClosingDetails) return;
		pendingFilterQuery = query;
		closeDetails();
	}

	function handleDetailsClosed() {
		isClosingDetails = false;
		if (pendingFilterQuery !== undefined) {
			const query = pendingFilterQuery;
			pendingFilterQuery = undefined;
			// Apply after closing so the query belongs to the directory history entry.
			setSearchQuery(query);
			searchInput?.focus();
			return;
		}
		restoreDirectoryFocus();
	}

	function restoreDirectoryFocus() {
		if (returnTile && !returnTile.isConnected) {
			const id = new URL(returnTile.href).searchParams.get('link');
			if (id) returnTile = findResultLink(id);
		}
		if (returnTile?.isConnected) {
			returnTile.focus({ preventScroll: true });
			return;
		}
		directoryHeading?.focus({ preventScroll: true });
	}

	beforeNavigate(() => {
		isClosingDetails = false;
		pendingFilterQuery = undefined;
		returnTile = undefined;
	});
	onMount(() => {
		mounted = true;
	});
</script>

<svelte:window onkeydown={focusSearch} />

<svelte:head>
	<title>{data.directory.site.title}</title>
	<meta name="description" content={data.directory.site.description} />
</svelte:head>

<main>
	<header>
		<div class="site-brand">
			<Logo
				source={data.directory.site.logo_path}
				fallback="/favicon.png"
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
		<div class="search-slot">
			<BookmarkSearch
				directory={data.directory}
				bind:query={() => searchQuery, setSearchQuery}
				bind:results={searchResults}
				bind:status={searchStatus}
				bind:input={searchInput}
				onEnterResults={enterResults}
			/>
		</div>
		<div class="header-actions">
			<ThemeToggle />
			{#if data.signedIn}
				<form method="POST" action="?/signout">
					<Button type="submit" size="icon" aria-label="Sign out">
						<span class="icon"><IconSignOut aria-hidden="true" focusable="false" /></span>
					</Button>
				</form>
			{/if}
		</div>
	</header>

	{#if mounted}
		<BookmarkDetailsDialog
			link={selectedLink}
			groupLabel={selectedGroup?.label}
			openLinksInNewTab={data.directory.site.open_links_in_new_tab}
			onClose={closeDetails}
			onClosed={handleDetailsClosed}
			onFilterSelect={selectDetailFilter}
		/>
	{:else if selectedLink}
		<noscript>
			<section class="details" aria-labelledby="link-details-title">
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- Root-only URLs must stay absolute in SSR. -->
				<a class="back" href={directoryURL} data-sveltekit-preload-data="off">Back to directory</a>
				<BookmarkDetails
					link={selectedLink}
					groupLabel={selectedGroup?.label}
					openLinksInNewTab={data.directory.site.open_links_in_new_tab}
				/>
			</section>
		</noscript>
	{/if}

	{#snippet tile(link: DisplayLink, groupLabel: string | undefined, filtered = false)}
		<!-- eslint-disable svelte/no-navigation-without-resolve -- Root-only URLs must stay absolute in SSR. -->
		<a
			class="tile"
			href={detailURL(link.id)}
			data-sveltekit-preload-data="off"
			onkeydown={filtered ? navigateResults : undefined}
			onclick={(event) => openDetails(event, link.id)}
		>
			<div class="tile-icon"><BookmarkLogo {link} loading="lazy" /></div>
			<span class="tile-title">{link.title}</span>
			{#if groupLabel}
				<small class="group-caption">{groupLabel}</small>
			{/if}
		</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	{/snippet}

	<div class="search-feedback">
		<div role="status" aria-atomic="true">
			{#if searchStatus === 'failed'}
				<p>Search unavailable. Reload to try again.</p>
			{:else if searchStatus === 'loading'}
				<p>Loading search…</p>
			{:else if searchResults !== null}
				{#if searchResults.length === 0}
					<p>No bookmarks found.</p>
				{:else if searchResults.length === 1}
					<p class="visually-hidden">1 bookmark found.</p>
				{:else}
					<p class="visually-hidden">{searchResults.length} bookmarks found.</p>
				{/if}
			{/if}
		</div>
		{#if searchResults?.length}
			<p id="search-keyboard-hint" class="visually-hidden">
				Use Tab or arrow keys to move, Enter for details, Escape to return to Search.
			</p>
		{/if}
	</div>

	<div class="groups">
		{#if searchResults !== null}
			{#if searchResults.length > 0}
				<ul
					bind:this={resultList}
					class="link-grid"
					role="list"
					aria-label="Search results"
					aria-describedby="search-keyboard-hint"
				>
					{#each searchResults as result (result.link.id)}
						<li>{@render tile(result.link, result.groupLabel, true)}</li>
					{/each}
				</ul>
			{/if}
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
		--tile-content-width: 6rem;
		--link-column-gap: var(--space-5);
		--tile-inline-padding: calc(var(--link-column-gap) / 2);
		max-width: 76rem;
		margin-inline: auto;
		padding: var(--space-8) var(--space-5);
		overflow-wrap: anywhere;
	}

	main > * {
		grid-column: 1 / -1;
		min-width: 0;
	}

	header {
		display: grid;
		grid-template-areas: 'brand tools' 'search search';
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: start;
		gap: var(--space-5);
		margin-block-end: var(--space-9);
	}

	.header-actions {
		grid-area: tools;
		display: flex;
		align-items: center;
		min-height: 48px;
		gap: var(--space-1);
	}

	.header-actions form {
		display: flex;
		flex-shrink: 0;
		margin: 0;
	}

	.search-slot {
		grid-area: search;
		min-width: 0;
	}

	.site-brand {
		grid-area: brand;
		display: flex;
		align-items: flex-start;
		flex-wrap: wrap;
		gap: var(--space-4);
		min-width: 0;
	}

	.site-copy {
		flex: 1 1 8ch;
		min-width: 0;
	}

	h1 {
		font-size: 1.5rem;
		line-height: var(--line-height-heading);
	}

	.description {
		margin-block-start: var(--space-1);
		color: var(--color-text-muted);
		white-space: pre-line;
	}

	.search-feedback {
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.search-feedback:has(p:not(.visually-hidden)) {
		margin-block-end: var(--space-5);
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
		/* Keep horizontal gutters inside hit areas while aligning content with headings. */
		grid-template-columns: repeat(
			auto-fill,
			calc(var(--tile-content-width) + var(--link-column-gap))
		);
		gap: 0;
		justify-content: center;
		margin-inline: calc(-1 * var(--tile-inline-padding));
		padding: 0;
		list-style: none;
	}

	.tile {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-4);
		height: 100%;
		padding: var(--space-4) var(--tile-inline-padding);
		border-radius: var(--radius-sm);
		color: var(--color-text);
		text-align: center;
		text-decoration: none;
		font-weight: 600;
		line-height: var(--line-height-heading);
	}

	.tile-title {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		max-width: 100%;
		overflow: hidden;
	}

	.group-caption {
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		font-weight: 400;
	}

	.tile-icon {
		flex-shrink: 0;
		transition:
			transform var(--transition-control),
			filter var(--transition-control);
	}

	.tile:hover .tile-title {
		text-decoration: underline;
	}

	.tile:hover .tile-icon {
		transform: translateY(-2px);
		filter: drop-shadow(0 6px 10px light-dark(rgb(0 0 0 / 24%), rgb(255 255 255 / 45%)));
	}

	@media (prefers-reduced-motion: reduce) {
		.tile-icon {
			transition: none;
		}

		.tile:hover .tile-icon {
			transform: none;
		}
	}

	.details {
		margin-block-end: var(--space-9);
		padding: 0;
		overflow: hidden;
		background: var(--color-surface-card);
		border: var(--border-width) solid var(--color-border-subtle);
		border-radius: var(--radius-sm);
	}

	.back {
		display: inline-block;
		margin-block-start: calc(var(--space-5) + var(--space-1) * 2);
		margin-block-end: var(--space-4);
		margin-inline: calc(var(--space-5) + var(--space-1) * 2);
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

	.icon {
		display: inline-flex;
		font-size: 1.25rem;
	}

	a:focus-visible {
		outline: var(--outline-focus);
		outline-offset: var(--space-1);
	}

	@media (min-width: 48rem) {
		header {
			grid-template-areas: 'brand search tools';
			grid-template-columns: minmax(0, 1fr) minmax(0, min(22rem, 40%)) auto;
		}

		main {
			--tile-content-width: 7rem;
			--link-column-gap: var(--space-8);
			display: grid;
			grid-template-columns: repeat(auto-fill, var(--tile-content-width));
			column-gap: var(--link-column-gap);
			justify-content: center;
			padding: var(--space-9) var(--space-8);
		}
	}
</style>
