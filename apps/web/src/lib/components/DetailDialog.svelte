<script lang="ts">
	import { Dialog } from 'bits-ui';
	import IconX from 'virtual:icons/ph/x';
	import type { DisplayLink } from '$lib/display/types.js';
	import DetailContent from './DetailContent.svelte';

	let {
		link,
		groupLabel,
		onClose,
		onReturnFocus
	}: {
		link: DisplayLink;
		groupLabel?: string | undefined;
		onClose: () => void;
		onReturnFocus: () => void;
	} = $props();

	let dialogElement: HTMLElement | undefined = $state();
</script>

<Dialog.Root
	bind:open={
		() => true,
		(open) => {
			if (!open) onClose();
		}
	}
>
	<Dialog.Portal>
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
				onReturnFocus();
			}}
		>
			{#snippet child({ props })}
				<section {...props} bind:this={dialogElement} class="details">
					<div class="scroll-content">
						<DetailContent {link} {groupLabel}>
							{#snippet title(text)}
								<Dialog.Title>
									{#snippet child({ props: titleProps })}
										<h2 {...titleProps}>{text}</h2>
									{/snippet}
								</Dialog.Title>
							{/snippet}
						</DetailContent>
					</div>
					<Dialog.Close>
						{#snippet child({ props: closeProps })}
							<button {...closeProps} class="close" aria-label="Close">
								<IconX aria-hidden="true" focusable="false" />
							</button>
						{/snippet}
					</Dialog.Close>
				</section>
			{/snippet}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 10;
		background: rgb(0 0 0 / 45%);
		backdrop-filter: blur(3px);
		animation: backdrop-fade-in 0.15s ease-out;
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
		animation: sheet-slide-up 0.2s ease-out;
	}

	.scroll-content {
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 0;
	}

	.close {
		position: absolute;
		inset-block-start: var(--space-4);
		inset-inline-end: var(--space-4);
		z-index: 1;
		min-width: 44px;
		min-height: 44px;
		display: grid;
		place-items: center;
		padding: var(--space-4);
		font-size: 1.25rem;
		color: var(--color-text-muted);
		background: var(--color-surface-card);
		border: 0;
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.scroll-content :global(.identity) {
		padding-inline-end: 44px;
	}

	.close:hover {
		background: var(--color-surface-muted);
	}

	.close:focus-visible {
		outline: var(--outline-focus);
		outline-offset: var(--space-1);
	}

	@media (min-width: 48rem) {
		.details {
			inset: 50% auto auto 50%;
			width: min(32rem, calc(100vw - var(--space-8)));
			transform: translate(-50%, -50%);
			border-radius: var(--radius-card);
			box-shadow: 0 1rem 3rem rgb(0 0 0 / 18%);
			animation: none;
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

	@keyframes sheet-slide-up {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.overlay,
		.details {
			animation: none;
		}
	}
</style>
