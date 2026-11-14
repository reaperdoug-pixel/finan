import { useEffect, useId, useRef, type FormEvent, type ReactNode } from "react";
import { Icone, type NomeIcone } from "./Icones";

/** Janela de cadastro: cabeçalho com ícone, corpo com campos e rodapé com Cancelar / Salvar. */
export function Modal({
  titulo,
  icone = "mais",
  dica,
  erro,
  rotuloSalvar = "Salvar",
  enviando = false,
  aoEnviar,
  aoFechar,
  children,
}: {
  titulo: string;
  icone?: NomeIcone;
  dica?: string;
  erro?: string | null;
  rotuloSalvar?: string;
  enviando?: boolean;
  aoEnviar: (e: FormEvent) => void;
  aoFechar: () => void;
  children: ReactNode;
}) {
  const tituloId = useId();
  const caixa = useRef<HTMLFormElement>(null);
  const fechar = useRef(aoFechar);
  fechar.current = aoFechar;

  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    caixa.current?.querySelector<HTMLElement>("input:not([type=checkbox]), select, textarea")?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") fechar.current();
    };
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("keydown", tecla);
      anterior?.focus?.();
    };
  }, []);

  return (
    <div
      className="dialogo"
      role="dialog"
      aria-modal="true"
      aria-labelledby={tituloId}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <form className="caixa modal" ref={caixa} onSubmit={aoEnviar}>
        <header className="modal-cab">
          <span className="modal-icone" aria-hidden="true">
            <Icone nome={icone} />
          </span>
          <h2 id={tituloId}>{titulo}</h2>
          <button type="button" className="modal-x" aria-label="Fechar" onClick={aoFechar}>
            <Icone nome="fechar" />
          </button>
        </header>
        <div className="modal-corpo">
          {children}
          {dica ? (
            <p className="modal-dica">
              <Icone nome="info" />
              <span>{dica}</span>
            </p>
          ) : null}
          {erro ? <p className="erro">{erro}</p> : null}
        </div>
        <footer className="modal-pe">
          <button type="button" className="modal-cancelar" onClick={aoFechar}>
            Cancelar
          </button>
          <button type="submit" className="btn modal-salvar" disabled={enviando}>
            {rotuloSalvar}
          </button>
        </footer>
      </form>
    </div>
  );
}
