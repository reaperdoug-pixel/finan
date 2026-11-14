export interface LinhaCategoria {
  id: string;
  paiId: string | null;
  nome: string;
  tipo: "receita" | "despesa";
  natureza: "fixa" | "variavel";
  preverPelaMedia: boolean;
  nivel: number;
  ativo: boolean;
}

export interface NoCategoria extends LinhaCategoria {
  /** Tem ao menos uma filha ativa. Quem tem filha não recebe lançamento direto. */
  temFilhasAtivas: boolean;
  filhas: NoCategoria[];
}

const porNome = (a: { nome: string }, b: { nome: string }) =>
  a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" });

/**
 * Monta a árvore a partir da lista plana. Receitas primeiro, depois despesas; dentro de cada
 * nível, por nome. Uma categoria cuja mãe não está na lista (não deveria acontecer, pois não se
 * inativa mãe com filha ativa) aparece como raiz, em vez de sumir.
 */
export function montarArvore(linhas: LinhaCategoria[]): NoCategoria[] {
  const nos = new Map<string, NoCategoria>(
    linhas.map((l) => [l.id, { ...l, temFilhasAtivas: false, filhas: [] }]),
  );
  const raizes: NoCategoria[] = [];

  for (const no of nos.values()) {
    const mae = no.paiId ? nos.get(no.paiId) : undefined;
    if (mae) {
      mae.filhas.push(no);
      if (no.ativo) mae.temFilhasAtivas = true;
    } else {
      raizes.push(no);
    }
  }

  const ordenar = (lista: NoCategoria[]) => {
    lista.sort(porNome);
    for (const n of lista) ordenar(n.filhas);
  };
  ordenar(raizes);
  // receitas antes das despesas (sort estável preserva a ordem por nome dentro de cada grupo)
  raizes.sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === "receita" ? -1 : 1));
  return raizes;
}
