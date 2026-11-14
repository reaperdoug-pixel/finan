CREATE TYPE "public"."papel" AS ENUM('admin', 'titular', 'vinculado');--> statement-breakpoint
CREATE TABLE "log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ocorrido_em" timestamp with time zone DEFAULT now() NOT NULL,
	"usuario_id" uuid,
	"titular_id" uuid,
	"acao" text NOT NULL,
	"entidade" text,
	"entidade_id" text,
	"ip" text,
	"antes" jsonb,
	"depois" jsonb,
	"confirmado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "titular" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"inativado_em" timestamp with time zone,
	"inativado_por" uuid,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"nome" text NOT NULL,
	CONSTRAINT "titular_ativo_coerente" CHECK ((ativo AND inativado_em IS NULL) OR (NOT ativo AND inativado_em IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "usuario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"inativado_em" timestamp with time zone,
	"inativado_por" uuid,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"titular_id" uuid NOT NULL,
	"email" text NOT NULL,
	"senha_hash" text NOT NULL,
	"papel" "papel" NOT NULL,
	CONSTRAINT "usuario_ativo_coerente" CHECK ((ativo AND inativado_em IS NULL) OR (NOT ativo AND inativado_em IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_titular_id_titular_id_fk" FOREIGN KEY ("titular_id") REFERENCES "public"."titular"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "log_titular_data_idx" ON "log" USING btree ("titular_id","ocorrido_em");--> statement-breakpoint
CREATE UNIQUE INDEX "usuario_email_unico" ON "usuario" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "usuario_titular_idx" ON "usuario" USING btree ("titular_id");