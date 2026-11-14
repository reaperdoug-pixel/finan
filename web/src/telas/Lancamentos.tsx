import { formatBRL, parseBRLToCents } from "@finan/shared";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiErro } from "../api";
import { Modal } from "../componentes/Modal";
import { DialogoSenha } from "../componentes/DialogoSenha";
import {
  deslocarMes,
  formatarDiaGrupo,
  formatarMes,
  hojeSP,
  primeiroDiaDoMes,
  rotuloTipo,
  ultimoDiaDoMes,
} from "../formato";
import { useMe } from "../sessao";
import type { Categoria, Conta, Lancamento } from "../tipos";

function folhas(nos: Categoria[]): Categoria[] {
  const out: Categoria[] = [];
  for (const n of nos) {
    if (n.filhas.length) out.push(...folhas(n.filhas));
    else if (n.ativo && !n.temFilhasAtivas) out.push(n);
  }
  return out;
}

function gruposPorDia(lista: Lancamento[]): { data: string; itens: Lancamento[] }[] {
  const grupos: { data: string; itens: Lancamento[] }[] = [];
  for (const l of lista) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.data === l.data) ultimo.itens.push(l);
    else grupos.push({ data: l.data, itens: [l] });
  }
  return grupos;
}

export function Lancamentos() {
  const { permissoes } = useMe();
  const [mes, setMes] = useState(hojeSP().slice(0, 7));
  const [lista, setLista] = useState<Lancamento[]>([]);
  const [cats, setCats] = useState<Categoria[]>([]);
  const [contas, setContas] = useState<Conta[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<Lancamento | "novo" | null>(null);
  const [inativarId, setInativarId] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const desde = primeiroDiaDoMes(`${mes}-01`);
    const ate = ultimoDiaDoMes(`${mes}-01`);
    const [l, c, ct] = await Promise.all([
      api<{ lancamentos: Lancamento[] }>(
        `/lancamentos?dataDesde=${desde}&dataAte=${ate}&limite=100`,
      ),
      api<{ arvore: Categoria[] }>("/categorias"),
      api<{ contas: Conta[] }>("/contas"),
    ]);
    setLista(l.lancamentos);
    setCats(c.arvore);
    setContas(ct.contas);
  }, [mes]);

  useEffect(() => {
    carregar().catch((e) => setErro(e instanceof ApiErro ? e.message : "Falha ao carregar"));
  }, [carregar]);

  const opcoesCat = folhas(cats);
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

  return (
    <>
      <div className="pagina-cab">
        <div>
          <h1>Lançamentos</h1>
          <div className="mes-nav">
            <button
              type="button"
              className="btn-sec"
              aria-label="Mês anterior"
              onClick={() => setMes((m) => deslocarMes(m, -1))}
            >
              ‹
            </button>
            <p className="mes-atual">{formatarMes(mes)}</p>
            <button
              type="button"
              className="btn-sec"
              aria-label="Próximo mês"
              onClick={() => setMes((m) => deslocarMes(m, 1))}
            >
              ›
            </button>
          </div>
        </div>
        <div className="filtros">
          {permissoes.lancamentos.cadastrar ? (
            <button type="button" className="btn cab-novo" onClick={() => setEditando("novo")}>
              Novo lançamento
            </button>
          ) : null}
        </div>
      </div>
      {erro ? <p className="erro">{erro}</p> : null}
      {editando ? (
        <FormLancamento
          inicial={editando === "novo" ? null : editando}
          categorias={opcoesCat}
          contas={contas}
          aoCancelar={() => setEditando(null)}
          aoSalvo={async () => {
            setEditando(null);
            await carregar();
          }}
        />
      ) : null}
      {lista.length === 0 ? (
        <p className="vazio">Nenhum lançamento neste mês</p>
      ) : (
        <ul className="lista">
          {gruposPorDia(lista).flatMap((g) => [
            <li key={`dia-${g.data}`} className="dia-row">
              {formatarDiaGrupo(g.data)}
            </li>,
            ...g.itens.map((l) => (
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
                  <span className={`pilula ${l.tipo}`}>{nomeCat(l.categoriaId)}</span>
                  {nomeConta(l.contaId)}
                  {l.status === "previsto" ? ` · ${rotuloTipo(l.status)}` : ""}
                </span>
                <div className="acoes">
                  {permissoes.lancamentos.alterar ? (
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
            )),
          ])}
        </ul>
      )}
      {permissoes.lancamentos.cadastrar ? (
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
            await carregar();
          }}
        />
      ) : null}
    </>
  );
}

function FormLancamento({
  inicial,
  categorias,
  contas,
  aoCancelar,
  aoSalvo,
}: {
  inicial: Lancamento | null;
  categorias: Categoria[];
  contas: Conta[];
  aoCancelar: () => void;
  aoSalvo: () => Promise<void>;
}) {
  const [descricao, setDescricao] = useState(inicial?.descricao ?? "");
  const [valorTxt, setValorTxt] = useState(
    inicial ? (inicial.valor / 100).toFixed(2).replace(".", ",") : "",
  );
  const [data, setData] = useState(inicial?.data ?? hojeSP());
  const [categoriaId, setCategoriaId] = useState(inicial?.categoriaId ?? categorias[0]?.id ?? "");
  const [contaId, setContaId] = useState(inicial?.contaId ?? contas[0]?.id ?? "");
  const [status, setStatus] = useState(inicial?.status ?? "realizado");
  const [erro, setErro] = useState<string | null>(null);
  const tipoCat = categorias.find((c) => c.id === categoriaId)?.tipo ?? "despesa";

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const valor = parseBRLToCents(valorTxt);
    if (valor === null || valor <= 0) {
      setErro("Informe um valor maior que zero, como 25,90");
      return;
    }
    setErro(null);
    try {
      const corpo = { descricao, valor, data, categoriaId, contaId, status };
      if (inicial) await api(`/lancamentos/${inicial.id}`, { method: "PATCH", body: corpo });
      else await api("/lancamentos", { method: "POST", body: corpo });
      await aoSalvo();
    } catch (err) {
      setErro(err instanceof ApiErro ? err.message : "Não foi possível salvar");
    }
  }

  return (
    <Modal
      titulo={inicial ? "Editar lançamento" : "Novo lançamento"}
      icone={inicial ? "editar" : "mais"}
      dica="Os indicadores, o fôlego de caixa e os gráficos são recalculados em seguida."
      erro={erro}
      aoEnviar={(e) => void enviar(e)}
      aoFechar={aoCancelar}
    >
      <div className="modal-grade">
      <label className="largo">
        Descrição
        <input value={descricao} onChange={(e) => setDescricao(e.target.value)} required maxLength={120} />
      </label>
      <label className={`campo-valor ${tipoCat}`}>
        Valor
        <input inputMode="decimal" value={valorTxt} onChange={(e) => setValorTxt(e.target.value)} required />
      </label>
      <label>
        Data
        <input type="date" value={data} onChange={(e) => setData(e.target.value)} required />
      </label>
      <label>
        Categoria
        <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} required>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome} ({rotuloTipo(c.tipo)})
            </option>
          ))}
        </select>
      </label>
      <label>
        Conta
        <select value={contaId} onChange={(e) => setContaId(e.target.value)} required>
          {contas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
      </label>
      <label>
        Status
        <select value={status} onChange={(e) => setStatus(e.target.value as "previsto" | "realizado")}>
          <option value="realizado">Realizado</option>
          <option value="previsto">Previsto</option>
        </select>
      </label>
      </div>
    </Modal>
  );
}
