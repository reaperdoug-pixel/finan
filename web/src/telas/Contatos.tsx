import { formatBRL } from "@finan/shared";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiErro } from "../api";
import { DialogoSenha } from "../componentes/DialogoSenha";
import { Icone } from "../componentes/Icones";
import { Modal } from "../componentes/Modal";
import { formatarDocumento, rotuloTipo } from "../formato";
import { useMe } from "../sessao";
import type { Contato } from "../tipos";

type FiltroContato = "todos" | "me_devem" | "eu_devo" | "clientes" | "fornecedores";

export function Contatos() {
  const { permissoes } = useMe();
  const [lista, setLista] = useState<Contato[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<FiltroContato>("todos");
  const [form, setForm] = useState<Contato | "novo" | null>(null);
  const [inativar, setInativar] = useState<Contato | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    const r = await api<{ contatos: Contato[] }>("/contatos");
    setLista(r.contatos);
  }, []);

  useEffect(() => {
    setCarregando(true);
    carregar()
      .catch((e) => setErro(e instanceof ApiErro ? e.message : "Falha ao carregar"))
      .finally(() => setCarregando(false));
  }, [carregar]);

  const totalAReceber = lista.reduce((s, c) => s + c.aReceber, 0);
  const totalAPagar = lista.reduce((s, c) => s + c.aPagar, 0);
  const qtdMeDevem = lista.filter((c) => c.aReceber > 0).length;
  const qtdEuDevo = lista.filter((c) => c.aPagar > 0).length;

  const termo = busca.trim().toLowerCase();
  const termoDigitos = termo.replace(/\D/g, "");
  const filtrados = lista.filter((c) => {
    if (filtro === "me_devem" && c.aReceber <= 0) return false;
    if (filtro === "eu_devo" && c.aPagar <= 0) return false;
    if (filtro === "clientes" && c.papel !== "cliente" && c.papel !== "ambos") return false;
    if (filtro === "fornecedores" && c.papel !== "fornecedor" && c.papel !== "ambos") return false;
    if (!termo) return true;
    if (c.nome.toLowerCase().includes(termo)) return true;
    if (c.observacao?.toLowerCase().includes(termo)) return true;
    if (termoDigitos && c.documento?.includes(termoDigitos)) return true;
    return false;
  });

  const abas: Array<{ id: FiltroContato; rotulo: string; qtd?: number }> = [
    { id: "todos", rotulo: "Todos", qtd: lista.length },
    { id: "me_devem", rotulo: "Me devem", qtd: qtdMeDevem },
    { id: "eu_devo", rotulo: "Eu devo", qtd: qtdEuDevo },
    { id: "clientes", rotulo: "Clientes" },
    { id: "fornecedores", rotulo: "Fornecedores" },
  ];

  return (
    <>
      <div className="pagina-cab">
        <div>
          <h1>Contatos</h1>
          <p className="meta">
            Clientes, fornecedores e prestadores (PF e PJ) — veja quanto pagou, recebeu e o que está pendente
          </p>
        </div>
        {permissoes.contatos.cadastrar ? (
          <button type="button" className="btn cab-novo" onClick={() => setForm("novo")}>
            Novo contato
          </button>
        ) : null}
      </div>

      {erro ? <p className="erro">{erro}</p> : null}

      {lista.length > 0 ? (
        <>
          <div className="contatos-resumo">
            <button
              type="button"
              className={`pn-card contato-kpi${filtro === "me_devem" ? " ativo" : ""}`}
              onClick={() => setFiltro((f) => (f === "me_devem" ? "todos" : "me_devem"))}
            >
              <span className="contato-kpi-rotulo">A receber (me devem)</span>
              <strong className="pn-valor receita">{formatBRL(totalAReceber)}</strong>
              <small>
                {qtdMeDevem === 0
                  ? "Nenhuma pendência a receber"
                  : qtdMeDevem === 1
                    ? "1 contato com previsto a receber"
                    : `${qtdMeDevem} contatos com previstos a receber`}
              </small>
            </button>
            <button
              type="button"
              className={`pn-card contato-kpi${filtro === "eu_devo" ? " ativo" : ""}`}
              onClick={() => setFiltro((f) => (f === "eu_devo" ? "todos" : "eu_devo"))}
            >
              <span className="contato-kpi-rotulo">A pagar (eu devo)</span>
              <strong className="pn-valor despesa">{formatBRL(totalAPagar)}</strong>
              <small>
                {qtdEuDevo === 0
                  ? "Nenhuma pendência a pagar"
                  : qtdEuDevo === 1
                    ? "1 contato com previsto a pagar"
                    : `${qtdEuDevo} contatos com previstos a pagar`}
              </small>
            </button>
          </div>

          <div className="contatos-filtros">
            <input
              type="search"
              className="contatos-busca"
              placeholder="Buscar por nome, CPF/CNPJ ou observação…"
              aria-label="Buscar contato"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            <div className="contatos-chips" role="group" aria-label="Filtrar contatos">
              {abas.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`chip-filtro${filtro === a.id ? " ativo" : ""}`}
                  onClick={() => setFiltro(a.id)}
                >
                  {a.rotulo}
                  {a.qtd !== undefined ? <span className="chip-qtd">{a.qtd}</span> : null}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}

      {form ? (
        <FormContato
          inicial={form === "novo" ? null : form}
          aoCancelar={() => setForm(null)}
          aoSalvo={async () => {
            setForm(null);
            await carregar();
          }}
        />
      ) : null}

      {carregando ? (
        <p className="vazio">Carregando…</p>
      ) : lista.length === 0 ? (
        <p className="vazio">
          Nenhum contato cadastrado ainda. Cadastre fornecedores (ex.: energia, internet) e clientes
          para acompanhar pagamentos, recebimentos e pendências.
        </p>
      ) : filtrados.length === 0 ? (
        <p className="vazio">Nenhum contato encontrado com este filtro</p>
      ) : (
        <ul className="lista lista-contatos">
          {filtrados.map((c) => (
            <li key={c.id} className="contato-item">
              <div className="contato-topo">
                <span className="marca-tipo" aria-hidden="true">
                  <Icone nome={c.tipo} />
                </span>
                <div className="contato-id">
                  <strong>{c.nome}</strong>
                  <span className="meta">
                    <span className="pilula">{c.tipo.toUpperCase()}</span>
                    <span className="pilula">{rotuloTipo(c.papel)}</span>
                    {c.documento ? <span className="mono">{formatarDocumento(c.documento)}</span> : null}
                    {c.observacao ? <span className="obs">· {c.observacao}</span> : null}
                  </span>
                </div>
              </div>

              <dl className="contato-totais">
                {c.aReceber > 0 ? (
                  <div className="destaque-receber">
                    <dt>Me deve (previsto)</dt>
                    <dd className="pn-valor receita">{formatBRL(c.aReceber)}</dd>
                  </div>
                ) : null}
                {c.aPagar > 0 ? (
                  <div className="destaque-pagar">
                    <dt>Eu devo (previsto)</dt>
                    <dd className="pn-valor despesa">{formatBRL(c.aPagar)}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Recebido</dt>
                  <dd className={`pn-valor${c.recebido > 0 ? " receita" : ""}`}>
                    {formatBRL(c.recebido)}
                  </dd>
                </div>
                <div>
                  <dt>Pago</dt>
                  <dd className={`pn-valor${c.pago > 0 ? " despesa" : ""}`}>{formatBRL(c.pago)}</dd>
                </div>
              </dl>

              <div className="acoes">
                {permissoes.lancamentos.ver && c.totalLancamentos > 0 ? (
                  <Link
                    to={`/lancamentos?contatoId=${c.id}&periodo=todos`}
                    className="btn-sec btn-link-acao"
                  >
                    Lançamentos ({c.totalLancamentos})
                  </Link>
                ) : null}
                {permissoes.lancamentos.ver && (c.aReceber > 0 || c.aPagar > 0) ? (
                  <Link
                    to={`/lancamentos?contatoId=${c.id}&status=previsto&periodo=todos`}
                    className="btn-sec btn-link-acao"
                  >
                    Ver pendentes
                  </Link>
                ) : null}
                {permissoes.contatos.alterar ? (
                  <button type="button" className="btn-sec" onClick={() => setForm(c)}>
                    Editar
                  </button>
                ) : null}
                {permissoes.contatos.excluir ? (
                  <button type="button" className="btn-perigo" onClick={() => setInativar(c)}>
                    Inativar
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {permissoes.contatos.cadastrar ? (
        <button
          type="button"
          className="fab"
          aria-label="Novo contato"
          onClick={() => setForm("novo")}
        >
          +
        </button>
      ) : null}

      {inativar ? (
        <DialogoSenha
          titulo={`Inativar ${inativar.nome}`}
          aoFechar={() => setInativar(null)}
          aoConfirmar={async (senha) => {
            await api(`/contatos/${inativar.id}/inativar`, { method: "POST", body: { senha } });
            setInativar(null);
            await carregar();
          }}
        />
      ) : null}
    </>
  );
}

function FormContato({
  inicial,
  aoCancelar,
  aoSalvo,
}: {
  inicial: Contato | null;
  aoCancelar: () => void;
  aoSalvo: () => Promise<void>;
}) {
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [tipo, setTipo] = useState<Contato["tipo"]>(inicial?.tipo ?? "pj");
  const [papel, setPapel] = useState<Contato["papel"]>(inicial?.papel ?? "fornecedor");
  const [documento, setDocumento] = useState(
    inicial?.documento ? formatarDocumento(inicial.documento) : "",
  );
  const [observacao, setObservacao] = useState(inicial?.observacao ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const corpo = {
        nome,
        tipo,
        papel,
        documento: documento.trim() ? documento : null,
        observacao: observacao.trim() ? observacao : null,
      };
      if (inicial) await api(`/contatos/${inicial.id}`, { method: "PATCH", body: corpo });
      else await api("/contatos", { method: "POST", body: corpo });
      await aoSalvo();
    } catch (err) {
      setErro(err instanceof ApiErro ? err.message : "Não foi possível salvar");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal
      titulo={inicial ? "Editar contato" : "Novo contato"}
      icone={inicial ? "editar" : "mais"}
      dica="Vincule este contato aos lançamentos para filtrar gastos/receitas e acompanhar valores a pagar e a receber."
      enviando={enviando}
      erro={erro}
      aoEnviar={(e) => void enviar(e)}
      aoFechar={aoCancelar}
    >
      <div className="modal-grade">
        <label className="largo">
          Nome ou razão social
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex.: CPFL Energia, Maria Silva, Empresa X"
            required
            maxLength={120}
          />
        </label>
        <label>
          Tipo
          <select value={tipo} onChange={(e) => setTipo(e.target.value as Contato["tipo"])}>
            <option value="pj">Pessoa jurídica (PJ)</option>
            <option value="pf">Pessoa física (PF)</option>
          </select>
        </label>
        <label>
          Papel
          <select value={papel} onChange={(e) => setPapel(e.target.value as Contato["papel"])}>
            <option value="fornecedor">Fornecedor</option>
            <option value="cliente">Cliente</option>
            <option value="ambos">Cliente e fornecedor</option>
          </select>
        </label>
        <label className="largo">
          {tipo === "pf" ? "CPF (opcional)" : "CNPJ (opcional)"}
          <input
            inputMode="numeric"
            value={documento}
            onChange={(e) => setDocumento(e.target.value)}
            placeholder={tipo === "pf" ? "000.000.000-00" : "00.000.000/0000-00"}
            maxLength={20}
          />
        </label>
        <label className="largo">
          Observação (opcional)
          <textarea
            rows={2}
            maxLength={500}
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="Ex.: consultoria mensal, conta de luz da casa, serviço de manutenção"
          />
        </label>
      </div>
    </Modal>
  );
}
