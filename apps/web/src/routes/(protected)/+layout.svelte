<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types.js';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();
</script>

<div
	class="directory-theme"
	style:--directory-primary-light={data.appearance.primary_light_color}
	style:--directory-primary-dark={data.appearance.primary_dark_color}
>
	{@render children()}
</div>
