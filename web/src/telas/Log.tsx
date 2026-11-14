import { useCallback, useEffect, useState } from "react";
import { api, ApiErro } from "../api";
import type { LinhaLog } from "../tipos";

export function Log() {
  const [itens, setItens] = useState<LinhaLog[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async (c?: string | null, acumular = false) => {
    const q = c ? `?limite=50&cursor=${encodeURIComponent(c)}` : "?limite=50";
    const r = await api<{ itens: LinhaLog[]; proximo: string | null }>(`/log${q}`);
    setItens((prev) => (acumular ? [...prev, ...r.itens] : r.itens));
    setCursor(r.proximo);
  }, []);

  useEffect(() => {
    carregar().catch((e) => setErro(e instanceof ApiErro ? e.message : "Falha ao carregar"));
  }, [carregar]);

  return (
    <>
      <div className="pagina-cab">
        <div>
          <h1>Log</h1>
          <p className="meta">Só leitura. Nada daqui se apaga ou se altera</p>
        </div>
      </div>
      {erro ? <p className="erro">{erro}</p> : null}
      {itens.length === 0 ? (
        <p className="vazio">Nenhum registro ainda</p>
      ) : (
        <ul className="lista log">
          {itens.map((l) => (
            <li key={l.id}>
              <strong>{l.acao}</strong>
              <span className="meta">
                <span>{new Date(l.ocorridoEm).toLocaleString("pt-BR")}</span>
                <span>{l.usuario ?? "sistema"}</span>
                {l.entidade ? <span>{l.entidade}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {cursor ? (
        <p>
          <button type="button" className="btn-sec" onClick={() => void carregar(cursor, true)}>
            Mais antigos
          </button>
        </p>
      ) : null}
    </>
  );
}
