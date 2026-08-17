module.exports = {
  root: true,
  env: { browser: true, es2021: true, node: true },
  extends: ['eslint:recommended', 'plugin:vue/vue3-essential'],
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  rules: {
    // 现有页面组件沿用单词文件名，不为接入门禁做无收益重命名。
    'vue/multi-word-component-names': 'off',
  },
}
