<script lang="ts">
	import { onMount } from 'svelte';
	import type { DisplayLink } from '$lib/display/types.js';

	interface Props {
		readonly link: DisplayLink;
		readonly loading?: 'eager' | 'lazy';
	}

	let { link, loading }: Props = $props();
	let image = $state<HTMLImageElement>();
	let failed = $state(false);
	let previousInput: { id: string; source: string } | undefined;
	const fallback = $derived(`/bookmarks/${link.id}/logo`);
	const source = $derived(failed ? fallback : link.logo_path);

	$effect.pre(() => {
		if (
			previousInput &&
			(previousInput.id !== link.id || previousInput.source !== link.logo_path)
		) {
			failed = false;
		}
		previousInput = { id: link.id, source: link.logo_path };
	});

	function useFallback() {
		if (
			image?.complete &&
			image.naturalWidth === 0 &&
			image.getAttribute('src') === link.logo_path &&
			link.logo_path !== fallback
		) {
			failed = true;
		}
	}

	onMount(() => {
		// The SSR image can fail before hydration attaches its error listener.
		if (image?.complete && image.naturalWidth === 0) useFallback();
	});
</script>

<img bind:this={image} src={source} alt="" width="64" height="64" {loading} onerror={useFallback} />

<style>
	img {
		display: block;
		object-fit: contain;
		border-radius: var(--radius-sm);
	}
</style>
