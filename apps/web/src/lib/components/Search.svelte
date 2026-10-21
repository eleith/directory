<script module lang="ts">
	let engineImport: Promise<typeof import('$lib/search/engine.js')> | undefined;

	function loadEngine() {
		engineImport ??= import('$lib/search/engine.js').catch((error: unknown) => {
			engineImport = undefined;
			throw error;
		});
		return engineImport;
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import IconMagnifyingGlass from 'virtual:icons/ph/magnifying-glass';
	import IconX from 'virtual:icons/ph/x';
	import { beforeNavigate, afterNavigate } from '$app/navigation';
	import type { DirectoryDisplay } from '$lib/display/types.js';
	import type { SearchResult } from '$lib/search/engine.js';

	let {
		directory,
		results = $bindable(null),
		status = $bindable('idle'),
		input = $bindable(),
		onQueryChange,
		onEnterResults
	}: {
		directory: DirectoryDisplay;
		results: SearchResult[] | null;
		status: 'idle' | 'loading' | 'ready' | 'failed';
		input: HTMLInputElement | undefined;
		onQueryChange: () => void;
		onEnterResults: (activateSingle: boolean) => void;
	} = $props();

	let query = $state('');
	let mounted = $state(false);
	let navigating = $state(false);
	let activated = $state(false);
	let completedQuery: string | undefined;
	let search: ReturnType<typeof import('$lib/search/engine.js').createSearch> | undefined;
	let indexedSnapshotId: string | undefined;
	let searchRequestVersion = 0;
	let searchUnavailable = false;

	async function updateSearch(snapshot: DirectoryDisplay, currentQuery: string) {
		const requestVersion = ++searchRequestVersion;
		const trimmedQuery = currentQuery.trim();
		if (searchUnavailable) return;
		if (!trimmedQuery) results = null;
		if (indexedSnapshotId !== snapshot.snapshotId) {
			search = undefined;
			indexedSnapshotId = undefined;
		}
		try {
			if (!search) {
				status = trimmedQuery ? 'loading' : 'idle';
				const engine = await loadEngine();
				if (!mounted || navigating || requestVersion !== searchRequestVersion) return;
				if (directory.snapshotId !== snapshot.snapshotId) return;
				search = engine.createSearch(snapshot);
				indexedSnapshotId = snapshot.snapshotId;
			}
			if (trimmedQuery) results = search(trimmedQuery);
			completedQuery = currentQuery;
			status = 'ready';
		} catch {
			if (!mounted || navigating || requestVersion !== searchRequestVersion) return;
			if (directory.snapshotId !== snapshot.snapshotId) return;
			searchUnavailable = true;
			status = 'failed';
			results = null;
		}
	}

	function clearSearch() {
		onQueryChange();
		query = '';
		input?.focus();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.isComposing || event.keyCode === 229) return;
		if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			clearSearch();
			return;
		}
		if (event.key !== 'Enter' && event.key !== 'ArrowDown') return;
		event.preventDefault();
		if (status !== 'ready' || completedQuery !== query || results === null) return;
		if (indexedSnapshotId !== directory.snapshotId || results.length === 0) return;
		onEnterResults(event.key === 'Enter' && results.length === 1);
	}

	$effect(() => {
		if (!mounted || navigating || !activated) return;
		void updateSearch(directory, query);
		return () => {
			searchRequestVersion++;
		};
	});

	beforeNavigate(() => {
		navigating = true;
		searchRequestVersion++;
	});
	afterNavigate(() => {
		navigating = false;
	});
	onMount(() => {
		mounted = true;
		return () => {
			mounted = false;
			searchRequestVersion++;
		};
	});
</script>

<div class="search">
	<label class="visually-hidden" for="directory-search">Search</label>
	<div class="search-controls">
		<IconMagnifyingGlass class="icon magnifier" aria-hidden="true" focusable="false" />
		<input
			bind:this={input}
			bind:value={query}
			id="directory-search"
			type="search"
			placeholder="Search"
			disabled={!mounted}
			onfocus={() => (activated = true)}
			oninput={() => {
				onQueryChange();
				activated = true;
			}}
			onkeydown={handleKeydown}
		/>
		{#if query}
			<button type="button" aria-label="Clear search" onclick={clearSearch}>
				<IconX class="icon" aria-hidden="true" focusable="false" />
			</button>
		{/if}
	</div>
</div>

<style>
	.search {
		flex: 1 1 18rem;
		min-width: 0;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.search-controls {
		position: relative;
	}

	input {
		box-sizing: border-box;
		min-width: 0;
		width: 100%;
		min-height: 48px;
		padding: var(--space-4) 48px var(--space-4) 44px;
		font: inherit;
		color: var(--color-text);
		background: var(--color-surface-muted);
		border: 0;
		border-radius: var(--radius-card);
	}

	input::placeholder {
		color: var(--color-text-muted);
		opacity: 1;
	}

	input::-webkit-search-cancel-button {
		-webkit-appearance: none;
	}

	.search-controls :global(.icon) {
		width: 1.25rem;
		height: 1.25rem;
	}

	.search-controls :global(.magnifier) {
		position: absolute;
		inset-inline-start: var(--space-5);
		top: 50%;
		transform: translateY(-50%);
		color: var(--color-text-muted);
		pointer-events: none;
	}

	button {
		position: absolute;
		inset-inline-end: var(--space-1);
		top: 50%;
		transform: translateY(-50%);
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		padding: 0;
		font-size: inherit;
		color: var(--color-text-muted);
		background: transparent;
		border: 0;
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	button:hover {
		background: var(--color-surface-muted);
	}

	input:focus-visible,
	button:focus-visible {
		outline: var(--outline-focus);
		outline-offset: var(--space-1);
	}
</style>
