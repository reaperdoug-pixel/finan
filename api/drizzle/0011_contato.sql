ALTER TYPE "public"."modulo" ADD VALUE IF NOT EXISTS 'contatos';--> statement-breakpoint
CREATE TYPE "public"."tipo_contato" AS ENUM('pf', 'pj');--> statement-breakpoint
CREATE TYPE "public"."papel_contato" AS ENUM('cliente', 'fornecedor', 'ambos');--> statement-breakpoint
CREATE TABLE "contato" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"inativado_em" timestamp with time zone,
	"inativado_por" uuid,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"titular_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"tipo" "tipo_contato" NOT NULL,
	"papel" "papel_contato" NOT NULL,
	"documento" text,
	"observacao" text,
	CONSTRAINT "contato_ativo_coerente" CHECK ((ativo AND inativado_em IS NULL) OR (NOT ativo AND inativado_em IS NOT NULL))
);--> statement-breakpoint
ALTER TABLE "contato" ADD CONSTRAINT "contato_titular_id_titular_id_fk" FOREIGN KEY ("titular_id") REFERENCES "public"."titular"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contato_titular_id_unico" ON "contato" USING btree ("titular_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "contato_nome_unico_no_titular" ON "contato" USING btree ("titular_id",lower("nome")) WHERE "contato"."ativo";--> statement-breakpoint
CREATE INDEX "contato_titular_idx" ON "contato" USING btree ("titular_id");--> statement-breakpoint
ALTER TABLE "lancamento" ADD COLUMN "contato_id" uuid;--> statement-breakpoint
ALTER TABLE "lancamento" ADD CONSTRAINT "lancamento_contato_mesmo_titular_fk" FOREIGN KEY ("titular_id","contato_id") REFERENCES "public"."contato"("titular_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lancamento_contato_idx" ON "lancamento" USING btree ("contato_id","ativo");
