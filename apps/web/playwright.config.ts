import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const origin = 'http://127.0.0.1:4183';

export default defineConfig({
	testDir: './e2e',
	testMatch: '**/*.e2e.ts',
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	use: { baseURL: origin, trace: 'retain-on-failure' },
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: 'node build/index.js',
		url: origin,
		reuseExistingServer: false,
		env: {
			HOST: '127.0.0.1',
			PORT: '4183',
			ORIGIN: origin,
			CONFIG_PATH: fileURLToPath(new URL('./e2e/fixtures/directory.yaml', import.meta.url))
		}
	}
});
