import type { Papel, Permissoes } from "./tipos";

/** Regra espelhada de `podeLancar` da API: para exibir o botão de novo lançamento. */
export function podeLancar(p: Permissoes): boolean {
  return p.lancamentos.cadastrar && p.categorias.ver && p.contas.ver;
}

/** Primeira tela acessível para quem acabou de entrar, evitando cair em erro 403. */
export function rotaInicial(p: Permissoes, papel: Papel): string {
  if (p.lancamentos.ver) return "/painel";
  if (p.contatos.ver) return "/contatos";
  if (p.categorias.ver) return "/categorias";
  if (p.contas.ver) return "/contas";
  if (papel !== "vinculado") return "/pessoas";
  if (p.log.ver) return "/log";
  return "/inativos";
}
