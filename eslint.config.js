import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      // Regra do projeto: nada sensível no front-end e sem armazenamento local.
      "no-restricted-globals": [
        "error",
        { name: "localStorage", message: "Proibido: sessão só em cookie httpOnly." },
        { name: "sessionStorage", message: "Proibido: sessão só em cookie httpOnly." },
      ],
    },
  },
);
