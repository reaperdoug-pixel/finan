import { useState, type FormEvent } from "react";
import { api, ApiErro } from "../api";
import { Modal } from "./Modal";

const SENHA_MIN = 10;

/** Troca da própria senha. A API confere a senha atual e encerra as outras sessões. */
export function TrocarSenha({ aoFechar, aoTrocada }: { aoFechar: () => void; aoTrocada: () => void }) {
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [repetir, setRepetir] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (nova.length < SENHA_MIN) {
      setErro(`A nova senha deve ter pelo menos ${SENHA_MIN} caracteres`);
      return;
    }
    if (nova !== repetir) {
      setErro("A confirmação não confere com a nova senha");
      return;
    }
    setErro(null);
    setEnviando(true);
    try {
      await api("/auth/senha", { method: "POST", body: { senha: atual, novaSenha: nova } });
      aoTrocada();
    } catch (err) {
      setErro(err instanceof ApiErro ? err.message : "Não foi possível trocar a senha");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal
      titulo="Alterar senha"
      icone="cadeado"
      rotuloSalvar="Alterar senha"
      dica="Ao trocar, os outros aparelhos em que você está logado são desconectados."
      enviando={enviando}
      erro={erro}
      aoEnviar={(e) => void enviar(e)}
      aoFechar={aoFechar}
    >
      <label>
        Senha atual
        <input
          type="password"
          name="senha-atual"
          autoComplete="current-password"
          value={atual}
          onChange={(e) => setAtual(e.target.value)}
          required
        />
      </label>
      <label>
        Nova senha
        <input
          type="password"
          name="senha-nova"
          autoComplete="new-password"
          value={nova}
          onChange={(e) => setNova(e.target.value)}
          minLength={SENHA_MIN}
          required
        />
      </label>
      <label>
        Repita a nova senha
        <input
          type="password"
          name="senha-repetida"
          autoComplete="new-password"
          value={repetir}
          onChange={(e) => setRepetir(e.target.value)}
          required
        />
      </label>
    </Modal>
  );
}
