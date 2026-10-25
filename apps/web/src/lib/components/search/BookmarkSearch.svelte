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
	import Button from '../ui/Button.svelte';
	import Input from '../ui/Input.svelte';
	import { beforeNavigate, afterNavigate } from '$app/navigation';
	import type { DirectoryDisplay } from '$lib/display/types.js';
	import type { SearchResult } from '$lib/search/engine.js';

	let {
		directory,
		query = $bindable(''),
		results = $bindable(null),
		status = $bindable('idle'),
		input = $bindable(),
		onEnterResults
	}: {
		directory: DirectoryDisplay;
		query?: string;
		results: SearchResult[] | null;
		status: 'idle' | 'loading' | 'ready' | 'failed';
		input: HTMLInputElement | undefined;
		onEnterResults: (activateSingle: boolean) => void;
	} = $props();

	let mounted = $state(false);
	let macKeyboard = $state(false);
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
		if (query.trim()) activated = true;
	});
	onMount(() => {
		macKeyboard = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
		activated = Boolean(query.trim());
		mounted = true;
		return () => {
			mounted = false;
			searchRequestVersion++;
		};
	});
</script>

{#snippet magnifier()}
	<IconMagnifyingGlass
		class="icon"
		width="1.25rem"
		height="1.25rem"
		aria-hidden="true"
		focusable="false"
	/>
{/snippet}

{#snippet clearButton()}
	<Button size="icon" aria-label="Clear search" disabled={!mounted} onclick={clearSearch}>
		<IconX class="icon" width="1.25rem" height="1.25rem" aria-hidden="true" focusable="false" />
	</Button>
{/snippet}

<div class="search">
	<label class="visually-hidden" for="directory-search">Search</label>
	<Input
		class="search-controls"
		bind:element={input}
		bind:value={query}
		id="directory-search"
		type="search"
		placeholder={macKeyboard ? 'Search · ⌥/' : 'Search · Alt+/'}
		aria-keyshortcuts="Alt+/"
		disabled={!mounted}
		leading={magnifier}
		trailing={query ? clearButton : undefined}
		onfocus={() => (activated = true)}
		oninput={() => (activated = true)}
		onkeydown={handleKeydown}
	/>
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
</style>
