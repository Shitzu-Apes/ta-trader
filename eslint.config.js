import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettierConfig from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import prettierPlugin from 'eslint-plugin-prettier';
import globals from 'globals';

export default [
	js.configs.recommended,
	{
		files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				ecmaVersion: 2020,
				sourceType: 'module',
				ecmaFeatures: {
					arrowFunctions: true
				}
			},
			globals: {
				...globals.browser,
				...globals.node,
				...globals.amd,
				ExecutionContext: 'readonly',
				ScheduledController: 'readonly',
				D1Database: 'readonly'
			}
		},
		plugins: {
			'@typescript-eslint': tsPlugin,
			prettier: prettierPlugin,
			import: importPlugin
		},
		settings: {
			'import/resolver': {
				typescript: {
					alwaysTryTypes: true
				}
			}
		},
		rules: {
			...tsPlugin.configs.recommended.rules,
			...prettierConfig.rules,
			'no-case-declarations': 'off',
			'import/order': [
				'error',
				{
					groups: [['builtin', 'external'], 'parent', ['sibling', 'index']],
					'newlines-between': 'always',
					alphabetize: {
						order: 'asc'
					}
				}
			],
			'import/no-duplicates': 'off',
			'import/no-unresolved': [
				'error',
				{
					ignore: ['cloudflare:workers']
				}
			],
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_',
					destructuredArrayIgnorePattern: '^_',
					varsIgnorePattern: '^_'
				}
			]
		}
	}
];
