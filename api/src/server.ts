import { buildApp } from "./app.js";
import { createDb, createPool } from "./db/client.js";
import { loadEnv, requireEnv } from "./env.js";

loadEnv();

const port = Number(process.env.API_PORT ?? 3000);
const producao = process.env.NODE_ENV === "production";
const app = buildApp({
  db: createDb(createPool(requireEnv("DATABASE_URL"))),
  segredoSessao: requireEnv("SESSION_SECRET"),
  origemApp: process.env.APP_ORIGIN ?? "http://localhost:5173",
  producao,
});

// Escuta só em loopback: o acesso externo passa pelo proxy (Caddy) com HTTPS.
app.listen({ port, host: "127.0.0.1" }).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
