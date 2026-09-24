// @ts-check
import eslint from "@eslint/js"
import tseslint from "typescript-eslint"
import prettierConfig from "eslint-config-prettier"
import prettierPlugin from "eslint-plugin-prettier/recommended"
import { defineConfig, globalIgnores } from "eslint/config"
import globals from "globals"

export default defineConfig(
	eslint.configs.recommended,
	tseslint.configs.strictTypeChecked,
	tseslint.configs.stylisticTypeChecked,
	prettierConfig,
	prettierPlugin,
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		files: ["evals/**/*.ts", "scripts/**/*.ts"],
		languageOptions: {
			globals: globals.node,
			parserOptions: {
				project: ["./tsconfig.evals.json"],
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		rules: {
			"@typescript-eslint/consistent-type-definitions": ["warn", "type"],
			"@typescript-eslint/no-floating-promises": "error",
			"no-console": "error",
			"@typescript-eslint/restrict-template-expressions": [
				"error",
				{
					allowNumber: true,
					allowBoolean: true,
					allowNullish: true,
					allowAny: false,
					allowRegExp: false,
					allowNever: false,
				},
			],
			"@typescript-eslint/no-confusing-void-expression": [
				"error",
				{ ignoreArrowShorthand: true, ignoreVoidOperator: true },
			],
			"@typescript-eslint/prefer-nullish-coalescing": [
				"error",
				{ ignorePrimitives: { string: true } },
			],
			"@typescript-eslint/no-unnecessary-condition": [
				"error",
				{ allowConstantLoopConditions: "only-allowed-literals" },
			],
		},
	},
	{
		files: [
			"src/utils/logger/**/*.ts",
			"src/cli/**/*.ts",
			"evals/**/*.ts",
			"scripts/**/*.ts",
		],
		rules: { "no-console": "off" },
	},
	{
		files: ["evals/**/*.ts"],
		rules: { "@typescript-eslint/no-unnecessary-type-parameters": "off" },
	},
	{
		files: ["**/*.d.ts"],
		rules: { "@typescript-eslint/no-extraneous-class": "off" },
	},
	{
		files: [
			"src/modules/skill-engine/adapters/mcp-v1-sse/**/*.ts",
			"evals/mcp-client.ts",
		],
		rules: { "@typescript-eslint/no-deprecated": "off" },
	},
	{
		files: ["**/*.mjs", "**/*.js", "drizzle.config.ts"],
		extends: [tseslint.configs.disableTypeChecked],
	},
	globalIgnores([
		"build/**/*",
		".venv/*",
		"tmp/**/*",
		"src/generated/**/*",
		".claude/**/*",
	]),
)
