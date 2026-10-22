<script lang="ts">
	import { onMount, tick } from 'svelte';
	import IconSignOut from 'virtual:icons/ph/sign-out';
	import { afterNavigate, beforeNavigate, pushState, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import BookmarkLogo from '$lib/components/BookmarkLogo.svelte';
	import DetailContent from '$lib/components/DetailContent.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import Search from '$lib/components/Search.svelte';
	import { nextResultIndex } from '$lib/search/result-navigation.js';
	import type { DisplayLink } from '$lib/display/types.js';
	import type { SearchResult } from '$lib/search/engine.js';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();

	let searchResults = $state<SearchResult[] | null>(null);
	let searchStatus = $state<'idle' | 'loading' | 'ready' | 'failed'>('idle');
	let searchInput = $state<HTMLInputElement>();
	let resultGrid = $state<HTMLDivElement>();
	let focusedResultId = $state<string>();
	let resultColumnCount = $state(1);
	const resultRows = $derived.by(() => {
		const results = searchResults ?? [];
		const rows: SearchResult[][] = [];
		for (let index = 0; index < results.length; index += resultColumnCount) {
			rows.push(results.slice(index, index + resultColumnCount));
		}
		return rows;
	});
	const tabStopResultId = $derived(
		searchResults?.find((result) => result.link.id === focusedResultId)?.link.id ??
			searchResults?.[0]?.link.id
	);
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

	function findResultLink(id: string) {
		const links = resultGrid?.querySelectorAll<HTMLAnchorElement>('a.tile') ?? [];
		return Array.from(links).find((link) => link.getAttribute('href') === `/?link=${id}`);
	}

	function observeResultColumns(node: HTMLDivElement) {
		async function updateColumns() {
			const columns = getComputedStyle(node).gridTemplateColumns.split(' ').length;
			if (columns === resultColumnCount) return;
			const activeLink = node.contains(document.activeElement) ? document.activeElement : null;
			const activeId = focusedResultId;
			resultColumnCount = columns;
			await tick();
			if (!node.isConnected || !activeLink || activeLink.isConnected || !activeId) return;
			if (document.activeElement === document.body) {
				findResultLink(activeId)?.focus({ preventScroll: true });
			}
		}
		let animationFrame: number | undefined;
		function scheduleUpdate() {
			if (animationFrame !== undefined) return;
			animationFrame = requestAnimationFrame(() => {
				animationFrame = undefined;
				void updateColumns();
			});
		}
		scheduleUpdate();
		const observer = new ResizeObserver(scheduleUpdate);
		observer.observe(node);
		return {
			destroy() {
				observer.disconnect();
				if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
			}
		};
	}

	function tileTabIndex(id: string, filtered: boolean) {
		if (!filtered) return undefined;
		return id === tabStopResultId ? 0 : -1;
	}

	function enterResults(activateSingle: boolean) {
		const firstResult = resultGrid?.querySelector<HTMLAnchorElement>('a.tile');
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
		const links = Array.from(resultGrid?.querySelectorAll<HTMLAnchorElement>('a.tile') ?? []);
		const currentIndex = links.indexOf(event.target as HTMLAnchorElement);
		if (currentIndex === -1) return;
		event.preventDefault();
		const positions = links.map((link) => link.getBoundingClientRect());
		const nextIndex = nextResultIndex(positions, currentIndex, event.key);
		links[nextIndex]?.focus();
	}

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
			<Search
				directory={data.directory}
				bind:results={searchResults}
				bind:status={searchStatus}
				bind:input={searchInput}
				onQueryChange={cancelPendingOpen}
				onEnterResults={enterResults}
			/>
			<ThemeToggle />
			{#if data.signedIn}
				<form method="POST" action="?/signout">
					<button type="submit">
						<span class="icon"><IconSignOut aria-hidden="true" focusable="false" /></span>
						Sign out
					</button>
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

	{#snippet tile(link: DisplayLink, groupLabel: string | undefined, filtered = false)}
		<!-- eslint-disable svelte/no-navigation-without-resolve -- Root-only URLs must stay absolute in SSR. -->
		<a
			class="tile"
			href={`/?link=${link.id}`}
			data-sveltekit-preload-data="off"
			tabindex={tileTabIndex(link.id, filtered)}
			onfocus={() => {
				if (filtered) focusedResultId = link.id;
			}}
			onclick={(event) => openDetails(event, link.id)}
		>
			<BookmarkLogo {link} loading="lazy" />
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
					<p>1 bookmark found.</p>
				{:else}
					<p>{searchResults.length} bookmarks found.</p>
				{/if}
			{/if}
		</div>
		{#if searchResults?.length}
			<p id="search-keyboard-hint">
				Use arrow keys to move, Enter for details, Escape to return to Search.
			</p>
		{/if}
	</div>

	<div class="groups">
		{#if searchResults !== null}
			{#if searchResults.length > 0}
				<!-- svelte-ignore a11y_interactive_supports_focus (Focus roves between the real links inside grid cells.) -->
				<div
					bind:this={resultGrid}
					use:observeResultColumns
					class="link-grid"
					role="grid"
					aria-label="Search results"
					aria-describedby="search-keyboard-hint"
					onkeydown={navigateResults}
				>
					{#each resultRows as row, rowIndex (rowIndex)}
						<div role="row" class="result-row">
							{#each row as result (result.link.id)}
								<div role="gridcell">{@render tile(result.link, result.groupLabel, true)}</div>
							{/each}
						</div>
					{/each}
				</div>
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
		gap: var(--space-1);
		max-width: 100%;
		flex: 1 1 100%;
	}

	.header-actions form {
		margin: 0;
	}

	.header-actions :global(.search) {
		flex-basis: 100%;
		margin-block-end: var(--space-1);
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

	.search-feedback:has(p) {
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

	.result-row {
		display: grid;
		grid-template-columns: subgrid;
		grid-column: 1 / -1;
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

	.icon {
		display: inline-flex;
		font-size: 1.25rem;
	}

	button {
		display: inline-flex;
		align-items: center;
		gap: var(--space-4);
		color: var(--color-text);
		background: transparent;
		border: 0;
		border-radius: var(--radius-control);
		min-height: 44px;
		padding: var(--space-4);
		font: inherit;
		cursor: pointer;
	}

	button:hover {
		background: var(--color-surface-muted);
	}

	a:focus-visible,
	button:focus-visible {
		outline: var(--outline-focus);
		outline-offset: var(--space-1);
	}

	@media (min-width: 48rem) {
		.header-actions {
			flex: 1 1 28rem;
			flex-wrap: nowrap;
			gap: var(--space-4);
		}

		.header-actions :global(.search) {
			flex-basis: 18rem;
			max-width: 22rem;
			margin-block-end: 0;
		}

		.header-actions form {
			flex-shrink: 0;
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

		.details {
			padding: var(--space-8);
		}
	}
</style>
