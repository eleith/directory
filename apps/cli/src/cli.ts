import { configurationVersion } from '@where/config';

export interface CliOutput {
	stdout: (text: string) => void;
	stderr: (text: string) => void;
}

export function runCli(args: readonly string[], output: CliOutput): 0 | 1 {
	const forwarded = args[0] === '--' ? args.slice(1) : args;

	if (forwarded.length === 1 && (forwarded[0] === '--help' || forwarded[0] === '-h')) {
		output.stdout(`Where (bootstrap)

Usage: where [--] --help
       where [--] -h

Supported configuration format version: ${configurationVersion}.
The configuration validator is not available in this bootstrap.
One leading -- is accepted for package-manager argument forwarding.
`);
		return 0;
	}

	output.stderr(
		forwarded.length === 0
			? 'No command provided. Run where --help for bootstrap usage.\n'
			: 'Unsupported arguments. Run where --help for bootstrap usage.\n'
	);
	return 1;
}
