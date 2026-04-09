/** @type {import("prettier").Config} */
export default {
    endOfLine: "lf",
    semi: true,
    singleQuote: false,
    tabWidth: 4,
    trailingComma: "es5",
    arrowParens: "always",
    plugins: [],
    overrides: [
        {
            files: ["*.md", "*.mdx", "*.yaml", "*.yml"],
            options: {
                tabWidth: 2,
            },
        },
    ],
};
