import chalk from "chalk"

export const colors = {
	success: chalk.green,
	error: chalk.red,
	warning: chalk.yellow,
	info: chalk.blue,
	debug: chalk.gray,
	highlight: chalk.bold,
} as const
