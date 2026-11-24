import { formatBRL } from "@finan/shared";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiErro } from "../api";
import { DialogoSenha } from "../componentes/DialogoSenha";
import { folhasDaArvore, FormLancamento } from "../componentes/FormLancamento";
import {
  deslocarMes,
  formatarDiaGrupo,
  formatarMes,
  hojeSP,
  primeiroDiaDoMes,
  rotuloTipo,
  ultimoDiaDoMes,
} from "../formato";
import { podeLancar } from "../rotas";
import { useMe } from "../sessao";
import type { Categoria, Conta, Contato, Lancamento } from "../tipos";

const LIMITE_PAGINA = 50;

function gruposPorDia(lista: Lancamento[]): { data: string; itens: Lancamento[] }[] {
  const grupos: { data: string; itens: Lancamento[] }[] = [];
  for (const l of lista) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.data === l.data) ultimo.itens.push(l);
    else grupos.push({ data: l.data, itens: [l] });
  }
  return grupos;
}

function mesValido(v: string | null): string {
  return v && /^\d{4}-\d{2}$/.test(v) ? v : hojeSP().slice(0, 7);
}

export function Lancamentos() {
  const { permissoes } = useMe();
  const [params, setParams] = useSearchParams();

  const mes = mesValido(params.get("mes"));
  const todosMeses = params.get("periodo") === "todos";
  const tipoFiltro =
    params.get("tipo") === "receita" || params.get("tipo") === "despesa"
      ? (params.get("tipo") as "receita" | "despesa")
      : "";
  const statusFiltro =
    params.get("status") === "realizado" || params.get("status") === "previsto"
      ? (params.get("status") as "realizado" | "previsto")
      : "";
  const contaFiltro = params.get("contaId") ?? "";
  const catFiltro = params.get("categoriaId") ?? "";
  const contatoFiltro = params.get("contatoId") ?? "";

  const [lista, setLista] = useState<Lancamento[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [carregando, setCarregando] = useState(true);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [cats, setCats] = useState<Categoria[]>([]);
  const [contas, setContas] = useState<Conta[]>([]);
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<Lancamento | "novo" | null>(null);
  const [inativarId, setInativarId] = useState<string | null>(null);
  const [recarregarSeq, setRecarregarSeq] = useState(0);
  const [mostrarFiltros, setMostrarFiltros] = useState(
    Boolean(todosMeses || tipoFiltro || statusFiltro || contaFiltro || catFiltro || contatoFiltro),
  );

  const podeVerCats = permissoes.categorias.ver;
  const podeVerContas = permissoes.contas.ver;
  const podeVerContatos = permissoes.contatos.ver;
  const podeCriar = podeLancar(permissoes);
  const qtdFiltros = [
    todosMeses,
    tipoFiltro,
    statusFiltro,
    contaFiltro,
    catFiltro,
    contatoFiltro,
  ].filter(Boolean).length;
  const filtrosVisiveis = mostrarFiltros || qtdFiltros > 0;

  function atualizarFiltro(alteracoes: Record<string, string | null>) {
    const proximo = new URLSearchParams(params);
    for (const [k, v] of Object.entries(alteracoes)) {
      if (v) proximo.set(k, v);
      else proximo.delete(k);
    }
    setParams(proximo, { replace: true });
  }

  const montarQuery = useCallback(
    (pag: number) => {
      const q = new URLSearchParams();
      if (!todosMeses) {
        q.set("dataDesde", primeiroDiaDoMes(`${mes}-01`));
        q.set("dataAte", ultimoDiaDoMes(`${mes}-01`));
      }
      if (tipoFiltro) q.set("tipo", tipoFiltro);
      if (statusFiltro) q.set("status", statusFiltro);
      if (contaFiltro) q.set("contaId", contaFiltro);
      if (catFiltro) q.set("categoriaId", catFiltro);
      if (contatoFiltro) q.set("contatoId", contatoFiltro);
      q.set("limite", String(LIMITE_PAGINA));
      q.set("pagina", String(pag));
      return q.toString();
    },
    [mes, todosMeses, tipoFiltro, statusFiltro, contaFiltro, catFiltro, contatoFiltro],
  );

  // Carrega listas auxiliares só se o usuário tiver permissão (evita 403 para vinculados parciais).
  useEffect(() => {
    let ativo = true;
    const promessas: Promise<void>[] = [];
    if (podeVerCats) {
      promessas.push(
        api<{ arvore: Categoria[] }>("/categorias").then((c) => {
          if (ativo) setCats(c.arvore);
        }),
      );
    }
    if (podeVerContas) {
      promessas.push(
        api<{ contas: Conta[] }>("/contas").then((ct) => {
          if (ativo) setContas(ct.contas);
        }),
      );
    }
    if (podeVerContatos) {
      promessas.push(
        api<{ contatos: Contato[] }>("/contatos").then((cts) => {
          if (ativo) setContatos(cts.contatos);
        }),
      );
    }
    void Promise.all(promessas).catch(() => {
      /* se falhar, a lista de lançamentos ainda carrega */
    });
    return () => {
      ativo = false;
    };
  }, [podeVerCats, podeVerContas, podeVerContatos, recarregarSeq]);

  useEffect(() => {
    let ativo = true;
    setErro(null);
    setCarregando(true);
    api<{ lancamentos: Lancamento[]; total: number }>(`/lancamentos?${montarQuery(1)}`)
      .then((l) => {
        if (!ativo) return;
        setLista(l.lancamentos);
        setTotal(l.total);
        setPagina(1);
      })
      .catch((e) => {
        if (ativo) setErro(e instanceof ApiErro ? e.message : "Falha ao carregar");
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });
    return () => {
      ativo = false;
    };
  }, [montarQuery, recarregarSeq]);

  async function carregarMais() {
    const prox = pagina + 1;
    setCarregandoMais(true);
    try {
      const r = await api<{ lancamentos: Lancamento[]; total: number }>(
        `/lancamentos?${montarQuery(prox)}`,
      );
      setLista((prev) => [...prev, ...r.lancamentos]);
      setTotal(r.total);
      setPagina(prox);
    } catch (e) {
      setErro(e instanceof ApiErro ? e.message : "Falha ao carregar mais lançamentos");
    } finally {
      setCarregandoMais(false);
    }
  }

  const opcoesCat = folhasDaArvore(cats);
  const nomeCat = (id: string) => {
    const achar = (ns: Categoria[]): string | undefined => {
      for (const n of ns) {
        if (n.id === id) return n.nome;
        const f = achar(n.filhas);
        if (f) return f;
      }
    };
    return achar(cats) ?? "";
  };
  const nomeConta = (id: string) => contas.find((c) => c.id === id)?.nome ?? "";
  const nomeContato = (id: string | null) => (id ? (contatos.find((c) => c.id === id)?.nome ?? "") : "");
  const contatoFiltrado = contatoFiltro ? contatos.find((c) => c.id === contatoFiltro) : null;
  const temFiltro = Boolean(
    todosMeses || tipoFiltro || statusFiltro || contaFiltro || catFiltro || contatoFiltro,
  );

  return (
    <>
      <div className="pagina-cab">
        <div>
          <h1>Lançamentos</h1>
          {todosMeses ? (
            <div className="mes-nav">
              <p className="mes-atual">Todos os meses</p>
              <button
                type="button"
                className="btn-sec btn-chip-mes"
                onClick={() => atualizarFiltro({ periodo: null })}
              >
                Voltar ao mês
              </button>
            </div>
          ) : (
            <div className="mes-nav">
              <button
                type="button"
                className="btn-sec"
                aria-label="Mês anterior"
                onClick={() => atualizarFiltro({ mes: deslocarMes(mes, -1) })}
              >
                ‹
              </button>
              <p className="mes-atual">{formatarMes(mes)}</p>
              <button
                type="button"
                className="btn-sec"
                aria-label="Próximo mês"
                onClick={() => atualizarFiltro({ mes: deslocarMes(mes, 1) })}
              >
                ›
              </button>
            </div>
          )}
        </div>
        <div className="filtros">
          <button
            type="button"
            className="btn-sec"
            aria-expanded={filtrosVisiveis}
            onClick={() => setMostrarFiltros((v) => !v)}
          >
            {qtdFiltros > 0 ? `Filtros (${qtdFiltros})` : "Filtros"}
          </button>
          {podeCriar ? (
            <button type="button" className="btn cab-novo" onClick={() => setEditando("novo")}>
              Novo lançamento
            </button>
          ) : null}
        </div>
      </div>

      {filtrosVisiveis ? (
      <div className="barra-filtros" aria-label="Filtros de lançamentos">
        <select
          aria-label="Filtrar por tipo"
          value={tipoFiltro}
          onChange={(e) => atualizarFiltro({ tipo: e.target.value || null })}
        >
          <option value="">Todos os tipos</option>
          <option value="despesa">Despesas</option>
          <option value="receita">Receitas</option>
        </select>
        <select
          aria-label="Filtrar por status"
          value={statusFiltro}
          onChange={(e) => atualizarFiltro({ status: e.target.value || null })}
        >
          <option value="">Realizados e previstos</option>
          <option value="realizado">Realizados</option>
          <option value="previsto">Previstos</option>
        </select>
        {podeVerContas && contas.length > 0 ? (
          <select
            aria-label="Filtrar por conta"
            value={contaFiltro}
            onChange={(e) => atualizarFiltro({ contaId: e.target.value || null })}
          >
            <option value="">Todas as contas</option>
            {contas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        ) : null}
        {podeVerCats && opcoesCat.length > 0 ? (
          <select
            aria-label="Filtrar por categoria"
            value={catFiltro}
            onChange={(e) => atualizarFiltro({ categoriaId: e.target.value || null })}
          >
            <option value="">Todas as categorias</option>
            {opcoesCat.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        ) : null}
        {podeVerContatos && contatos.length > 0 ? (
          <select
            aria-label="Filtrar por contato"
            value={contatoFiltro}
            onChange={(e) => atualizarFiltro({ contatoId: e.target.value || null })}
          >
            <option value="">Todos os contatos</option>
            {contatos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        ) : null}
        {temFiltro ? (
          <button
            type="button"
            className="btn-sec"
            onClick={() =>
              atualizarFiltro({
                periodo: null,
                tipo: null,
                status: null,
                contaId: null,
                categoriaId: null,
                contatoId: null,
              })
            }
          >
            Limpar filtros
          </button>
        ) : null}
      </div>
      ) : null}

      {contatoFiltrado ? (
        <div className="pn-card resumo-contato-filtro">
          <div>
            <strong>{contatoFiltrado.nome}</strong>
            <span className="meta">
              {rotuloTipo(contatoFiltrado.papel)} · {contatoFiltrado.tipo.toUpperCase()}
            </span>
          </div>
          <dl className="contato-totais">
            <div>
              <dt>Recebido</dt>
              <dd className={`pn-valor${contatoFiltrado.recebido > 0 ? " receita" : ""}`}>
                {formatBRL(contatoFiltrado.recebido)}
              </dd>
            </div>
            <div>
              <dt>Pago</dt>
              <dd className={`pn-valor${contatoFiltrado.pago > 0 ? " despesa" : ""}`}>
                {formatBRL(contatoFiltrado.pago)}
              </dd>
            </div>
            <div>
              <dt>Me deve</dt>
              <dd className={`pn-valor${contatoFiltrado.aReceber > 0 ? " receita" : ""}`}>
                {formatBRL(contatoFiltrado.aReceber)}
              </dd>
            </div>
            <div>
              <dt>Eu devo</dt>
              <dd className={`pn-valor${contatoFiltrado.aPagar > 0 ? " despesa" : ""}`}>
                {formatBRL(contatoFiltrado.aPagar)}
              </dd>
            </div>
          </dl>
        </div>
      ) : null}

      {erro ? <p className="erro">{erro}</p> : null}
      {editando ? (
        <FormLancamento
          inicial={editando === "novo" ? null : editando}
          categorias={opcoesCat}
          contas={contas}
          contatos={contatos}
          aoCancelar={() => setEditando(null)}
          aoSalvo={async () => {
            setEditando(null);
            setRecarregarSeq((n) => n + 1);
          }}
        />
      ) : null}
      {carregando ? (
        <p className="vazio">Carregando…</p>
      ) : lista.length === 0 ? (
        <p className="vazio">
          {temFiltro ? "Nenhum lançamento encontrado com esses filtros" : "Nenhum lançamento neste mês"}
        </p>
      ) : (
        <>
          <ul className="lista">
            {gruposPorDia(lista).flatMap((g) => [
              <li key={`dia-${g.data}`} className="dia-row">
                {formatarDiaGrupo(g.data)}
              </li>,
              ...g.itens.map((l) => {
                const cat = nomeCat(l.categoriaId);
                const cta = nomeConta(l.contaId);
                const cto = nomeContato(l.contatoId);
                return (
                  <li key={l.id} className={`caderno ${l.tipo} ${l.status}`}>
                    <span className={`marca-tipo ${l.tipo}`} aria-hidden="true">
                      {l.tipo === "receita" ? "+" : "−"}
                    </span>
                    <strong>{l.descricao}</strong>
                    <span className={`valor ${l.tipo}`}>
                      {l.tipo === "despesa" ? "−" : "+"}
                      {formatBRL(l.valor)}
                    </span>
                    <span className="meta">
                      {cat ? <span className={`pilula ${l.tipo}`}>{cat}</span> : null}
                      {cto ? <span className="pilula">{cto}</span> : null}
                      {cta ? <span>{cta}</span> : null}
                      {l.status === "previsto" ? <span>· {rotuloTipo(l.status)}</span> : null}
                      {l.natureza === "fixa" ? <span>· Fixa</span> : null}
                      {l.observacao ? <span className="obs">· {l.observacao}</span> : null}
                    </span>
                    <div className="acoes">
                      {permissoes.lancamentos.alterar && podeVerCats && podeVerContas ? (
                        <button type="button" className="btn-sec" onClick={() => setEditando(l)}>
                          Editar
                        </button>
                      ) : null}
                      {permissoes.lancamentos.excluir ? (
                        <button type="button" className="btn-perigo" onClick={() => setInativarId(l.id)}>
                          Inativar
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              }),
            ])}
          </ul>
          {lista.length < total ? (
            <div className="paginacao">
              <button
                type="button"
                className="btn-sec"
                disabled={carregandoMais}
                onClick={() => void carregarMais()}
              >
                {carregandoMais
                  ? "Carregando…"
                  : `Carregar mais (mostrando ${lista.length} de ${total})`}
              </button>
            </div>
          ) : null}
        </>
      )}
      {podeCriar ? (
        <button
          type="button"
          className="fab"
          aria-label="Novo lançamento"
          onClick={() => setEditando("novo")}
        >
          +
        </button>
      ) : null}
      {inativarId ? (
        <DialogoSenha
          titulo="Inativar lançamento"
          aoFechar={() => setInativarId(null)}
          aoConfirmar={async (senha) => {
            await api(`/lancamentos/${inativarId}/inativar`, { method: "POST", body: { senha } });
            setInativarId(null);
            setRecarregarSeq((n) => n + 1);
          }}
        />
      ) : null}
    </>
  );
}
