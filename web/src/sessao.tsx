import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiErro, definirAoSessaoExpirada, definirCsrf } from "./api";
import type { Me, Permissoes, UsuarioSessao } from "./tipos";

interface SessaoCtx {
  me: Me | null;
  carregando: boolean;
  /** true quando a sessão caiu com um 401 no meio do uso (para avisar na tela de login). */
  expirou: boolean;
  entrar: (email: string, senha: string) => Promise<Me>;
  sair: () => Promise<void>;
  recarregar: () => Promise<void>;
}

const Ctx = createContext<SessaoCtx | null>(null);

export function SessaoProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [expirou, setExpirou] = useState(false);

  // 401 em qualquer chamada protegida: limpa a sessão local. O ExigirLogin leva ao /login.
  useEffect(() => {
    definirAoSessaoExpirada(() => {
      definirCsrf("");
      setMe(null);
      setExpirou(true);
    });
    return () => definirAoSessaoExpirada(null);
  }, []);

  const aplicar = useCallback((dados: Me) => {
    definirCsrf(dados.csrfToken);
    setExpirou(false);
    setMe(dados);
  }, []);

  const recarregar = useCallback(async () => {
    try {
      aplicar(await api<Me>("/auth/me"));
    } catch (e) {
      if (e instanceof ApiErro && e.status === 401) {
        definirCsrf("");
        setMe(null);
      } else throw e;
    }
  }, [aplicar]);

  useEffect(() => {
    recarregar()
      .catch(() => {
        definirCsrf("");
        setMe(null);
      })
      .finally(() => setCarregando(false));
  }, [recarregar]);

  const entrar = useCallback(
    async (email: string, senha: string): Promise<Me> => {
      const r = await api<{ csrfToken: string }>("/auth/login", {
        method: "POST",
        body: { email, senha },
      });
      definirCsrf(r.csrfToken);
      const dados = await api<Me>("/auth/me");
      aplicar(dados);
      return dados;
    },
    [aplicar],
  );

  const sair = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST", body: {} });
    } catch {
      /* sessão já inválida */
    }
    definirCsrf("");
    setExpirou(false);
    setMe(null);
  }, []);

  const valor = useMemo(
    () => ({ me, carregando, expirou, entrar, sair, recarregar }),
    [me, carregando, expirou, entrar, sair, recarregar],
  );
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useSessao(): SessaoCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSessao fora do provider");
  return c;
}

export function useMe(): { usuario: UsuarioSessao; permissoes: Permissoes } {
  const { me } = useSessao();
  if (!me) throw new Error("sem sessão");
  return me;
}
