import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { Layout } from "./componentes/Layout";
import { rotaInicial } from "./rotas";
import { useMe, useSessao } from "./sessao";
import { Categorias } from "./telas/Categorias";
import { Contas } from "./telas/Contas";
import { Contatos } from "./telas/Contatos";
import { Inativos } from "./telas/Inativos";
import { Lancamentos } from "./telas/Lancamentos";
import { Log } from "./telas/Log";
import { Login } from "./telas/Login";
import { PainelGeral } from "./telas/Painel";
import { Pessoas } from "./telas/Pessoas";
import { Convite, Redefinicao } from "./telas/Publicas";
import { Titulares } from "./telas/Titulares";

function ExigirLogin() {
  const { me, carregando } = useSessao();
  if (carregando) return <p className="vazio">Carregando…</p>;
  if (!me) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function Inicio() {
  const { usuario, permissoes } = useMe();
  return <Navigate to={rotaInicial(permissoes, usuario.papel)} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/convite/:token" element={<Convite />} />
      <Route path="/redefinicao/:token" element={<Redefinicao />} />
      <Route element={<ExigirLogin />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Inicio />} />
          <Route path="/painel" element={<PainelGeral />} />
          <Route path="/lancamentos" element={<Lancamentos />} />
          <Route path="/categorias" element={<Categorias />} />
          <Route path="/contas" element={<Contas />} />
          <Route path="/contatos" element={<Contatos />} />
          <Route path="/inativos" element={<Inativos />} />
          <Route path="/pessoas" element={<Pessoas />} />
          <Route path="/log" element={<Log />} />
          <Route path="/titulares" element={<Titulares />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
