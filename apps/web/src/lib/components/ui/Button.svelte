<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import './controls.css';

	interface Props extends HTMLButtonAttributes {
		children: Snippet;
		variant?: 'quiet' | 'surface' | 'primary' | 'chip' | 'access-chip';
		size?: 'default' | 'icon';
		element?: HTMLButtonElement | undefined;
	}

	let {
		children,
		variant = 'quiet',
		size = 'default',
		element = $bindable<HTMLButtonElement | undefined>(),
		type = 'button',
		class: className,
		...restNativeAttrs
	}: Props = $props();
</script>

<button
	{...restNativeAttrs}
	{type}
	class={['ui-button', `ui-button--${variant}`, size === 'icon' && 'ui-button--icon', className]}
	bind:this={element}
>
	{@render children()}
</button>
