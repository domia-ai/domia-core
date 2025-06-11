// @ts-check
import eslint from "@eslint/js"
import tseslint from "typescript-eslint"
import prettierConfig from "eslint-config-prettier"
import prettierPlugin from "eslint-plugin-prettier/recommended"
import { globalIgnores } from "eslint/config"

export default tseslint.config(
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
	globalIgnores(["build/**/*", ".venv/*"]),
)
