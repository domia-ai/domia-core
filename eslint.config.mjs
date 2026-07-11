// @ts-check
import eslint from "@eslint/js"
import tseslint from "typescript-eslint"
import prettierConfig from "eslint-config-prettier"
import prettierPlugin from "eslint-plugin-prettier/recommended"
import { defineConfig, globalIgnores } from "eslint/config"
import globals from "globals"

export default defineConfig(
	eslint.configs.recommended,
	tseslint.configs.strict,
	tseslint.configs.stylistic,
	prettierConfig,
	prettierPlugin,
	{
		rules: {
			"@typescript-eslint/consistent-type-definitions": ["warn", "type"],
		},
	},
	{
		files: ["evals/**/*.ts"],
		languageOptions: { globals: globals.node },
	},
	{
		files: ["**/*.d.ts"],
		rules: { "@typescript-eslint/no-extraneous-class": "off" },
	},
	globalIgnores(["build/**/*", ".venv/*", "tmp/**/*", "src/generated/**/*"]),
)
