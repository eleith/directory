#!/usr/bin/env node
import { runCli } from './cli.js';

process.exitCode = runCli(process.argv.slice(2), {
	stdout: (text) => {
		process.stdout.write(text);
	},
	stderr: (text) => {
		process.stderr.write(text);
	}
});
