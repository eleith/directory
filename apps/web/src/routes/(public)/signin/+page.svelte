<script lang="ts">
	import { onMount } from 'svelte';
	import IconWarningCircle from 'virtual:icons/ph/warning-circle';
	import IconLock from 'virtual:icons/ph/lock';
	import IconSignIn from 'virtual:icons/ph/sign-in';
	import Logo from '$lib/components/Logo.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
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
			<Logo source={data.logoPath} fallback="/favicon.png" size={48} loading="eager" />
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
					<Input
						bind:element={usernameInput}
						id="username"
						name="username"
						type="text"
						autocomplete="username"
						required
					/>
				</div>
				<div class="form-group">
					<label for="password">Password</label>
					<Input
						id="password"
						name="password"
						type="password"
						autocomplete="current-password"
						required
					/>
				</div>
				<Button variant="primary" type="submit">
					<span class="icon"><IconLock aria-hidden="true" focusable="false" /></span>
					Sign in
				</Button>
			{:else}
				<p class="sso-description">Use your single sign-on account to access the directory.</p>
				<Button bind:element={ssoButton} variant="primary" type="submit">
					<span class="icon"><IconSignIn aria-hidden="true" focusable="false" /></span>
					Sign in with single sign-on
				</Button>
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

	.icon {
		display: inline-flex;
		flex-shrink: 0;
		font-size: 1.25rem;
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
</style>
