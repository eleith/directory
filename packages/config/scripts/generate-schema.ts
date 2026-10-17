import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { format } from 'prettier';
import ts from 'typescript';

const packageDirectory = fileURLToPath(new URL('..', import.meta.url));
const artifact = join(packageDirectory, 'src/config.schema.json');

async function generateSchema(): Promise<string> {
	const dependencyCacheDirectory = join(packageDirectory, 'node_modules/.cache');
	await mkdir(dependencyCacheDirectory, { recursive: true });
	const temporaryDirectory = await mkdtemp(join(dependencyCacheDirectory, 'where-schema-'));
	try {
		await writeFile(join(temporaryDirectory, 'package.json'), '{"type":"module"}\n');
		const configPath = join(packageDirectory, 'tsconfig.json');
		const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
		if (configFile.error) {
			throw new Error(formatDiagnostics([configFile.error]));
		}
		const config = ts.parseJsonConfigFileContent(
			configFile.config,
			ts.sys,
			packageDirectory,
			{
				rootDir: join(packageDirectory, 'src'),
				outDir: temporaryDirectory,
				declaration: false,
				declarationMap: false,
				sourceMap: false,
				incremental: false,
				composite: false,
				noEmit: false,
				noEmitOnError: true
			},
			configPath
		);
		if (config.errors.length > 0) {
			throw new Error(formatDiagnostics(config.errors));
		}
		const program = ts.createProgram(
			['schema.ts', 'editor-schema.ts'].map((name) => join(packageDirectory, 'src', name)),
			config.options
		);
		const diagnostics = ts.getPreEmitDiagnostics(program);
		if (diagnostics.length > 0) {
			throw new Error(formatDiagnostics(diagnostics));
		}
		const result = program.emit();
		if (result.emitSkipped || result.diagnostics.length > 0) {
			throw new Error(`Schema compilation failed.\n${formatDiagnostics(result.diagnostics)}`);
		}
		const { createEditorSchema } = (await import(
			pathToFileURL(join(temporaryDirectory, 'editor-schema.js')).href
		)) as { createEditorSchema: () => Record<string, unknown> };
		return await format(JSON.stringify(createEditorSchema()), {
			parser: 'json',
			useTabs: true,
			printWidth: 100
		});
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
}

function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]): string {
	return ts.formatDiagnostics(diagnostics, {
		getCurrentDirectory: () => packageDirectory,
		getCanonicalFileName: (fileName) => fileName,
		getNewLine: () => '\n'
	});
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
		throw new Error('Usage: node scripts/generate-schema.ts [--check]');
	}
	const generated = await generateSchema();
	if (args[0] === '--check') {
		let current: string;
		try {
			current = await readFile(artifact, 'utf8');
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				throw new Error('src/config.schema.json is missing. Run pnpm schema:generate.', {
					cause: error
				});
			}
			throw error;
		}
		if (current !== generated) {
			throw new Error('src/config.schema.json is out of date. Run pnpm schema:generate.');
		}
		console.log('src/config.schema.json is up to date.');
	} else {
		await writeFile(artifact, generated);
		console.log('Generated src/config.schema.json.');
	}
}

try {
	await main();
} catch (error) {
	console.error(
		`Schema generation failed: ${error instanceof Error ? error.message : String(error)}`
	);
	process.exitCode = 1;
}
