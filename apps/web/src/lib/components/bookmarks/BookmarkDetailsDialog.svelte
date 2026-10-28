<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { Dialog } from 'bits-ui';
	import IconX from 'virtual:icons/ph/x';
	import IconCaretLeft from 'virtual:icons/ph/caret-left';
	import IconCaretRight from 'virtual:icons/ph/caret-right';
	import type { DisplayLink } from '$lib/display/types.js';
	import BookmarkDetails from './BookmarkDetails.svelte';
	import Button from '../ui/Button.svelte';

	let {
		link,
		groupLabel,
		openLinksInNewTab,
		hasPrevious,
		hasNext,
		onNavigate,
		onClose,
		onClosed,
		onFilterSelect
	}: {
		link?: DisplayLink | undefined;
		groupLabel?: string | undefined;
		openLinksInNewTab: boolean;
		hasPrevious: boolean;
		hasNext: boolean;
		onNavigate: (step: -1 | 1) => void;
		onClose: () => void;
		onClosed: () => void;
		onFilterSelect: (query: string) => void;
	} = $props();

	let retainedDetails = $state<{ link: DisplayLink; groupLabel?: string | undefined } | undefined>(
		untrack(() => (link ? { link, groupLabel } : undefined))
	);
	let openAction = $state<HTMLAnchorElement>();
	let scrollContent = $state<HTMLDivElement>();
	let previousButton = $state<HTMLButtonElement>();
	let nextButton = $state<HTMLButtonElement>();

	$effect.pre(() => {
		if (link) retainedDetails = { link, groupLabel };
	});

	function focusOpenAction(event: Event) {
		if (!openAction) return;
		event.preventDefault();
		openAction.focus();
	}

	async function navigate(event: MouseEvent, step: -1 | 1) {
		const button = event.currentTarget as HTMLButtonElement;
		const hadFocus = button === document.activeElement;
		onNavigate(step);
		await tick();
		if (scrollContent) scrollContent.scrollTop = 0;
		if (hadFocus && button.disabled) {
			(step === 1 ? previousButton : nextButton)?.focus({ preventScroll: true });
		}
	}

	function handleNavigationKeydown(event: KeyboardEvent) {
		if (!link || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
		if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		const editing = event
			.composedPath()
			.some(
				(target) =>
					target instanceof HTMLElement &&
					(target.isContentEditable || target.matches('input, textarea, select, [role="textbox"]'))
			);
		if (editing) return;
		const button = event.key === 'ArrowLeft' ? previousButton : nextButton;
		if (!button || button.disabled || !button.checkVisibility()) return;
		event.preventDefault();
		button.focus({ preventScroll: true });
		button.click();
	}

	async function handleOpenChangeComplete(open: boolean) {
		if (open || link || !retainedDetails) return;
		retainedDetails = undefined;
		await tick();
		if (!link && !retainedDetails) onClosed();
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
				onkeydown={handleNavigationKeydown}
				onOpenAutoFocus={focusOpenAction}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
				}}
			>
				{#snippet child({ props })}
					<section {...props} class="details" inert={!link}>
						<div class="card">
							<div class="scroll-content" bind:this={scrollContent}>
								<Dialog.Title aria-live="polite" aria-atomic="true">
									{#snippet child({ props: titleProps })}
										<BookmarkDetails
											link={details.link}
											groupLabel={details.groupLabel}
											{openLinksInNewTab}
											bind:openAction
											headingAttributes={titleProps}
											reserveCloseSpace
											{onFilterSelect}
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
						</div>
						{#if hasPrevious || hasNext}
							<div class="navigation">
								<div class="previous">
									<Button
										size="icon"
										aria-label="Previous bookmark"
										aria-keyshortcuts="ArrowLeft"
										disabled={!hasPrevious}
										bind:element={previousButton}
										onclick={(event) => navigate(event, -1)}
									>
										<IconCaretLeft
											width="2rem"
											height="2rem"
											aria-hidden="true"
											focusable="false"
										/>
									</Button>
								</div>
								<div class="next">
									<Button
										size="icon"
										aria-label="Next bookmark"
										aria-keyshortcuts="ArrowRight"
										disabled={!hasNext}
										bind:element={nextButton}
										onclick={(event) => navigate(event, 1)}
									>
										<IconCaretRight
											width="2rem"
											height="2rem"
											aria-hidden="true"
											focusable="false"
										/>
									</Button>
								</div>
							</div>
						{/if}
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
		overflow-wrap: anywhere;
	}

	.card {
		position: relative;
		display: flex;
		flex-direction: column;
		min-height: 0;
		max-height: inherit;
		background: var(--color-surface-card);
		border: var(--border-width) solid var(--color-border-subtle);
		border-radius: 1.5rem 1.5rem 0 0;
		box-shadow: 0 -8px 24px rgb(0 0 0 / 12%);
		overflow: hidden;
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

	.navigation {
		display: none;
	}

	.navigation :global(button.ui-button) {
		color: #fff;
		background: transparent;
		box-shadow: none;
		outline-color: currentColor;
	}

	@media (min-width: 48rem) {
		.details {
			inset: 50% auto auto 50%;
			width: min(32rem, calc(100vw - var(--space-8)));
			transform: translate(-50%, -50%);
		}

		.card {
			border-radius: var(--radius-card);
			box-shadow: 0 1rem 3rem rgb(0 0 0 / 18%);
		}

		.navigation {
			display: block;
		}

		.navigation > div {
			position: absolute;
			top: 50%;
			transform: translateY(-50%);
		}

		.previous {
			inset-inline-end: calc(100% + var(--space-5));
		}

		.next {
			inset-inline-start: calc(100% + var(--space-5));
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
