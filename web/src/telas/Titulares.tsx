import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { api, ApiErro } from "../api";
import { Modal } from "../componentes/Modal";
import { DialogoSenha } from "../componentes/DialogoSenha";
import { useMe } from "../sessao";

interface Titular {
  id: string;
  nome: string;
  ativo: boolean;
  totalUsuarios: number;
}
interface ConviteAdmin {
  id: string;
  email: string;
  nomeTitular: string | null;
}

export function Titulares() {
  const { usuario } = useMe();
  const [lista, setLista] = useState<Titular[]>([]);
  const [convites, setConvites] = useState<ConviteAdmin[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [convidando, setConvidando] = useState(false);
  const [alvo, setAlvo] = useState<{ id: string; acao: "inativar" | "reativar"; nome: string } | null>(
    null,
  );

  const carregar = useCallback(async () => {
    const [t, c] = await Promise.all([
      api<{ titulares: Titular[] }>("/admin/titulares"),
      api<{ convites: ConviteAdmin[] }>("/admin/convites"),
    ]);
    setLista(t.titulares);
    setConvites(c.convites);
  }, []);
  useEffect(() => {
    if (usuario.papel !== "admin") return;
    carregar().catch((e) => setErro(e instanceof ApiErro ? e.message : "Falha ao carregar"));
  }, [carregar, usuario.papel]);

  if (usuario.papel !== "admin") return <Navigate to="/lancamentos" replace />;

  return (
    <>
      <div className="pagina-cab">
        <h1>Titulares</h1>
        <button type="button" className="btn" onClick={() => setConvidando(true)}>
          Novo convite
        </button>
      </div>
      {erro ? <p className="erro">{erro}</p> : null}
      {link ? (
        <p className="aviso">
          Entregue este link uma vez: <code>{link}</code>
        </p>
      ) : null}
      {convidando ? (
        <ConviteTitular
          aoFechar={() => setConvidando(false)}
          aoCriado={(l) => {
            setLink(l);
            setConvidando(false);
            void carregar();
          }}
        />
      ) : null}
      <h2>Espaços</h2>
      <ul className="lista">
        {lista.map((t) => (
          <li key={t.id}>
            <strong>{t.nome}</strong>
            <span className="meta">
              {t.ativo ? "Ativo" : "Inativo"} · {t.totalUsuarios} usuário(s)
            </span>
            <div className="acoes">
              {t.ativo ? (
                <button
                  type="button"
                  className="btn-perigo"
                  onClick={() => setAlvo({ id: t.id, acao: "inativar", nome: t.nome })}
                >
                  Inativar
                </button>
              ) : (
                <button
                  type="button"
                  className="btn"
                  onClick={() => setAlvo({ id: t.id, acao: "reativar", nome: t.nome })}
                >
                  Reativar
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {convites.length ? (
        <>
          <h2>Convites de titular</h2>
          <ul className="lista">
            {convites.map((c) => (
              <li key={c.id}>
                {c.email}
                <span className="meta">{c.nomeTitular}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {alvo ? (
        <DialogoSenha
          titulo={`${alvo.acao === "inativar" ? "Inativar" : "Reativar"} ${alvo.nome}`}
          aoFechar={() => setAlvo(null)}
          aoConfirmar={async (senha) => {
            await api(`/admin/titulares/${alvo.id}/${alvo.acao}`, { method: "POST", body: { senha } });
            setAlvo(null);
            await carregar();
          }}
        />
      ) : null}
    </>
  );
}

function ConviteTitular({
  aoCriado,
  aoFechar,
}: {
  aoCriado: (link: string) => void;
  aoFechar: () => void;
}) {
  const [email, setEmail] = useState("");
  const [nomeTitular, setNome] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    try {
      const r = await api<{ link: string }>("/admin/convites", {
        method: "POST",
        body: { email, nomeTitular },
      });
      setEmail("");
      setNome("");
      aoCriado(r.link);
    } catch (err) {
      setErro(err instanceof ApiErro ? err.message : "Não foi possível convidar");
    }
  }

  return (
    <Modal
      titulo="Convidar titular"
      icone="mais"
      rotuloSalvar="Gerar convite"
      dica="O link vale 7 dias e só aparece agora."
      erro={erro}
      aoEnviar={(e) => void enviar(e)}
      aoFechar={aoFechar}
    >
      <label>
        E-mail
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        Nome do espaço
        <input value={nomeTitular} onChange={(e) => setNome(e.target.value)} required maxLength={120} />
      </label>
    </Modal>
  );
}
