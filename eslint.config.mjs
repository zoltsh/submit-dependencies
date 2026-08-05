import rubric from 'eslint-config-rubric';

export default [
    ...rubric,
    {
        ignores: ['coverage/**', 'dist/**', 'node_modules/**'],
    },
];
