import { formatBRL } from "@finan/shared";
import { useCallback, useEffect, useState } from "react";
import { api, ApiErro } from "../api";
import { DialogoSenha } from "../componentes/DialogoSenha";
import { formatarData, rotuloTipo } from "../formato";
import { useMe } from "../sessao";
import type { ListaInativos } from "../tipos";

type Alvo = { tipo: "lancamento" | "categoria" | "conta" | "usuario"; id: string; nome: string };

export function Inativos() {
  const { usuario } = useMe();
  const [dados, setDados] = useState<ListaInativos | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<Alvo | null>(null);

  const carregar = useCallback(async () => {
    setDados(await api<ListaInativos>("/inativos"));
  }, []);
  useEffect(() => {
    carregar().catch((e) => setErro(e instanceof ApiErro ? e.message : "Falha ao carregar"));
  }, [carregar]);

  function rota(a: Alvo): string {
    switch (a.tipo) {
      case "lancamento":
        return `/lancamentos/${a.id}/reativar`;
      case "categoria":
        return `/categorias/${a.id}/reativar`;
      case "conta":
        return `/contas/${a.id}/reativar`;
      case "usuario":
        return `/usuarios/${a.id}/reativar`;
      default: {
        const _e: never = a.tipo;
        return _e;
      }
    }
  }

  const vazio =
    dados &&
    dados.lancamentos.length + dados.categorias.length + dados.contas.length + dados.usuarios.length === 0;

  return (
    <>
      <div className="pagina-cab">
        <div>
          <h1>Inativos</h1>
          <p className="meta">O que foi inativado continua no histórico. Reativar pede a sua senha</p>
        </div>
      </div>
      {erro ? <p className="erro">{erro}</p> : null}
      {vazio ? <p className="vazio">Nada inativo no momento</p> : null}
      {dados?.lancamentos.length ? (
        <>
          <h2>Lançamentos</h2>
          <ul className="lista">
            {dados.lancamentos.map((l) => (
              <li key={l.id} className={`caderno ${l.tipo}`}>
                <strong>{l.descricao}</strong>
                <span className={`valor ${l.tipo}`}>{formatBRL(l.valor)}</span>
                <span className="meta">{formatarData(l.data)}</span>
                {l.impedimento ? <p className="aviso">{l.impedimento.mensagem}</p> : null}
                <div className="acoes">
                  <button
                    type="button"
                    className="btn"
                    disabled={Boolean(l.impedimento)}
                    onClick={() => setAlvo({ tipo: "lancamento", id: l.id, nome: l.descricao })}
                  >
                    Reativar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {dados?.categorias.length ? (
        <>
          <h2>Categorias</h2>
          <ul className="lista">
            {dados.categorias.map((c) => (
              <li key={c.id}>
                <strong>{c.nome}</strong>
                {c.impedimento ? <p className="aviso">{c.impedimento.mensagem}</p> : null}
                <div className="acoes">
                  <button
                    type="button"
                    className="btn"
                    disabled={Boolean(c.impedimento)}
                    onClick={() => setAlvo({ tipo: "categoria", id: c.id, nome: c.nome })}
                  >
                    Reativar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {dados?.contas.length ? (
        <>
          <h2>Contas</h2>
          <ul className="lista">
            {dados.contas.map((c) => (
              <li key={c.id}>
                <strong>{c.nome}</strong>
                <span className="meta">{rotuloTipo(c.tipo)}</span>
                <div className="acoes">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setAlvo({ tipo: "conta", id: c.id, nome: c.nome })}
                  >
                    Reativar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {usuario.papel !== "vinculado" && dados?.usuarios.length ? (
        <>
          <h2>Pessoas</h2>
          <ul className="lista">
            {dados.usuarios.map((u) => (
              <li key={u.id}>
                <strong>{u.email}</strong>
                {u.impedimento ? <p className="aviso">{u.impedimento.mensagem}</p> : null}
                <div className="acoes">
                  <button
                    type="button"
                    className="btn"
                    disabled={Boolean(u.impedimento)}
                    onClick={() => setAlvo({ tipo: "usuario", id: u.id, nome: u.email })}
                  >
                    Reativar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {alvo ? (
        <DialogoSenha
          titulo={`Reativar ${alvo.nome}`}
          aoFechar={() => setAlvo(null)}
          aoConfirmar={async (senha) => {
            await api(rota(alvo), { method: "POST", body: { senha } });
            setAlvo(null);
            await carregar();
          }}
        />
      ) : null}
    </>
  );
}
