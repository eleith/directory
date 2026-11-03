# @directory/web

## 0.0.3

### Patch Changes

- cdf532e: Replace sign-in with stateless authentication and fixed seven-day sessions without renewal. Existing sessions require signing in again. OIDC identities must supply an email.
- 81962e4: Upgrade the web app to SvelteKit 3, preserving runtime `site.url`, native sign-in, bookmark navigation and container workflows.

## 0.0.2

### Patch Changes

- 1e91d14: Select the full destination URL on focus or click and make button hover and focus states more distinct.
- 269205a: Browse bookmarks with desktop previous/next controls and arrow keys, preserving the current filter and keeping browser history tidy.
- aedeb3f: Serve mounted images as public static files without authentication, configuration allowlisting, or content sniffing.

## 0.0.1

### Patch Changes

- Initial release of Directory and its configuration CLI.
