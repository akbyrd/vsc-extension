import tseslint from "typescript-eslint"
import stylistic from "@stylistic/eslint-plugin"

export default tseslint.config(
	{
		ignores: ["out", "dist", "**/*.d.ts"]
	},
	{
		files: ["**/*.ts"],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: {
				ecmaVersion: 6,
				sourceType: "module"
			}
		},
		plugins: {
			"@typescript-eslint": tseslint.plugin,
			"@stylistic": stylistic
		},
		rules: {
			"@typescript-eslint/naming-convention": "warn",
			"@stylistic/semi": ["warn", "never"],
			"curly": "off",
			"eqeqeq": "warn",
			"no-fallthrough": "warn",
			"no-throw-literal": "warn",
			"no-unexpected-multiline": "warn",
			"semi": "off"
		}
	},
	{
		files: ["src/extension.ts"],
		rules: { "@typescript-eslint/naming-convention": [
				"warn",
				{ selector: "default",  format: ["camelCase"] },
				{ selector: "import",   format: ["camelCase"] },
				{ selector: "variable", format: ["camelCase"] },
				{ selector: "typeLike", format: ["PascalCase"] },
				{ selector: "function", format: null }
			]
		}
	}
)
