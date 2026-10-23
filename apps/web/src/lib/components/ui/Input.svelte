<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLInputAttributes } from 'svelte/elements';
	import './controls.css';

	interface Props extends Omit<HTMLInputAttributes, 'type' | 'value' | 'children' | 'class'> {
		type?: 'text' | 'search' | 'password' | 'url';
		value?: string;
		element?: HTMLInputElement | undefined;
		leading?: Snippet | undefined;
		trailing?: Snippet | undefined;
		class?: HTMLInputAttributes['class'];
	}

	const uid = $props.id();

	let {
		id = uid,
		type = 'text',
		value = $bindable<string>(''),
		element = $bindable<HTMLInputElement | undefined>(),
		leading,
		trailing,
		disabled = false,
		readonly = false,
		class: className,
		...restNativeAttrs
	}: Props = $props();
</script>

<div
	class={[
		'ui-input',
		type === 'search' && 'ui-input--search',
		readonly && 'ui-input--readonly',
		disabled && 'ui-input--disabled',
		leading && 'ui-input--leading',
		trailing && 'ui-input--trailing',
		className
	]}
>
	{#if leading}
		<label class="ui-input__leading" for={id}>{@render leading()}</label>
	{/if}
	<input
		{...restNativeAttrs}
		{id}
		{type}
		{disabled}
		{readonly}
		class="ui-input__control"
		bind:value
		bind:this={element}
	/>
	{#if trailing}
		<div class="ui-input__trailing">{@render trailing()}</div>
	{/if}
</div>
