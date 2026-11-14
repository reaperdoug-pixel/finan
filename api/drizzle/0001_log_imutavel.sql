-- Log de auditoria só de inclusão: bloqueia UPDATE, DELETE e TRUNCATE no banco,
-- inclusive para o dono da tabela. Defesa em profundidade além das permissões.
CREATE FUNCTION "log_imutavel"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'A tabela log é imutável: % não é permitido', TG_OP
		USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "log_sem_alterar_ou_apagar"
	BEFORE UPDATE OR DELETE ON "log"
	FOR EACH ROW EXECUTE FUNCTION "log_imutavel"();--> statement-breakpoint
CREATE TRIGGER "log_sem_esvaziar"
	BEFORE TRUNCATE ON "log"
	FOR EACH STATEMENT EXECUTE FUNCTION "log_imutavel"();