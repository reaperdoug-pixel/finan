CREATE TYPE "public"."status_lancamento" AS ENUM('previsto', 'realizado');--> statement-breakpoint
CREATE TYPE "public"."tipo_conta" AS ENUM('carteira', 'banco', 'cartao');--> statement-breakpoint
CREATE TYPE "public"."tipo_lancamento" AS ENUM('receita', 'despesa');--> statement-breakpoint
CREATE TABLE "conta" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"inativado_em" timestamp with time zone,
	"inativado_por" uuid,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"titular_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"tipo" "tipo_conta" NOT NULL,
	"saldo_inicial" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "conta_ativo_coerente" CHECK ((ativo AND inativado_em IS NULL) OR (NOT ativo AND inativado_em IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "lancamento" ADD COLUMN "conta_id" uuid;--> statement-breakpoint
ALTER TABLE "lancamento" ADD COLUMN "valor" integer;--> statement-breakpoint
ALTER TABLE "lancamento" ADD COLUMN "tipo" "tipo_lancamento";--> statement-breakpoint
ALTER TABLE "lancamento" ADD COLUMN "status" "status_lancamento";--> statement-breakpoint
ALTER TABLE "conta" ADD CONSTRAINT "conta_titular_id_titular_id_fk" FOREIGN KEY ("titular_id") REFERENCES "public"."titular"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conta_titular_id_unico" ON "conta" USING btree ("titular_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "conta_nome_unico_no_titular" ON "conta" USING btree ("titular_id",lower("nome")) WHERE "conta"."ativo";--> statement-breakpoint
CREATE INDEX "conta_titular_idx" ON "conta" USING btree ("titular_id");--> statement-breakpoint
ALTER TABLE "lancamento" ADD CONSTRAINT "lancamento_conta_mesmo_titular_fk" FOREIGN KEY ("titular_id","conta_id") REFERENCES "public"."conta"("titular_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lancamento_conta_idx" ON "lancamento" USING btree ("conta_id","ativo");--> statement-breakpoint
ALTER TABLE "lancamento" ADD CONSTRAINT "lancamento_valor_positivo" CHECK (valor IS NULL OR valor > 0);