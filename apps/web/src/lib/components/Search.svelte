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
	import { beforeNavigate, afterNavigate } from '$app/navigation';
	import type { DirectoryDisplay } from '$lib/display/types.js';
	import type { SearchResult } from '$lib/search/engine.js';

	let {
		directory,
		results = $bindable(null)
	}: {
		directory: DirectoryDisplay;
		results: SearchResult[] | null;
	} = $props();

	let query = $state('');
	let mounted = $state(false);
	let navigating = $state(false);
	let activationRequestVersion = $state(0);
	let status = $state<'idle' | 'loading' | 'ready' | 'failed'>('idle');
	let input: HTMLInputElement;
	let search: ReturnType<typeof import('$lib/search/engine.js').createSearch> | undefined;
	let indexedSnapshotId: string | undefined;
	let searchRequestVersion = 0;
	let searchUnavailable = false;

	async function updateSearch(snapshot: DirectoryDisplay, currentQuery: string) {
		const requestVersion = ++searchRequestVersion;
		const trimmedQuery = currentQuery.trim();
		results = null;
		if (searchUnavailable) return;
		if (indexedSnapshotId !== snapshot.snapshotId) {
			search = undefined;
			indexedSnapshotId = undefined;
		}
		try {
			if (!search) {
				status = 'loading';
				const engine = await loadEngine();
				if (!mounted || navigating || requestVersion !== searchRequestVersion) return;
				if (directory.snapshotId !== snapshot.snapshotId) return;
				search = engine.createSearch(snapshot);
				indexedSnapshotId = snapshot.snapshotId;
			}
			if (trimmedQuery) results = search(trimmedQuery);
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
		query = '';
		input.focus();
	}

	$effect(() => {
		if (!mounted || navigating || activationRequestVersion === 0) return;
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
	<label for="directory-search">Search</label>
	<div class="search-controls">
		<input
			bind:this={input}
			bind:value={query}
			id="directory-search"
			type="search"
			placeholder="Search bookmarks"
			disabled={!mounted}
			onfocus={() => activationRequestVersion++}
			oninput={() => activationRequestVersion++}
		/>
		{#if query}
			<button type="button" aria-label="Clear search" onclick={clearSearch}>Clear</button>
		{/if}
	</div>
	<div class="status" role="status" aria-atomic="true">
		{#if status === 'failed'}
			<p>Search unavailable. Reload to try again.</p>
		{:else if status === 'loading'}
			<p>Loading search…</p>
		{:else if results !== null}
			{#if results.length === 0}
				<p>No bookmarks found.</p>
			{:else if results.length === 1}
				<p>1 bookmark found.</p>
			{:else}
				<p>{results.length} bookmarks found.</p>
			{/if}
		{/if}
	</div>
</div>

<style>
	.search {
		flex: 1 1 12rem;
		max-width: 22rem;
		min-width: 0;
	}

	label {
		display: block;
		font-size: var(--font-size-sm);
		margin-block-end: var(--space-1);
	}

	.search-controls {
		display: flex;
		gap: var(--space-1);
	}

	input {
		min-width: 0;
		width: 100%;
	}

	input,
	button {
		font: inherit;
		color: var(--color-text);
		background: var(--color-surface-page);
		border: var(--border-width) solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		padding: var(--space-4);
	}

	button {
		flex-shrink: 0;
		cursor: pointer;
	}

	input:focus-visible,
	button:focus-visible {
		outline: var(--outline-focus);
		outline-offset: var(--space-1);
	}

	.status {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
</style>
