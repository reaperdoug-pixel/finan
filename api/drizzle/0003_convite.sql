CREATE TABLE "convite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"papel" "papel" NOT NULL,
	"nome_titular" text NOT NULL,
	"titular_id" uuid,
	"token_hash" text NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"usado_em" timestamp with time zone,
	"usado_por" uuid,
	"criado_por" uuid NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "convite" ADD CONSTRAINT "convite_titular_id_titular_id_fk" FOREIGN KEY ("titular_id") REFERENCES "public"."titular"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "convite_token_unico" ON "convite" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "convite_email_idx" ON "convite" USING btree (lower("email"));