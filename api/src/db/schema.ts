import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Campos comuns a toda tabela de negócio.
 * Nada se apaga: "excluir" = inativar (ativo=false + inativado_em).
 * Quem inativou/reativou e quando fica também no log de auditoria.
 */
const comuns = {
  id: uuid("id").primaryKey().defaultRandom(),
  ativo: boolean("ativo").notNull().default(true),
  inativadoEm: timestamp("inativado_em", { withTimezone: true }),
  inativadoPor: uuid("inativado_por"),
  criadoPor: uuid("criado_por"),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
};

/** ativo e inativado_em nunca podem se contradizer. */
const checkAtivo = (nome: string) =>
  check(
    `${nome}_ativo_coerente`,
    sql.raw(
      `(ativo AND inativado_em IS NULL) OR (NOT ativo AND inativado_em IS NOT NULL)`,
    ),
  );

export const papel = pgEnum("papel", ["admin", "titular", "vinculado"]);

export const titular = pgTable(
  "titular",
  {
    ...comuns,
    nome: text("nome").notNull(),
  },
  () => [checkAtivo("titular")],
);

export const usuario = pgTable(
  "usuario",
  {
    ...comuns,
    titularId: uuid("titular_id")
      .notNull()
      .references(() => titular.id),
    email: text("email").notNull(),
    senhaHash: text("senha_hash").notNull(),
    papel: papel("papel").notNull(),
  },
  (t) => [
    uniqueIndex("usuario_email_unico").on(sql`lower(${t.email})`),
    index("usuario_titular_idx").on(t.titularId),
    checkAtivo("usuario"),
  ],
);

/** Módulos sobre os quais um usuário vinculado recebe permissões. `log` só tem a ação `ver`. */
export const MODULOS = [
  "lancamentos",
  "categorias",
  "contas",
  "contatos",
  "orcamentos",
  "anexos",
  "log",
] as const;
export const moduloEnum = pgEnum("modulo", MODULOS);

/**
 * Permissões de um usuário vinculado, uma linha por módulo. Titular e admin não usam
 * esta tabela: têm tudo sobre os dados do próprio titular. As regras de dependência
 * também são garantidas aqui, no banco (defesa em profundidade).
 */
export const permissao = pgTable(
  "permissao",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    usuarioId: uuid("usuario_id")
      .notNull()
      .references(() => usuario.id),
    modulo: moduloEnum("modulo").notNull(),
    ver: boolean("ver").notNull().default(false),
    cadastrar: boolean("cadastrar").notNull().default(false),
    alterar: boolean("alterar").notNull().default(false),
    excluir: boolean("excluir").notNull().default(false),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("permissao_usuario_modulo_unico").on(t.usuarioId, t.modulo),
    check(
      "permissao_alterar_excluir_exigem_ver",
      sql.raw(`ver OR (NOT alterar AND NOT excluir)`),
    ),
    check(
      "permissao_log_so_ver",
      sql.raw(`modulo <> 'log' OR (NOT cadastrar AND NOT alterar AND NOT excluir)`),
    ),
  ],
);

export const tipoCategoria = pgEnum("tipo_categoria", ["receita", "despesa"]);
export const naturezaEnum = pgEnum("natureza", ["fixa", "variavel"]);

/**
 * Categorias de receita e despesa, em árvore de até 3 níveis (raiz = nível 1).
 *  - Só as folhas (sem filhas) recebem lançamentos.
 *  - A filha tem sempre o mesmo `tipo` da mãe e o mesmo titular: garantido por chave estrangeira
 *    composta, no banco. O nível da filha é sempre o da mãe + 1: garantido por gatilho.
 *  - O nome é único entre irmãs **ativas**, sem diferenciar maiúsculas.
 *  - `natureza` (fixa ou variável) é o padrão herdado pelos lançamentos; só importa nas folhas.
 */
export const categoria = pgTable(
  "categoria",
  {
    ...comuns,
    titularId: uuid("titular_id")
      .notNull()
      .references(() => titular.id),
    paiId: uuid("pai_id"),
    nome: text("nome").notNull(),
    tipo: tipoCategoria("tipo").notNull(),
    natureza: naturezaEnum("natureza").notNull(),
    preverPelaMedia: boolean("prever_pela_media").notNull().default(false),
    nivel: smallint("nivel").notNull(),
  },
  (t) => [
    checkAtivo("categoria"),
    check(
      "categoria_nivel_valido",
      sql.raw(`nivel BETWEEN 1 AND 3 AND ((pai_id IS NULL) = (nivel = 1))`),
    ),
    // Alvos das chaves estrangeiras compostas (mesmo titular; mesmo tipo da mãe).
    uniqueIndex("categoria_titular_id_unico").on(t.titularId, t.id),
    uniqueIndex("categoria_titular_id_tipo_unico").on(t.titularId, t.id, t.tipo),
    foreignKey({
      name: "categoria_pai_mesmo_titular_e_tipo_fk",
      columns: [t.titularId, t.paiId, t.tipo],
      foreignColumns: [t.titularId, t.id, t.tipo],
    }),
    uniqueIndex("categoria_nome_unico_entre_irmas")
      .on(
        t.titularId,
        sql`coalesce(${t.paiId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`lower(${t.nome})`,
      )
      .where(sql`${t.ativo}`),
    index("categoria_titular_pai_idx").on(t.titularId, t.paiId),
  ],
);

export const tipoConta = pgEnum("tipo_conta", ["carteira", "banco", "cartao"]);

/**
 * Contas financeiras do titular (carteira, banco, cartão). Cartão nesta fase é só o tipo:
 * sem fechamento, vencimento, limite ou juros. Saldo não é gravado: é saldo inicial
 * (centavos) + lançamentos realizados ativos. Nome único entre contas **ativas** do titular.
 */
export const conta = pgTable(
  "conta",
  {
    ...comuns,
    titularId: uuid("titular_id")
      .notNull()
      .references(() => titular.id),
    nome: text("nome").notNull(),
    tipo: tipoConta("tipo").notNull(),
    saldoInicial: integer("saldo_inicial").notNull().default(0),
  },
  (t) => [
    checkAtivo("conta"),
    uniqueIndex("conta_titular_id_unico").on(t.titularId, t.id),
    uniqueIndex("conta_nome_unico_no_titular")
      .on(t.titularId, sql`lower(${t.nome})`)
      .where(sql`${t.ativo}`),
    index("conta_titular_idx").on(t.titularId),
  ],
);

export const tipoContato = pgEnum("tipo_contato", ["pf", "pj"]);
export const papelContato = pgEnum("papel_contato", ["cliente", "fornecedor", "ambos"]);

/**
 * Contatos (pessoas físicas ou jurídicas) com quem o titular movimenta dinheiro:
 * clientes, fornecedores ou ambos. Vínculo opcional no lançamento. Nome único entre
 * contatos ativos do titular.
 */
export const contato = pgTable(
  "contato",
  {
    ...comuns,
    titularId: uuid("titular_id")
      .notNull()
      .references(() => titular.id),
    nome: text("nome").notNull(),
    tipo: tipoContato("tipo").notNull(),
    papel: papelContato("papel").notNull(),
    documento: text("documento"),
    observacao: text("observacao"),
  },
  (t) => [
    checkAtivo("contato"),
    uniqueIndex("contato_titular_id_unico").on(t.titularId, t.id),
    uniqueIndex("contato_nome_unico_no_titular")
      .on(t.titularId, sql`lower(${t.nome})`)
      .where(sql`${t.ativo}`),
    index("contato_titular_idx").on(t.titularId),
  ],
);

export const tipoLancamento = pgEnum("tipo_lancamento", ["receita", "despesa"]);
export const statusLancamento = pgEnum("status_lancamento", ["previsto", "realizado"]);
export const origemLancamento = pgEnum("origem_lancamento", ["manual"]);

/**
 * Lançamentos manuais de receita e despesa. Só em categoria folha (sem filhas ativas).
 * Transferência, recorrência, parcelas e previsão pela média ficam para a Fase 3.
 * `data` é o dia (sem hora), fuso America/Sao_Paulo na interface.
 * Saldo da conta usa só os realizados ativos.
 */
export const lancamento = pgTable(
  "lancamento",
  {
    ...comuns,
    titularId: uuid("titular_id")
      .notNull()
      .references(() => titular.id),
    categoriaId: uuid("categoria_id").notNull(),
    contaId: uuid("conta_id").notNull(),
    contatoId: uuid("contato_id"),
    valor: integer("valor").notNull(),
    tipo: tipoLancamento("tipo").notNull(),
    status: statusLancamento("status").notNull(),
    natureza: naturezaEnum("natureza").notNull(),
    data: date("data", { mode: "string" }).notNull(),
    descricao: text("descricao").notNull(),
    observacao: text("observacao"),
    origem: origemLancamento("origem").notNull().default("manual"),
    valorPrevistoOriginal: integer("valor_previsto_original"),
  },
  (t) => [
    checkAtivo("lancamento"),
    check("lancamento_valor_positivo", sql.raw(`valor > 0`)),
    check(
      "lancamento_previsto_original_positivo",
      sql.raw(`valor_previsto_original IS NULL OR valor_previsto_original > 0`),
    ),
    foreignKey({
      name: "lancamento_categoria_mesmo_titular_fk",
      columns: [t.titularId, t.categoriaId],
      foreignColumns: [categoria.titularId, categoria.id],
    }),
    foreignKey({
      name: "lancamento_conta_mesmo_titular_fk",
      columns: [t.titularId, t.contaId],
      foreignColumns: [conta.titularId, conta.id],
    }),
    foreignKey({
      name: "lancamento_contato_mesmo_titular_fk",
      columns: [t.titularId, t.contatoId],
      foreignColumns: [contato.titularId, contato.id],
    }),
    index("lancamento_categoria_idx").on(t.categoriaId, t.ativo),
    index("lancamento_conta_idx").on(t.contaId, t.ativo),
    index("lancamento_contato_idx").on(t.contatoId, t.ativo),
    index("lancamento_titular_data_idx").on(t.titularId, t.data),
  ],
);

/**
 * Convites de cadastro. Só o admin convida titulares (papel "titular"); a tabela já
 * comporta convites de usuário vinculado (papel "vinculado" + titular_id) para a tarefa 6.
 * O token vai no link e só o HMAC dele fica aqui. Uso único (usado_em) e validade de 7 dias.
 */
export const convite = pgTable(
  "convite",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    papel: papel("papel").notNull(),
    nomeTitular: text("nome_titular").notNull(),
    /** Preenchidos só em convites de usuário vinculado: titular de destino e permissões iniciais. */
    titularId: uuid("titular_id").references(() => titular.id),
    permissoes: jsonb("permissoes"),
    tokenHash: text("token_hash").notNull(),
    expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
    usadoEm: timestamp("usado_em", { withTimezone: true }),
    usadoPor: uuid("usado_por"),
    /** Convite cancelado antes de ser usado. Nada se apaga: só se marca. */
    revogadoEm: timestamp("revogado_em", { withTimezone: true }),
    revogadoPor: uuid("revogado_por"),
    criadoPor: uuid("criado_por").notNull(),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("convite_token_unico").on(t.tokenHash),
    index("convite_email_idx").on(sql`lower(${t.email})`),
  ],
);

/**
 * Redefinição de senha por link, criada pelo admin (não há recuperação por e-mail na v1).
 * Ninguém além do próprio usuário sabe a nova senha. O token vai no link e só o HMAC fica aqui.
 * Uso único, 24 horas de validade; uma nova redefinição revoga as pendentes.
 */
export const redefinicaoSenha = pgTable(
  "redefinicao_senha",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    usuarioId: uuid("usuario_id")
      .notNull()
      .references(() => usuario.id),
    tokenHash: text("token_hash").notNull(),
    expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
    usadoEm: timestamp("usado_em", { withTimezone: true }),
    revogadaEm: timestamp("revogada_em", { withTimezone: true }),
    criadoPor: uuid("criado_por").notNull(),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("redefinicao_token_unico").on(t.tokenHash),
    index("redefinicao_usuario_idx").on(t.usuarioId),
  ],
);

/**
 * Sessões de login. O token em si só existe no cookie do navegador; aqui fica
 * apenas o hash dele (HMAC). Sessão encerrada = `revogada_em` preenchido
 * (nada se apaga).
 */
export const sessao = pgTable(
  "sessao",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    usuarioId: uuid("usuario_id")
      .notNull()
      .references(() => usuario.id),
    tokenHash: text("token_hash").notNull(),
    csrfToken: text("csrf_token").notNull(),
    criadaEm: timestamp("criada_em", { withTimezone: true }).notNull().defaultNow(),
    ultimoAcesso: timestamp("ultimo_acesso", { withTimezone: true }).notNull().defaultNow(),
    revogadaEm: timestamp("revogada_em", { withTimezone: true }),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [uniqueIndex("sessao_token_unico").on(t.tokenHash), index("sessao_usuario_idx").on(t.usuarioId)],
);

/**
 * Tentativas de login, para limitar força bruta por e-mail e por IP.
 * Só de inclusão para o papel da API (ver grants.ts).
 */
export const tentativaLogin = pgTable(
  "tentativa_login",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    emailMinusculo: text("email_minusculo").notNull(),
    ip: text("ip").notNull(),
    sucesso: boolean("sucesso").notNull(),
    ocorridoEm: timestamp("ocorrido_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tentativa_email_idx").on(t.emailMinusculo, t.ocorridoEm),
    index("tentativa_ip_idx").on(t.ip, t.ocorridoEm),
  ],
);

/**
 * Log de auditoria: só de inclusão.
 * - O papel da API tem apenas INSERT e SELECT (ver grants.ts).
 * - Gatilhos no banco bloqueiam UPDATE, DELETE e TRUNCATE até para o dono.
 * Sem chaves estrangeiras de propósito: o log precisa aceitar eventos sem
 * usuário (ex.: falha de login) e sobreviver a qualquer mudança nas outras tabelas.
 */
export const log = pgTable(
  "log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ocorridoEm: timestamp("ocorrido_em", { withTimezone: true }).notNull().defaultNow(),
    usuarioId: uuid("usuario_id"),
    titularId: uuid("titular_id"),
    acao: text("acao").notNull(),
    entidade: text("entidade"),
    entidadeId: text("entidade_id"),
    ip: text("ip"),
    antes: jsonb("antes"),
    depois: jsonb("depois"),
    confirmadoPor: uuid("confirmado_por"),
  },
  (t) => [
    index("log_titular_data_idx").on(t.titularId, t.ocorridoEm),
    // Leitura do log inteiro (admin), do mais recente para o mais antigo.
    index("log_data_idx").on(t.ocorridoEm, t.id),
  ],
);
