<script lang="ts">
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Sign in — {data.title}</title>
</svelte:head>

<main>
	<header>
		<img src="/favicon.svg" alt="" />
		<h1>Sign in to {data.title}</h1>
	</header>

	{#if data.error === 'credentials'}
		<p role="alert">Invalid username or password. Please try again.</p>
	{:else if data.error === 'authentication'}
		<p role="alert">Unable to sign in. Please try again.</p>
	{/if}

	<form method="POST">
		<input type="hidden" name="redirectTo" value={data.callbackUrl} />

		{#if data.strategy === 'credentials'}
			<div>
				<label for="username">Username</label>
				<input id="username" name="username" type="text" autocomplete="username" required />
			</div>
			<div>
				<label for="password">Password</label>
				<input
					id="password"
					name="password"
					type="password"
					autocomplete="current-password"
					required
				/>
			</div>
			<button type="submit">Sign in</button>
		{:else}
			<p>Use your single sign-on account to access the directory.</p>
			<button type="submit">Sign in with single sign-on</button>
		{/if}
	</form>
</main>

<style>
	main {
		max-width: var(--content-max-width);
		margin-inline: auto;
		padding: var(--space-8);
	}

	h1,
	p {
		margin-block-end: var(--space-5);
	}

	h1 {
		font-size: var(--font-size-heading);
		line-height: var(--line-height-heading);
		overflow-wrap: anywhere;
	}

	img {
		width: var(--size-icon);
		height: var(--size-icon);
		margin-block-end: var(--space-5);
	}

	form {
		display: grid;
		gap: var(--space-5);
	}

	form > div {
		display: grid;
	}

	input {
		min-width: 0;
	}

	button,
	input {
		color: var(--color-text);
		background: var(--color-surface-page);
		border: var(--border-width) solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		padding: var(--space-4) var(--space-5);
	}

	button {
		cursor: pointer;
	}

	button:focus-visible,
	input:focus-visible {
		outline: var(--outline-focus);
		outline-offset: var(--space-1);
	}
</style>
