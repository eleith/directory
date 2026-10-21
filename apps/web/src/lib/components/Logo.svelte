<script lang="ts">
	import { onMount } from 'svelte';

	interface Props {
		readonly source?: string | undefined;
		readonly fallback: string;
		readonly size: number;
		readonly loading?: 'eager' | 'lazy' | undefined;
	}

	let { source, fallback, size, loading }: Props = $props();
	let image = $state<HTMLImageElement>();
	let failed = $state(false);
	let previousInput: { source: string | undefined; fallback: string } | undefined;
	const primary = $derived(source ?? fallback);
	const resolvedSource = $derived(failed ? fallback : primary);

	$effect.pre(() => {
		if (previousInput && (previousInput.source !== source || previousInput.fallback !== fallback)) {
			failed = false;
		}
		previousInput = { source, fallback };
	});

	function useFallback() {
		if (
			image?.complete &&
			image.naturalWidth === 0 &&
			image.getAttribute('src') === primary &&
			primary !== fallback
		) {
			failed = true;
		}
	}

	onMount(() => {
		// The SSR image can fail before hydration attaches its error listener.
		if (image?.complete && image.naturalWidth === 0) useFallback();
	});
</script>

<img
	bind:this={image}
	src={resolvedSource}
	alt=""
	width={size}
	height={size}
	{loading}
	onerror={useFallback}
/>

<style>
	img {
		display: block;
		object-fit: contain;
		border-radius: var(--radius-sm);
	}
</style>
