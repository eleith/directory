<script lang="ts">
	import Logo from '../Logo.svelte';
	import type { DisplayLink } from '$lib/display/types.js';

	interface Props {
		readonly link: DisplayLink;
		readonly loading?: 'eager' | 'lazy';
	}

	let { link, loading }: Props = $props();
	const fallback = $derived(`/bookmarks/${link.id}/logo`);
</script>

<Logo source={link.logo_path} {fallback} size={64} {loading} />
