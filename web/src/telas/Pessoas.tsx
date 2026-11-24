import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiErro } from "../api";
import { DialogoSenha } from "../componentes/DialogoSenha";
import { LinkConvite } from "../componentes/LinkConvite";
import { Modal } from "../componentes/Modal";
import type { Acao, Modulo, Permissoes } from "../tipos";

const MODULOS: { id: Modulo; nome: string }[] = [
  { id: "lancamentos", nome: "Lançamentos" },
  { id: "categorias", nome: "Categorias" },
  { id: "contas", nome: "Contas" },
  { id: "contatos", nome: "Contatos" },
  { id: "log", nome: "Log" },
];
const ACOES: { id: Acao; nome: string }[] = [
  { id: "ver", nome: "Ver" },
  { id: "cadastrar", nome: "Cadastrar" },
  { id: "alterar", nome: "Alterar" },
  { id: "excluir", nome: "Inativar" },
];

interface Vinculado {
  id: string;
  email: string;
  ativo: boolean;
  permissoes: Permissoes;
}
interface ConvitePendente {
  id: string;
  email: string;
  expiraEm: string;
}

function permissoesVazias(): Permissoes {
  const p = {} as Permissoes;
  for (const m of [
    "lancamentos",
    "categorias",
    "contas",
    "contatos",
    "orcamentos",
    "anexos",
    "log",
  ] as Modulo[]) {
    p[m] = { ver: false, cadastrar: false, alterar: false, excluir: false };
  }
  return p;
}

export function Pessoas() {
  const [usuarios, setUsuarios] = useState<Vinculado[]>([]);
  const [convites, setConvites] = useState<ConvitePendente[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [editando, setEditando] = useState<Vinculado | null>(null);
  const [convidando, setConvidando] = useState(false);
  const [alvo, setAlvo] = useState<{ id: string; acao: "inativar" | "reativar"; email: string } | null>(
    null,
  );

  const carregar = useCallback(async () => {
    const r = await api<{ usuarios: Vinculado[]; convitesPendentes: ConvitePendente[] }>("/usuarios");
    setUsuarios(r.usuarios);
    setConvites(r.convitesPendentes);
  }, []);
  useEffect(() => {
    carregar().catch((e) => setErro(e instanceof ApiErro ? e.message : "Falha ao carregar"));
  }, [carregar]);

  return (
    <>
      <div className="pagina-cab">
        <h1>Pessoas</h1>
        <button type="button" className="btn" onClick={() => setConvidando(true)}>
          Novo convite
        </button>
      </div>
      {erro ? <p className="erro">{erro}</p> : null}
      {link ? <LinkConvite link={link} /> : null}
      {convidando ? (
        <ConviteForm
          aoFechar={() => setConvidando(false)}
          aoCriado={(l) => {
            setLink(l);
            setConvidando(false);
            void carregar();
          }}
        />
      ) : null}
      <h2>Vinculados</h2>
      {usuarios.length === 0 ? (
        <p className="vazio">Ninguém vinculado ainda</p>
      ) : (
        <ul className="lista">
          {usuarios.map((u) => (
            <li key={u.id}>
              <strong>{u.email}</strong>
              <span className="meta">{u.ativo ? "Ativo" : "Inativo"}</span>
              <div className="acoes">
                {u.ativo ? (
                  <>
                    <button type="button" className="btn-sec" onClick={() => setEditando(u)}>
                      Permissões
                    </button>
                    <button
                      type="button"
                      className="btn-perigo"
                      onClick={() => setAlvo({ id: u.id, acao: "inativar", email: u.email })}
                    >
                      Inativar
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setAlvo({ id: u.id, acao: "reativar", email: u.email })}
                  >
                    Reativar
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {convites.length ? (
        <>
          <h2>Convites pendentes</h2>
          <ul className="lista">
            {convites.map((c) => (
              <li key={c.id}>
                {c.email}
                <span className="meta">expira em {new Date(c.expiraEm).toLocaleString("pt-BR")}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {editando ? (
        <FormPermissoes
          alvo={editando}
          aoFechar={() => setEditando(null)}
          aoSalvo={async () => {
            setEditando(null);
            await carregar();
          }}
        />
      ) : null}
      {alvo ? (
        <DialogoSenha
          titulo={`${alvo.acao === "inativar" ? "Inativar" : "Reativar"} ${alvo.email}`}
          aoFechar={() => setAlvo(null)}
          aoConfirmar={async (senha) => {
            await api(`/usuarios/${alvo.id}/${alvo.acao}`, { method: "POST", body: { senha } });
            setAlvo(null);
            await carregar();
          }}
        />
      ) : null}
    </>
  );
}

function ConviteForm({
  aoCriado,
  aoFechar,
}: {
  aoCriado: (link: string) => void;
  aoFechar: () => void;
}) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [perms, setPerms] = useState(permissoesVazias);
  const [erro, setErro] = useState<string | null>(null);

  function marcar(m: Modulo, a: Acao, v: boolean) {
    setPerms((p) => {
      const n = { ...p, [m]: { ...p[m], [a]: v } };
      if ((a === "alterar" || a === "excluir") && v) n[m].ver = true;
      if (a === "ver" && !v) n[m] = { ver: false, cadastrar: false, alterar: false, excluir: false };
      return n;
    });
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    try {
      const r = await api<{ link: string }>("/usuarios/convites", {
        method: "POST",
        body: { email, senha, permissoes: perms },
      });
      setEmail("");
      setSenha("");
      aoCriado(r.link);
    } catch (err) {
      setErro(err instanceof ApiErro ? err.message : "Não foi possível convidar");
    }
  }

  return (
    <Modal
      titulo="Convidar vinculado"
      icone="mais"
      rotuloSalvar="Gerar convite"
      dica="O link aparece uma vez; quem recebe define a senha dele."
      erro={erro}
      aoEnviar={(e) => void enviar(e)}
      aoFechar={aoFechar}
    >
      <label>
        E-mail
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        Sua senha
        <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
      </label>
      <GradePermissoes valor={perms} onChange={marcar} />
    </Modal>
  );
}

function FormPermissoes({
  alvo,
  aoFechar,
  aoSalvo,
}: {
  alvo: Vinculado;
  aoFechar: () => void;
  aoSalvo: () => Promise<void>;
}) {
  const [perms, setPerms] = useState(alvo.permissoes);
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  function marcar(m: Modulo, a: Acao, v: boolean) {
    setPerms((p) => {
      const n = { ...p, [m]: { ...p[m], [a]: v } };
      if ((a === "alterar" || a === "excluir") && v) n[m].ver = true;
      if (a === "ver" && !v) n[m] = { ver: false, cadastrar: false, alterar: false, excluir: false };
      return n;
    });
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    try {
      await api(`/usuarios/${alvo.id}/permissoes`, {
        method: "PUT",
        body: { permissoes: perms, senha },
      });
      await aoSalvo();
    } catch (err) {
      setErro(err instanceof ApiErro ? err.message : "Não foi possível salvar");
    }
  }

  return (
    <Modal
      titulo="Permissões"
      icone="cadeado"
      erro={erro}
      aoEnviar={(e) => void enviar(e)}
      aoFechar={aoFechar}
    >
      <p className="meta">{alvo.email}</p>
      <GradePermissoes valor={perms} onChange={marcar} />
      <label>
        Sua senha
        <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
      </label>
    </Modal>
  );
}

function GradePermissoes({
  valor,
  onChange,
}: {
  valor: Permissoes;
  onChange: (m: Modulo, a: Acao, v: boolean) => void;
}) {
  return (
    <div className="grade-perm">
      {MODULOS.map((m) => (
        <div key={m.id} className="linha-perm">
          <span className="mod">{m.nome}</span>
          {ACOES.filter((a) => (m.id === "log" ? a.id === "ver" : true)).map((a) => (
            <label key={a.id} className="checar">
              <input
                type="checkbox"
                checked={valor[m.id][a.id]}
                onChange={(e) => onChange(m.id, a.id, e.target.checked)}
              />
              {a.nome}
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}
