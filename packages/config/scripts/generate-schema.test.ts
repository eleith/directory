import { spawnSync } from 'node:child_process';
import {
	cp,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	stat,
	symlink,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const packageDirectory = fileURLToPath(new URL('..', import.meta.url));
const workspaceDirectory = fileURLToPath(new URL('../../..', import.meta.url));

let fixtureRoot: string;
let fixturePackage: string;
let artifact: string;

function run(...args: string[]) {
	const result = spawnSync(
		process.execPath,
		[join(fixturePackage, 'scripts/generate-schema.ts'), ...args],
		{ cwd: fixtureRoot, encoding: 'utf8', timeout: 30_000, maxBuffer: 2 * 1024 * 1024 }
	);
	expect(result.error).toBeUndefined();
	return result;
}

async function expectCleanCache(): Promise<void> {
	const entries = await readdir(join(fixturePackage, 'node_modules/.cache'));
	expect(entries.filter((name) => name.startsWith('directory-schema-'))).toEqual([]);
}

beforeEach(async () => {
	fixtureRoot = await mkdtemp(join(tmpdir(), 'directory-schema-test-'));
	fixturePackage = join(fixtureRoot, 'packages/config');
	artifact = join(fixturePackage, 'src/config.schema.json');
	await mkdir(join(fixturePackage, 'scripts'), { recursive: true });
	await cp(join(workspaceDirectory, 'tsconfig.base.json'), join(fixtureRoot, 'tsconfig.base.json'));
	for (const name of ['package.json', 'tsconfig.json', 'src']) {
		await cp(join(packageDirectory, name), join(fixturePackage, name), { recursive: true });
	}
	await cp(
		join(packageDirectory, 'scripts/generate-schema.ts'),
		join(fixturePackage, 'scripts/generate-schema.ts')
	);
	await rm(artifact, { force: true });
	await symlink(join(workspaceDirectory, 'node_modules'), join(fixtureRoot, 'node_modules'), 'dir');
	// Link dependencies individually so the generator's cache stays disposable, too.
	await mkdir(join(fixturePackage, 'node_modules'));
	for (const name of await readdir(join(packageDirectory, 'node_modules'))) {
		if (!name.startsWith('.')) {
			await symlink(
				join(packageDirectory, 'node_modules', name),
				join(fixturePackage, 'node_modules', name),
				'dir'
			);
		}
	}
});

afterEach(async () => {
	if (fixtureRoot) {
		await rm(fixtureRoot, { recursive: true, force: true });
	}
});

describe('schema generator CLI from clean source', () => {
	it('generates before a build, formats deterministically, and checks without rewriting', async () => {
		expect(run().status).toBe(0);
		const first = await readFile(artifact, 'utf8');
		expect(JSON.parse(first)).toMatchObject({
			$schema: 'https://json-schema.org/draft/2020-12/schema'
		});
		expect(first.endsWith('\n')).toBe(true);
		expect(first).toContain('\n\t');
		expect(run().status).toBe(0);
		expect(await readFile(artifact, 'utf8')).toBe(first);
		const beforeCheck = await stat(artifact, { bigint: true });
		const checked = run('--check');
		expect(checked.status, checked.stderr).toBe(0);
		expect(checked.stdout).toContain('up to date');
		expect(await readFile(artifact, 'utf8')).toBe(first);
		const afterCheck = await stat(artifact, { bigint: true });
		expect(afterCheck.mtimeNs).toBe(beforeCheck.mtimeNs);
		expect(afterCheck.ctimeNs).toBe(beforeCheck.ctimeNs);
		await expectCleanCache();
	}, 30_000);

	it('fails on byte drift without changing the artifact', async () => {
		expect(run().status).toBe(0);
		const drifted = `${await readFile(artifact, 'utf8')}\n`;
		await writeFile(artifact, drifted);
		const checked = run('--check');
		expect(checked.status).toBe(1);
		expect(checked.stderr).toContain('out of date');
		expect(checked.stderr).toContain('pnpm schema:generate');
		expect(await readFile(artifact, 'utf8')).toBe(drifted);
		await expectCleanCache();
	}, 30_000);

	it('reports a missing artifact without generating it', async () => {
		const checked = run('--check');
		expect(checked.status).toBe(1);
		expect(checked.stderr).toContain('src/config.schema.json is missing');
		await expect(readFile(artifact)).rejects.toMatchObject({ code: 'ENOENT' });
		await expectCleanCache();
	}, 30_000);

	it('uses edited canonical source even when dist contains stale output', async () => {
		const dist = join(fixturePackage, 'dist');
		await mkdir(dist);
		const staleModule = 'throw new Error("Stale dist must not be imported");\n';
		for (const name of ['index.js', 'schema.js', 'editor-schema.js']) {
			await writeFile(join(dist, name), staleModule);
		}
		expect(run().status).toBe(0);
		const original = await readFile(artifact, 'utf8');
		const schemaSource = join(fixturePackage, 'src/schema.ts');
		await writeFile(
			schemaSource,
			`${await readFile(schemaSource, 'utf8')}\nDirectoryConfigurationSchema.description = 'Fresh canonical source fixture';\n`
		);
		const checked = run('--check');
		expect(checked.status, checked.stderr).toBe(1);
		expect(checked.stderr).toContain('out of date');
		expect(await readFile(artifact, 'utf8')).toBe(original);
		const generated = run();
		expect(generated.status, generated.stderr).toBe(0);
		const updated = await readFile(artifact, 'utf8');
		expect(updated).not.toBe(original);
		expect(updated).toContain('Fresh canonical source fixture');
		for (const name of ['index.js', 'schema.js', 'editor-schema.js']) {
			expect(await readFile(join(dist, name), 'utf8')).toBe(staleModule);
		}
		await expectCleanCache();
	}, 30_000);

	it('rejects unknown and repeated arguments without generating an artifact', async () => {
		for (const args of [['--unknown'], ['--check', '--check'], ['--check', 'extra'], ['--']]) {
			const result = run(...args);
			expect(result.status).toBe(1);
			expect(result.stderr).toContain('Usage: node scripts/generate-schema.ts [--check]');
		}
		await expect(readFile(artifact)).rejects.toMatchObject({ code: 'ENOENT' });
		await expect(readdir(join(fixturePackage, 'node_modules/.cache'))).rejects.toMatchObject({
			code: 'ENOENT'
		});
	}, 30_000);

	it('reports compilation errors, preserves the artifact, and removes temporary output', async () => {
		await writeFile(artifact, 'artifact sentinel\n');
		const schemaSource = join(fixturePackage, 'src/schema.ts');
		await writeFile(
			schemaSource,
			`${await readFile(schemaSource, 'utf8')}\nconst compilationFailure: string = 123;\n`
		);
		const result = run();
		expect(result.status).toBe(1);
		expect(result.stderr).toContain('Schema generation failed:');
		expect(result.stderr).toContain('TS2322');
		expect(await readFile(artifact, 'utf8')).toBe('artifact sentinel\n');
		await expectCleanCache();
	}, 30_000);

	it('cleans temporary modules after an import failure without writing an artifact', async () => {
		const editorSource = join(fixturePackage, 'src/editor-schema.ts');
		await writeFile(
			editorSource,
			`${await readFile(editorSource, 'utf8')}\nthrow new Error('Fixture import failed');\n`
		);
		const result = run();
		expect(result.status).toBe(1);
		expect(result.stderr).toContain('Fixture import failed');
		await expect(readFile(artifact)).rejects.toMatchObject({ code: 'ENOENT' });
		await expectCleanCache();
	}, 30_000);
});
