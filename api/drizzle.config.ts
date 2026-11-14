import { defineConfig } from "drizzle-kit";

// Usado só para gerar migrações (`npm run db:generate -w api`).
// A aplicação das migrações é feita por src/db/migrate.ts.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
