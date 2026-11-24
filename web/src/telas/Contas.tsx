import { formatBRL, parseBRLToCents } from "@finan/shared";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiErro } from "../api";
import { DialogoSenha } from "../componentes/DialogoSenha";
import { Icone, iconeConta } from "../componentes/Icones";
import { Modal } from "../componentes/Modal";
import { rotuloTipo } from "../formato";
import { useMe } from "../sessao";
import type { Conta } from "../tipos";

export function Contas() {
  const { permissoes } = useMe();
  const [lista, setLista] = useState<Conta[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [form, setForm] = useState<Conta | "nova" | null>(null);
  const [inativar, setInativar] = useState<Conta | null>(null);

  const carregar = useCallback(async () => {
    setLista((await api<{ contas: Conta[] }>("/contas")).contas);
  }, []);
  useEffect(() => {
    carregar().catch((e) => setErro(e instanceof ApiErro ? e.message : "Falha ao carregar"));
  }, [carregar]);

  const ordem: Conta["tipo"][] = ["carteira", "banco", "cartao"];
  const grupos = ordem
    .map((tipo) => ({ tipo, itens: lista.filter((c) => c.tipo === tipo) }))
    .filter((g) => g.itens.length);
  const total = lista.reduce((s, c) => s + c.saldo, 0);

  return (
    <>
      <div className="pagina-cab">
        <h1>Contas</h1>
        {permissoes.contas.cadastrar ? (
          <button type="button" className="btn" onClick={() => setForm("nova")}>
            Nova conta
          </button>
        ) : null}
      </div>
      {erro ? <p className="erro">{erro}</p> : null}
      {form ? (
        <FormConta
          inicial={form === "nova" ? null : form}
          aoCancelar={() => setForm(null)}
          aoSalvo={async () => {
            setForm(null);
            await carregar();
          }}
        />
      ) : null}
      {lista.length === 0 ? (
        <p className="vazio">Nenhuma conta ainda. Crie uma carteira para começar a lançar</p>
      ) : (
        <>
          <p className="total-conta">
            <span>Saldo nas contas</span>
            <span className={`valor ${total < 0 ? "despesa" : "receita"}`}>{formatBRL(total)}</span>
          </p>
          {grupos.map((g) => (
            <section key={g.tipo} className="grupo-dia">
              <h2>{rotuloTipo(g.tipo)}</h2>
              <ul className="lista">
                {g.itens.map((c) => (
                  <li key={c.id} className={`caderno ${c.saldo < 0 ? "despesa" : "receita"}`}>
                    <span className={`marca-tipo ${c.saldo < 0 ? "despesa" : "receita"}`} aria-hidden="true">
                      <Icone nome={iconeConta(c.tipo)} />
                    </span>
                    <strong>{c.nome}</strong>
                    <span className={`valor ${c.saldo < 0 ? "despesa" : "receita"}`}>
                      {formatBRL(c.saldo)}
                    </span>
                    <span className="meta">{rotuloTipo(c.tipo)}</span>
                    <div className="acoes">
                      {permissoes.contas.alterar ? (
                        <button type="button" className="btn-sec" onClick={() => setForm(c)}>
                          Editar
                        </button>
                      ) : null}
                      {permissoes.contas.excluir ? (
                        <button type="button" className="btn-perigo" onClick={() => setInativar(c)}>
                          Inativar
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
      {inativar ? (
        <DialogoSenha
          titulo={`Inativar ${inativar.nome}`}
          aoFechar={() => setInativar(null)}
          aoConfirmar={async (senha) => {
            await api(`/contas/${inativar.id}/inativar`, { method: "POST", body: { senha } });
            setInativar(null);
            await carregar();
          }}
        />
      ) : null}
    </>
  );
}

function FormConta({
  inicial,
  aoCancelar,
  aoSalvo,
}: {
  inicial: Conta | null;
  aoCancelar: () => void;
  aoSalvo: () => Promise<void>;
}) {
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [tipo, setTipo] = useState<Conta["tipo"]>(inicial?.tipo ?? "carteira");
  const [saldoTxt, setSaldoTxt] = useState(
    inicial ? (inicial.saldoInicial / 100).toFixed(2).replace(".", ",") : "0,00",
  );
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const saldoInicial = parseBRLToCents(saldoTxt);
    if (saldoInicial === null) {
      setErro("Informe o saldo inicial usando vírgula, como 0,00 ou 150,50");
      return;
    }
    setErro(null);
    setEnviando(true);
    try {
      if (inicial) {
        await api(`/contas/${inicial.id}`, { method: "PATCH", body: { nome, tipo, saldoInicial } });
      } else {
        await api("/contas", { method: "POST", body: { nome, tipo, saldoInicial } });
      }
      await aoSalvo();
    } catch (err) {
      setErro(err instanceof ApiErro ? err.message : "Não foi possível salvar");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal
      titulo={inicial ? "Editar conta" : "Nova conta"}
      icone={inicial ? "editar" : "mais"}
      enviando={enviando}
      erro={erro}
      aoEnviar={(e) => void enviar(e)}
      aoFechar={aoCancelar}
    >
      <label>
        Nome
        <input value={nome} onChange={(e) => setNome(e.target.value)} required maxLength={80} />
      </label>
      <label>
        Tipo
        <select value={tipo} onChange={(e) => setTipo(e.target.value as Conta["tipo"])}>
          <option value="carteira">Carteira</option>
          <option value="banco">Banco</option>
          <option value="cartao">Cartão</option>
        </select>
      </label>
      <label>
        Saldo inicial
        <input inputMode="decimal" value={saldoTxt} onChange={(e) => setSaldoTxt(e.target.value)} />
      </label>
    </Modal>
  );
}
