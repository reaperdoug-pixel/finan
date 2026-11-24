-- Garante que reativar um lançamento (UPDATE OF ativo) também respeita a regra de só lançar em folha.
CREATE OR REPLACE FUNCTION "lancamento_so_folha"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF NEW.ativo AND EXISTS (
		SELECT 1 FROM categoria filha
		WHERE filha.pai_id = NEW.categoria_id AND filha.ativo
	) THEN
		RAISE EXCEPTION 'Lançamento só é permitido em categoria folha'
			USING ERRCODE = 'check_violation';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "lancamento_so_folha_gatilho" ON "lancamento";--> statement-breakpoint
CREATE TRIGGER "lancamento_so_folha_gatilho"
	BEFORE INSERT OR UPDATE OF categoria_id, ativo ON "lancamento"
	FOR EACH ROW EXECUTE FUNCTION "lancamento_so_folha"();
