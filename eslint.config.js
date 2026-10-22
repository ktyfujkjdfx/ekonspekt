// ESLint (flat config): рекомендации JS и TypeScript + правила, которые закрепляют политику безопасности
// расширения: никакой HTML-вставки строк, eval и javascript:-адресов — только textContent и createElement.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

const NO_HTML_SINKS = [
  {
    selector: "AssignmentExpression[left.type='MemberExpression'][left.property.name=/^(innerHTML|outerHTML)$/]",
    message: 'Запрещено: запись HTML-строки (XSS). Стройте элементы через createElement/textContent.',
  },
  {
    selector:
      "CallExpression[callee.property.name='insertAdjacentHTML'], CallExpression[callee.object.name='document'][callee.property.name=/^(write|writeln)$/]",
    message: 'Запрещено: вставка HTML-строки (XSS). Стройте элементы через createElement/textContent.',
  },
  {
    selector: "CallExpression[callee.property.name='createContextualFragment']",
    message: 'Запрещено: разбор HTML-строки в документ страницы.',
  },
];

export default tseslint.config(
  { ignores: ['dist/**', 'release/**', 'node_modules/**', '_files/**', 'new LECTURES/**', 'proverka/**', 'research_notes/**', 'store/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.webextensions, ...globals.node, __BROWSER__: 'readonly', __E2E__: 'readonly' },
    },
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'no-restricted-syntax': ['error', ...NO_HTML_SINKS],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-explicit-any': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
    },
  },
  {
    // Скрипты сборки и автотестов работают в Node и пишут в консоль — это их назначение.
    files: ['scripts/**', 'eslint.config.js', 'vitest.config.ts'],
    rules: { 'no-console': 'off', 'no-restricted-syntax': 'off' },
  },
  {
    // Тесты и тестовые скрипты читают/собирают HTML фикстур — это не пользовательский код.
    files: ['test/**'],
    rules: { 'no-restricted-syntax': 'off', 'no-script-url': 'off' },
  },
);
