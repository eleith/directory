import { ConfigError, configurationVersion, loadConfigFile } from '@where/config';
import type { ConfigLoadOptions } from '@where/config';
import { cli, define, type CommandContext } from 'gunshi';

export interface CliOutput {
	stdout: (text: string) => void;
	stderr: (text: string) => void;
}

const header = `Where — configuration validation.
Supported configuration format version: ${configurationVersion}.
Path selection: explicit path, then CONFIG_PATH, then config/where.yaml.`;

const rootCommand = define({
	name: 'where',
	description: 'Where configuration tools.',
	run() {
		throw new Error('A command is required.');
	}
});

export async function runCli(
	args: readonly string[],
	output: CliOutput,
	options?: ConfigLoadOptions
): Promise<0 | 1> {
	const forwarded = args[0] === '--' ? args.slice(1) : [...args];
	try {
		const result = await cli(forwarded, rootCommand, {
			name: 'where',
			usageSilent: true,
			renderHeader: async () => header,
			renderValidationErrors: null,
			onBeforeCommand: checkArguments,
			subCommands: { validate: createValidateCommand(options) }
		});
		if (result) output.stdout(`${result}\n`);
		return 0;
	} catch (error) {
		let message = 'Command failed. Run where --help for usage.\n';
		if (error instanceof ConfigError) {
			message = `Configuration validation failed.\n${error.message}\n`;
		}
		output.stderr(message);
		return 1;
	}
}

function createValidateCommand(options?: ConfigLoadOptions) {
	return define({
		name: 'validate',
		description: 'Validate a YAML configuration without printing its contents.',
		args: {
			path: { type: 'positional', required: false, description: 'Path to the YAML configuration.' }
		},
		async run(context) {
			await loadConfigFile(context.values.path, options);
			return 'Configuration is valid.';
		}
	});
}

function checkArguments(context: Readonly<CommandContext>): void {
	// Gunshi permits unknown options and unused positionals by default.
	const definitions = Object.entries(context.args);
	const positionalCount = definitions.filter(([, schema]) => schema.type === 'positional').length;
	if (context.positionals.includes('')) throw new Error('Empty positional argument.');
	const suppliedPositionals = context.positionals.slice(context.commandPath.length);
	if (suppliedPositionals.length > positionalCount) {
		throw new Error('Unexpected positional arguments.');
	}
	for (const token of context.tokens) {
		if (token.kind === 'option-terminator') throw new Error('Unexpected separator.');
		if (token.kind !== 'option') continue;
		const optionEntry = definitions.find(([name, schema]) => {
			if (schema.type === 'positional') return false;
			if (token.rawName === `--${name}`) return true;
			return schema.short !== undefined && token.rawName === `-${schema.short}`;
		});
		if (!optionEntry) throw new Error('Unknown option.');
		const [, definition] = optionEntry;
		if (definition.type === 'boolean' && token.value !== undefined) {
			throw new Error('Boolean option does not take a value.');
		}
	}
}
