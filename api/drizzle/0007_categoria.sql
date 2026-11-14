CREATE TYPE "public"."natureza" AS ENUM('fixa', 'variavel');--> statement-breakpoint
CREATE TYPE "public"."tipo_categoria" AS ENUM('receita', 'despesa');--> statement-breakpoint
CREATE TABLE "categoria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"inativado_em" timestamp with time zone,
	"inativado_por" uuid,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"titular_id" uuid NOT NULL,
	"pai_id" uuid,
	"nome" text NOT NULL,
	"tipo" "tipo_categoria" NOT NULL,
	"natureza" "natureza" NOT NULL,
	"prever_pela_media" boolean DEFAULT false NOT NULL,
	"nivel" smallint NOT NULL,
	CONSTRAINT "categoria_ativo_coerente" CHECK ((ativo AND inativado_em IS NULL) OR (NOT ativo AND inativado_em IS NOT NULL)),
	CONSTRAINT "categoria_nivel_valido" CHECK (nivel BETWEEN 1 AND 3 AND ((pai_id IS NULL) = (nivel = 1)))
);
--> statement-breakpoint
CREATE TABLE "lancamento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"inativado_em" timestamp with time zone,
	"inativado_por" uuid,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"titular_id" uuid NOT NULL,
	"categoria_id" uuid NOT NULL,
	CONSTRAINT "lancamento_ativo_coerente" CHECK ((ativo AND inativado_em IS NULL) OR (NOT ativo AND inativado_em IS NOT NULL))
);
--> statement-breakpoint
-- Os índices únicos vêm ANTES das chaves estrangeiras compostas que os referenciam
-- (o PostgreSQL exige que o índice já exista; o gerador os emite na ordem inversa).
CREATE UNIQUE INDEX "categoria_titular_id_unico" ON "categoria" USING btree ("titular_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "categoria_titular_id_tipo_unico" ON "categoria" USING btree ("titular_id","id","tipo");--> statement-breakpoint
ALTER TABLE "categoria" ADD CONSTRAINT "categoria_titular_id_titular_id_fk" FOREIGN KEY ("titular_id") REFERENCES "public"."titular"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categoria" ADD CONSTRAINT "categoria_pai_mesmo_titular_e_tipo_fk" FOREIGN KEY ("titular_id","pai_id","tipo") REFERENCES "public"."categoria"("titular_id","id","tipo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lancamento" ADD CONSTRAINT "lancamento_titular_id_titular_id_fk" FOREIGN KEY ("titular_id") REFERENCES "public"."titular"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lancamento" ADD CONSTRAINT "lancamento_categoria_mesmo_titular_fk" FOREIGN KEY ("titular_id","categoria_id") REFERENCES "public"."categoria"("titular_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categoria_nome_unico_entre_irmas" ON "categoria" USING btree ("titular_id",coalesce("pai_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("nome")) WHERE "categoria"."ativo";--> statement-breakpoint
CREATE INDEX "categoria_titular_pai_idx" ON "categoria" USING btree ("titular_id","pai_id");--> statement-breakpoint
CREATE INDEX "lancamento_categoria_idx" ON "lancamento" USING btree ("categoria_id","ativo");--> statement-breakpoint
-- O nível da filha é sempre o da mãe + 1 (as restrições comuns não conseguem expressar isso).
-- Junto com o limite de 3 níveis e o tipo/titular da mãe, a árvore nunca fica incoerente,
-- mesmo que a API erre.
CREATE FUNCTION "categoria_nivel_coerente"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
	nivel_pai smallint;
BEGIN
	IF NEW.pai_id IS NOT NULL THEN
		SELECT nivel INTO nivel_pai FROM categoria WHERE id = NEW.pai_id;
		IF nivel_pai IS NULL OR NEW.nivel <> nivel_pai + 1 THEN
			RAISE EXCEPTION 'O nível da categoria deve ser o da categoria pai + 1'
				USING ERRCODE = 'check_violation';
		END IF;
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "categoria_nivel_coerente_gatilho"
	BEFORE INSERT OR UPDATE OF pai_id, nivel ON "categoria"
	FOR EACH ROW EXECUTE FUNCTION "categoria_nivel_coerente"();