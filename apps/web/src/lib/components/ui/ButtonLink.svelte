<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAnchorAttributes } from 'svelte/elements';
	import './controls.css';

	interface Props extends HTMLAnchorAttributes {
		children: Snippet;
		href: string;
		variant?: 'primary' | 'quiet';
		element?: HTMLAnchorElement | undefined;
	}

	let {
		children,
		href,
		variant = 'primary',
		element = $bindable<HTMLAnchorElement | undefined>(),
		class: className,
		...restNativeAttrs
	}: Props = $props();
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- Callers supply external destinations or already-resolved application URLs. -->
<a
	{...restNativeAttrs}
	{href}
	class={['ui-button', `ui-button--${variant}`, className]}
	bind:this={element}
>
	{@render children()}
</a>
<!-- eslint-enable svelte/no-navigation-without-resolve -->
