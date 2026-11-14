import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiErro } from "../api";
import { MarcaFinan } from "../componentes/MarcaFinan";

export function Convite() {
  const { token = "" } = useParams();
  const [info, setInfo] = useState<{ email: string; nomeTitular: string } | null>(null);
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    api<{ email: string; nomeTitular: string }>(`/convites/${token}`)
      .then(setInfo)
      .catch((e) => setErro(e instanceof ApiErro ? e.message : "Convite inválido"));
  }, [token]);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    try {
      await api(`/convites/${token}/aceitar`, { method: "POST", body: { senha } });
      setOk(true);
    } catch (err) {
      setErro(err instanceof ApiErro ? err.message : "Não foi possível cadastrar");
    }
  }

  return (
    <div className="login">
      <form className="caixa" onSubmit={(e) => void enviar(e)}>
        <h1 className="marca">
          <MarcaFinan />
            <span className="marca-nome">finan</span>
        </h1>
        <h2>Convite</h2>
        {ok ? (
          <p>
            Conta criada. <Link to="/login">Entrar</Link>
          </p>
        ) : (
          <>
            {info ? (
              <p className="meta">
                {info.email} · {info.nomeTitular}
              </p>
            ) : null}
            <label>
              Escolha uma senha
              <input
                type="password"
                autoComplete="new-password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                minLength={10}
                required
              />
            </label>
            {erro ? <p className="erro">{erro}</p> : null}
            <button type="submit" className="btn" disabled={!info}>
              Criar conta
            </button>
          </>
        )}
      </form>
    </div>
  );
}

export function Redefinicao() {
  const { token = "" } = useParams();
  const [info, setInfo] = useState<{ email: string } | null>(null);
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    api<{ email: string }>(`/redefinicao/${token}`)
      .then(setInfo)
      .catch((e) => setErro(e instanceof ApiErro ? e.message : "Link inválido"));
  }, [token]);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    try {
      await api(`/redefinicao/${token}`, { method: "POST", body: { senha } });
      setOk(true);
    } catch (err) {
      setErro(err instanceof ApiErro ? err.message : "Não foi possível redefinir");
    }
  }

  return (
    <div className="login">
      <form className="caixa" onSubmit={(e) => void enviar(e)}>
        <h1 className="marca">
          <MarcaFinan />
            <span className="marca-nome">finan</span>
        </h1>
        <h2>Nova senha</h2>
        {ok ? (
          <p>
            Senha definida. <Link to="/login">Entrar</Link>
          </p>
        ) : (
          <>
            {info ? <p className="meta">{info.email}</p> : null}
            <label>
              Nova senha
              <input
                type="password"
                autoComplete="new-password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                minLength={10}
                required
              />
            </label>
            {erro ? <p className="erro">{erro}</p> : null}
            <button type="submit" className="btn" disabled={!info}>
              Salvar senha
            </button>
          </>
        )}
      </form>
    </div>
  );
}
