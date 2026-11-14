import type { Db } from "../db/client.js";
import { categoria } from "../db/schema.js";
import { registrarLog } from "../log.js";

type Natureza = "fixa" | "variavel";

interface RaizPadrao {
  nome: string;
  tipo: "receita" | "despesa";
  natureza: Natureza;
  filhas?: { nome: string; natureza: Natureza }[];
}

/**
 * Árvore inicial de todo titular novo. É só um ponto de partida: o titular edita, cria e
 * inativa à vontade (3 níveis no máximo). Só as folhas recebem lançamentos.
 */
export const ARVORE_PADRAO: readonly RaizPadrao[] = [
  { nome: "Salário", tipo: "receita", natureza: "fixa" },
  { nome: "Rendimentos", tipo: "receita", natureza: "variavel" },
  { nome: "Outras receitas", tipo: "receita", natureza: "variavel" },
  {
    nome: "Moradia",
    tipo: "despesa",
    natureza: "fixa",
    filhas: [
      { nome: "Aluguel ou financiamento", natureza: "fixa" },
      { nome: "Condomínio", natureza: "fixa" },
      { nome: "Energia elétrica", natureza: "variavel" },
      { nome: "Água", natureza: "variavel" },
      { nome: "Internet e telefone", natureza: "fixa" },
      { nome: "Manutenção da casa", natureza: "variavel" },
    ],
  },
  {
    nome: "Alimentação",
    tipo: "despesa",
    natureza: "variavel",
    filhas: [
      { nome: "Mercado", natureza: "variavel" },
      { nome: "Restaurantes e delivery", natureza: "variavel" },
    ],
  },
  {
    nome: "Transporte",
    tipo: "despesa",
    natureza: "variavel",
    filhas: [
      { nome: "Combustível", natureza: "variavel" },
      { nome: "Transporte público", natureza: "variavel" },
      { nome: "Manutenção do veículo", natureza: "variavel" },
      { nome: "Seguro e IPVA", natureza: "fixa" },
    ],
  },
  {
    nome: "Saúde",
    tipo: "despesa",
    natureza: "variavel",
    filhas: [
      { nome: "Plano de saúde", natureza: "fixa" },
      { nome: "Farmácia", natureza: "variavel" },
      { nome: "Consultas e exames", natureza: "variavel" },
    ],
  },
  {
    nome: "Educação",
    tipo: "despesa",
    natureza: "fixa",
    filhas: [
      { nome: "Mensalidade", natureza: "fixa" },
      { nome: "Cursos e livros", natureza: "variavel" },
    ],
  },
  {
    nome: "Lazer",
    tipo: "despesa",
    natureza: "variavel",
    filhas: [
      { nome: "Assinaturas e streaming", natureza: "fixa" },
      { nome: "Viagens", natureza: "variavel" },
      { nome: "Passeios", natureza: "variavel" },
    ],
  },
  { nome: "Outras despesas", tipo: "despesa", natureza: "variavel" },
];

/**
 * Cria a árvore padrão de um titular recém-criado. Deve rodar na MESMA transação que cria o
 * titular (convite aceito, primeiro admin): ou nasce tudo, ou nada. Registra no log.
 */
export async function criarCategoriasPadrao(
  db: Pick<Db, "insert">,
  p: { titularId: string; usuarioId: string; ip: string },
): Promise<number> {
  const base = { titularId: p.titularId, criadoPor: p.usuarioId };

  const raizes = await db
    .insert(categoria)
    .values(
      ARVORE_PADRAO.map((r) => ({
        ...base,
        nome: r.nome,
        tipo: r.tipo,
        natureza: r.natureza,
        nivel: 1,
      })),
    )
    .returning({ id: categoria.id, nome: categoria.nome });
  const idPorNome = new Map(raizes.map((r) => [r.nome, r.id]));

  const filhas = ARVORE_PADRAO.flatMap((r) =>
    (r.filhas ?? []).map((f) => ({
      ...base,
      paiId: idPorNome.get(r.nome)!,
      nome: f.nome,
      tipo: r.tipo,
      natureza: f.natureza,
      nivel: 2,
    })),
  );
  if (filhas.length > 0) await db.insert(categoria).values(filhas);

  const total = ARVORE_PADRAO.length + filhas.length;
  await registrarLog(db, {
    acao: "categoria.padraocriada",
    usuarioId: p.usuarioId,
    titularId: p.titularId,
    entidade: "titular",
    entidadeId: p.titularId,
    ip: p.ip,
    depois: { total },
  });
  return total;
}
