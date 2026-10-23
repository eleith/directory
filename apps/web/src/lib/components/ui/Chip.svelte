<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import Button from './Button.svelte';
	import './controls.css';

	interface Props {
		children: Snippet;
		access?: boolean;
		onclick?: HTMLButtonAttributes['onclick'];
		class?: HTMLButtonAttributes['class'];
		'aria-label'?: HTMLButtonAttributes['aria-label'];
		title?: HTMLButtonAttributes['title'];
	}

	let {
		children,
		access = false,
		onclick,
		class: className,
		'aria-label': ariaLabel,
		title
	}: Props = $props();
</script>

{#if onclick}
	<Button
		variant={access ? 'access-chip' : 'chip'}
		{onclick}
		class={className}
		aria-label={ariaLabel}
		{title}
	>
		{@render children()}
	</Button>
{:else}
	<span class={['ui-chip', access && 'ui-chip--access', className]} aria-label={ariaLabel} {title}>
		{@render children()}
	</span>
{/if}
