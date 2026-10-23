<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { Dialog } from 'bits-ui';
	import IconX from 'virtual:icons/ph/x';
	import type { DisplayLink } from '$lib/display/types.js';
	import DetailContent from './DetailContent.svelte';
	import Button from './ui/Button.svelte';

	let {
		link,
		groupLabel,
		onClose,
		onReturnFocus,
		onTagSearch
	}: {
		link?: DisplayLink | undefined;
		groupLabel?: string | undefined;
		onClose: () => void;
		onReturnFocus: () => void;
		onTagSearch: (query: string) => void;
	} = $props();

	let retainedDetails = $state<{ link: DisplayLink; groupLabel?: string | undefined } | undefined>(
		untrack(() => (link ? { link, groupLabel } : undefined))
	);
	let dialogElement: HTMLElement | undefined = $state();

	$effect.pre(() => {
		if (link) retainedDetails = { link, groupLabel };
	});

	async function handleOpenChangeComplete(open: boolean) {
		if (open || link || !retainedDetails) return;
		retainedDetails = undefined;
		await tick();
		if (!link && !retainedDetails) onReturnFocus();
	}
</script>

<Dialog.Root
	bind:open={
		() => Boolean(link),
		(open) => {
			if (!open) onClose();
		}
	}
	onOpenChangeComplete={handleOpenChangeComplete}
>
	<Dialog.Portal>
		{#if retainedDetails}
			{@const details = retainedDetails}
			<Dialog.Overlay>
				{#snippet child({ props })}
					<div {...props} class="overlay"></div>
				{/snippet}
			</Dialog.Overlay>
			<Dialog.Content
				onOpenAutoFocus={(event) => {
					const action = dialogElement?.querySelector<HTMLAnchorElement>('.open-service');
					if (!action) return;
					event.preventDefault();
					action.focus();
				}}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
				}}
			>
				{#snippet child({ props })}
					<section {...props} bind:this={dialogElement} class="details" inert={!link}>
						<div class="scroll-content">
							<Dialog.Title>
								{#snippet child({ props: titleProps })}
									<DetailContent
										link={details.link}
										groupLabel={details.groupLabel}
										headingAttributes={titleProps}
										reserveCloseSpace
										{onTagSearch}
									/>
								{/snippet}
							</Dialog.Title>
						</div>
						<div class="close">
							<Dialog.Close>
								{#snippet child({ props: closeProps })}
									<Button {...closeProps} variant="surface" size="icon" aria-label="Close">
										<IconX aria-hidden="true" focusable="false" />
									</Button>
								{/snippet}
							</Dialog.Close>
						</div>
					</section>
				{/snippet}
			</Dialog.Content>
		{/if}
	</Dialog.Portal>
</Dialog.Root>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 10;
		background: rgb(0 0 0 / 45%);
		backdrop-filter: blur(3px);
	}

	.overlay[data-state='open'] {
		animation: backdrop-fade-in 0.15s ease-out;
	}

	.overlay[data-state='closed'] {
		animation: backdrop-fade-out 0.15s ease-in forwards;
	}

	.details {
		position: fixed;
		inset: auto 0 0;
		z-index: 11;
		display: flex;
		flex-direction: column;
		max-height: calc(100dvh - var(--space-8));
		padding: 0;
		color: var(--color-text);
		background: var(--color-surface-card);
		border: var(--border-width) solid var(--color-border-subtle);
		border-radius: 1.5rem 1.5rem 0 0;
		box-shadow: 0 -8px 24px rgb(0 0 0 / 12%);
		overflow: hidden;
		overflow-wrap: anywhere;
	}

	.details[data-state='open'] {
		animation: sheet-slide-up 0.2s ease-out;
	}

	.details[data-state='closed'] {
		animation: sheet-slide-down 0.2s ease-in forwards;
	}

	.scroll-content {
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 0;
	}

	.close {
		display: flex;
		position: absolute;
		inset-block-start: var(--space-4);
		inset-inline-end: var(--space-4);
		z-index: 1;
	}

	@media (min-width: 48rem) {
		.details {
			inset: 50% auto auto 50%;
			width: min(32rem, calc(100vw - var(--space-8)));
			transform: translate(-50%, -50%);
			border-radius: var(--radius-card);
			box-shadow: 0 1rem 3rem rgb(0 0 0 / 18%);
		}

		.details[data-state='open'] {
			animation: card-fade-in 0.15s ease-out;
		}

		.details[data-state='closed'] {
			animation: card-fade-out 0.15s ease-in forwards;
		}
	}

	@keyframes backdrop-fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes backdrop-fade-out {
		from {
			opacity: 1;
		}
		to {
			opacity: 0;
		}
	}

	@keyframes sheet-slide-up {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}

	@keyframes sheet-slide-down {
		from {
			transform: translateY(0);
		}
		to {
			transform: translateY(100%);
		}
	}

	@keyframes card-fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes card-fade-out {
		from {
			opacity: 1;
		}
		to {
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.overlay[data-state],
		.details[data-state] {
			animation: none;
		}
	}
</style>
