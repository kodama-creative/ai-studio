#!/usr/bin/env bun

import { scaffoldAgentProject } from "./scaffold";

const HELP = `LLM Space Agent Project CLI

Usage:
  llm-space init [directory] [--blank]

Options:
  --blank    Create a minimal Agent instead of the starter project
  -h, --help Show this help
`;

export async function main(argv = process.argv.slice(2)): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
    return 0;
  }
  const command = argv[0];
  if (command !== "init") {
    process.stderr.write(command ? `Unknown command: ${command}\n\n` : HELP);
    return command ? 1 : 0;
  }
  const positional = argv.slice(1).filter(arg => !arg.startsWith("-"));
  const unknown = argv
    .slice(1)
    .filter(arg => arg.startsWith("-") && arg !== "--blank");
  if (positional.length > 1 || unknown.length > 0) {
    process.stderr.write(`Invalid arguments.\n\n${HELP}`);
    return 1;
  }
  try {
    const root = await scaffoldAgentProject({
      directory: positional[0] ?? process.cwd(),
      template: argv.includes("--blank") ? "blank" : "starter"
    });
    process.stdout.write(`Created LLM Space Agent Project at ${root}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(
      `Unable to create Agent Project: ${error instanceof Error ? error.message : String(error)}\n`
    );
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await main();
}
