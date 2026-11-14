import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useMe, useSessao } from "../sessao";
import { Icone, type NomeIcone } from "./Icones";
import { MarcaFinan } from "./MarcaFinan";
import { TrocarSenha } from "./TrocarSenha";

export function Layout() {
  const { usuario, permissoes } = useMe();
  const { sair } = useSessao();
  const nav = useNavigate();
  const [trocando, setTrocando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 6000);
    return () => clearTimeout(t);
  }, [aviso]);

  async function encerrar() {
    await sair();
    nav("/login");
  }

  const itens: Array<{ to: string; nome: string; icone: NomeIcone }> = [];
  if (permissoes.lancamentos.ver) {
    itens.push({ to: "/painel", nome: "Painel", icone: "painel" });
    itens.push({ to: "/lancamentos", nome: "Lançamentos", icone: "lancamentos" });
  }
  if (permissoes.categorias.ver) {
    itens.push({ to: "/categorias", nome: "Categorias", icone: "categorias" });
  }
  if (permissoes.contas.ver) {
    itens.push({ to: "/contas", nome: "Contas", icone: "contas" });
  }
  itens.push({ to: "/inativos", nome: "Inativos", icone: "inativos" });
  if (usuario.papel !== "vinculado") {
    itens.push({ to: "/pessoas", nome: "Pessoas", icone: "pessoas" });
  }
  if (permissoes.log.ver) itens.push({ to: "/log", nome: "Log", icone: "log" });
  if (usuario.papel === "admin") {
    itens.push({ to: "/titulares", nome: "Titulares", icone: "titulares" });
  }

  return (
    <div className="app">
      <header className="cabeca">
        <p className="marca">
          <NavLink to="/painel">
            <MarcaFinan />
            <span className="marca-nome">finan</span>
          </NavLink>
        </p>
        <p className="quem">
          <span>{usuario.email}</span>
          <button type="button" className="sair" onClick={() => setTrocando(true)}>
            Senha
          </button>
          <button type="button" className="sair" onClick={() => void encerrar()}>
            Sair
          </button>
        </p>
      </header>
      <nav className="nav-lado" aria-label="Seções">
        <p className="marca">
          <NavLink to="/painel">
            <MarcaFinan />
            <span className="marca-nome">finan</span>
          </NavLink>
        </p>
        <p className="nav-grupo">Workspace</p>
        {itens.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => (isActive ? "ativo" : undefined)}
          >
            <Icone nome={item.icone} />
            {item.nome}
          </NavLink>
        ))}
        <div className="nav-usuario">
          <span className="nav-avatar" aria-hidden="true">
            {usuario.email.charAt(0).toUpperCase()}
          </span>
          <span className="nav-email" title={usuario.email}>
            {usuario.email}
          </span>
          <span className="nav-acoes">
            <button type="button" onClick={() => setTrocando(true)}>
              Alterar senha
            </button>
            <button type="button" onClick={() => void encerrar()}>
              Sair
            </button>
          </span>
        </div>
      </nav>
      <main className="folha">
        <Outlet />
      </main>
      {trocando ? (
        <TrocarSenha
          aoFechar={() => setTrocando(false)}
          aoTrocada={() => {
            setTrocando(false);
            setAviso("Senha alterada. Os outros aparelhos foram desconectados.");
          }}
        />
      ) : null}
      {aviso ? (
        <p className="toast" role="status">
          {aviso}
        </p>
      ) : null}
      <nav className="nav-baixo" aria-label="Seções">
        {itens.slice(0, 5).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => (isActive ? "ativo" : undefined)}
          >
            <Icone nome={item.icone} />
            {item.nome}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
