CREATE TABLE "redefinicao_senha" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"usado_em" timestamp with time zone,
	"revogada_em" timestamp with time zone,
	"criado_por" uuid NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "convite" ADD COLUMN "revogado_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "convite" ADD COLUMN "revogado_por" uuid;--> statement-breakpoint
ALTER TABLE "redefinicao_senha" ADD CONSTRAINT "redefinicao_senha_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "redefinicao_token_unico" ON "redefinicao_senha" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "redefinicao_usuario_idx" ON "redefinicao_senha" USING btree ("usuario_id");