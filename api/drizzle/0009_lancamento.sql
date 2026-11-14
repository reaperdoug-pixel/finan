CREATE TYPE "public"."origem_lancamento" AS ENUM('manual');--> statement-breakpoint
ALTER TABLE "lancamento" DROP CONSTRAINT "lancamento_valor_positivo";--> statement-breakpoint
ALTER TABLE "lancamento" ALTER COLUMN "conta_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lancamento" ALTER COLUMN "valor" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lancamento" ALTER COLUMN "tipo" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lancamento" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lancamento" ADD COLUMN "natureza" "natureza" NOT NULL;--> statement-breakpoint
ALTER TABLE "lancamento" ADD COLUMN "data" date NOT NULL;--> statement-breakpoint
ALTER TABLE "lancamento" ADD COLUMN "descricao" text NOT NULL;--> statement-breakpoint
ALTER TABLE "lancamento" ADD COLUMN "observacao" text;--> statement-breakpoint
ALTER TABLE "lancamento" ADD COLUMN "origem" "origem_lancamento" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "lancamento" ADD COLUMN "valor_previsto_original" integer;--> statement-breakpoint
CREATE INDEX "lancamento_titular_data_idx" ON "lancamento" USING btree ("titular_id","data");--> statement-breakpoint
ALTER TABLE "lancamento" ADD CONSTRAINT "lancamento_previsto_original_positivo" CHECK (valor_previsto_original IS NULL OR valor_previsto_original > 0);--> statement-breakpoint
ALTER TABLE "lancamento" ADD CONSTRAINT "lancamento_valor_positivo" CHECK (valor > 0);--> statement-breakpoint
-- Só folha (sem filhas ativas) recebe lançamento, mesmo se a API errar.
CREATE FUNCTION "lancamento_so_folha"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM categoria filha
		WHERE filha.pai_id = NEW.categoria_id AND filha.ativo
	) THEN
		RAISE EXCEPTION 'Lançamento só é permitido em categoria folha'
			USING ERRCODE = 'check_violation';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "lancamento_so_folha_gatilho"
	BEFORE INSERT OR UPDATE OF categoria_id ON "lancamento"
	FOR EACH ROW EXECUTE FUNCTION "lancamento_so_folha"();