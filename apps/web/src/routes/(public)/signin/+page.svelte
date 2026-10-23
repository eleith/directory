<script lang="ts">
	import { onMount } from 'svelte';
	import IconWarningCircle from 'virtual:icons/ph/warning-circle';
	import IconLock from 'virtual:icons/ph/lock';
	import IconSignIn from 'virtual:icons/ph/sign-in';
	import Logo from '$lib/components/Logo.svelte';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();
	let usernameInput = $state<HTMLInputElement>();
	let ssoButton = $state<HTMLButtonElement>();

	onMount(() => {
		if (!window.matchMedia('(min-width: 48rem) and (pointer: fine)').matches) return;
		if (data.strategy === 'credentials') usernameInput?.focus();
		else ssoButton?.focus();
	});
</script>

<svelte:head>
	<title>Sign in — {data.title}</title>
</svelte:head>

<div class="signin-container">
	<main class="signin-card">
		<header>
			<Logo source={data.logoPath} fallback="/favicon.svg" size={48} loading="eager" />
			<h1>Sign in to {data.title}</h1>
			<p>Your family's directory of services.</p>
		</header>

		{#if data.error === 'credentials'}
			<p class="error-banner" role="alert">
				<span class="icon"><IconWarningCircle aria-hidden="true" focusable="false" /></span>
				<span>Invalid username or password. Please try again.</span>
			</p>
		{:else if data.error === 'authentication'}
			<p class="error-banner" role="alert">
				<span class="icon"><IconWarningCircle aria-hidden="true" focusable="false" /></span>
				<span>Unable to sign in. Please try again.</span>
			</p>
		{/if}

		<form method="POST">
			<input type="hidden" name="redirectTo" value={data.callbackUrl} />

			{#if data.strategy === 'credentials'}
				<div class="form-group">
					<label for="username">Username</label>
					<input
						bind:this={usernameInput}
						id="username"
						name="username"
						type="text"
						autocomplete="username"
						required
					/>
				</div>
				<div class="form-group">
					<label for="password">Password</label>
					<input
						id="password"
						name="password"
						type="password"
						autocomplete="current-password"
						required
					/>
				</div>
				<button type="submit">
					<span class="icon"><IconLock aria-hidden="true" focusable="false" /></span>
					Sign in
				</button>
			{:else}
				<p class="sso-description">Use your single sign-on account to access the directory.</p>
				<button bind:this={ssoButton} type="submit">
					<span class="icon"><IconSignIn aria-hidden="true" focusable="false" /></span>
					Sign in with single sign-on
				</button>
			{/if}
		</form>
	</main>
</div>

<style>
	.signin-container {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100svh;
		padding: var(--space-9) var(--space-5);
	}

	.signin-card {
		width: 100%;
		max-width: 25rem;
		display: grid;
		gap: 1.5rem;
		padding: var(--space-8);
		background: var(--color-surface-card);
		border: var(--border-width) solid var(--color-border-subtle);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
	}

	header {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-5);
		text-align: center;
	}

	h1 {
		font-size: 1.5rem;
		line-height: var(--line-height-heading);
		letter-spacing: -0.01em;
		overflow-wrap: anywhere;
	}

	header p {
		margin-block-start: -0.5rem;
		color: var(--color-text-muted);
	}

	.error-banner {
		display: flex;
		align-items: flex-start;
		gap: var(--space-4);
		padding: var(--space-4) var(--space-5);
		color: var(--color-danger);
		background: var(--color-danger-bg);
		border: var(--border-width) solid var(--color-danger-border);
		border-radius: var(--radius-control);
	}

	form {
		display: grid;
		gap: 1.25rem;
	}

	.form-group {
		display: grid;
		gap: 0.5rem;
	}

	label {
		font-weight: 600;
	}

	input {
		width: 100%;
		min-width: 0;
		color: var(--color-text);
		background: var(--color-surface-page);
		border: var(--border-width) solid var(--color-border-strong);
		transition: border-color var(--transition-control);
	}

	button,
	input {
		min-height: 3rem;
		border-radius: var(--radius-control);
		padding: var(--space-4) var(--space-5);
	}

	input:not(:disabled):hover {
		background: color-mix(in srgb, var(--color-text) 8%, var(--color-surface-card));
		box-shadow: inset 0 0 0 var(--border-width) var(--color-border-strong);
	}

	input:not(:disabled):focus {
		background: color-mix(in srgb, var(--color-primary) 16%, var(--color-surface-card));
		border-color: var(--color-primary);
		box-shadow: none;
		outline: var(--outline-focus);
		outline-offset: calc(-1 * var(--space-1));
	}

	.icon {
		display: inline-flex;
		flex-shrink: 0;
		font-size: 1.25rem;
	}

	button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-4);
		color: var(--color-on-primary);
		background: var(--color-primary);
		border: var(--border-width) solid transparent;
		font-weight: 600;
		cursor: pointer;
		transition:
			box-shadow var(--transition-control),
			transform var(--transition-control);
	}

	button:hover {
		box-shadow: inset 0 0 0 2px currentColor;
	}

	button:active {
		box-shadow: inset 0 0 0 3px currentColor;
		transform: scale(0.98);
	}

	button:focus-visible {
		outline: var(--outline-focus);
		outline-offset: var(--space-1);
	}

	.sso-description {
		color: var(--color-text-muted);
		text-align: center;
	}

	@media (max-width: 30rem) {
		.signin-container {
			align-items: flex-start;
			padding-block-start: 4rem;
		}

		.signin-card {
			padding: var(--space-5);
			border: none;
			box-shadow: none;
			background: transparent;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		button,
		input {
			transition: none;
		}

		button:active {
			transform: none;
		}
	}
</style>
