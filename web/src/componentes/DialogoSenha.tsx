import { useState, type FormEvent } from "react";
import { ApiErro } from "../api";
import { Modal } from "./Modal";

export function DialogoSenha({
  titulo,
  aoConfirmar,
  aoFechar,
}: {
  titulo: string;
  aoConfirmar: (senha: string) => Promise<void>;
  aoFechar: () => void;
}) {
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await aoConfirmar(senha);
    } catch (err) {
      setErro(err instanceof ApiErro ? err.message : "Não foi possível confirmar");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal
      titulo={titulo}
      icone="cadeado"
      rotuloSalvar="Confirmar"
      enviando={enviando}
      erro={erro}
      aoEnviar={(e) => void enviar(e)}
      aoFechar={aoFechar}
    >
      <p className="meta">Confirme com a sua senha. A operação fica no log.</p>
      <label>
        Senha
        <input
          type="password"
          name="senha-confirmacao"
          autoComplete="current-password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          required
        />
      </label>
    </Modal>
  );
}
