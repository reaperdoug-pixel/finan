import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ApiErro } from "../api";
import { rotaInicial } from "../rotas";
import { useSessao } from "../sessao";
import { MarcaFinan } from "../componentes/MarcaFinan";

export function Login() {
  const { me, entrar, carregando } = useSessao();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (!carregando && me) {
    return <Navigate to={rotaInicial(me.permissoes, me.usuario.papel)} replace />;
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const dados = await entrar(email, senha);
      nav(rotaInicial(dados.permissoes, dados.usuario.papel), { replace: true });
    } catch (err) {
      setErro(err instanceof ApiErro ? err.message : "Não foi possível entrar");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="login">
      <form className="caixa" onSubmit={(e) => void enviar(e)}>
        <h1 className="marca">
          <MarcaFinan />
          <span className="marca-nome">finan</span>
        </h1>
        <p className="meta">Controle de receitas, despesas e contas</p>
        <label>
          E-mail
          <input
            type="email"
            name="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Senha
          <input
            type="password"
            name="senha"
            autoComplete="current-password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            required
          />
        </label>
        {erro ? <p className="erro">{erro}</p> : null}
        <button type="submit" className="btn" disabled={enviando || carregando}>
          Entrar
        </button>
      </form>
    </div>
  );
}
