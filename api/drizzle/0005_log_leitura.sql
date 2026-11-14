CREATE INDEX "log_data_idx" ON "log" USING btree ("ocorrido_em","id");--> statement-breakpoint
-- O horário do log é carimbado pelo banco, nunca pelo chamador: nem a API nem um bug
-- conseguem gravar um registro com data falsa (retroativa ou futura).
CREATE FUNCTION "log_carimbo"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	NEW.ocorrido_em := clock_timestamp();
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "log_carimbo_hora"
	BEFORE INSERT ON "log"
	FOR EACH ROW EXECUTE FUNCTION "log_carimbo"();