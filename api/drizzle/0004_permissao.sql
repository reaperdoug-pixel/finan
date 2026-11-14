CREATE TYPE "public"."modulo" AS ENUM('lancamentos', 'categorias', 'contas', 'orcamentos', 'anexos', 'log');--> statement-breakpoint
CREATE TABLE "permissao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"modulo" "modulo" NOT NULL,
	"ver" boolean DEFAULT false NOT NULL,
	"cadastrar" boolean DEFAULT false NOT NULL,
	"alterar" boolean DEFAULT false NOT NULL,
	"excluir" boolean DEFAULT false NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permissao_alterar_excluir_exigem_ver" CHECK (ver OR (NOT alterar AND NOT excluir)),
	CONSTRAINT "permissao_log_so_ver" CHECK (modulo <> 'log' OR (NOT cadastrar AND NOT alterar AND NOT excluir))
);
--> statement-breakpoint
ALTER TABLE "convite" ADD COLUMN "permissoes" jsonb;--> statement-breakpoint
ALTER TABLE "permissao" ADD CONSTRAINT "permissao_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "permissao_usuario_modulo_unico" ON "permissao" USING btree ("usuario_id","modulo");