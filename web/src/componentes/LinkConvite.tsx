import { useEffect, useState } from "react";
import { Icone } from "./Icones";

/** Exibe link único de convite com botão para copiar para a área de transferência. */
export function LinkConvite({ link }: { link: string }) {
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    setCopiado(false);
  }, [link]);

  useEffect(() => {
    if (!copiado) return;
    const t = setTimeout(() => setCopiado(false), 3000);
    return () => clearTimeout(t);
  }, [copiado]);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
    } catch {
      /* fallback: o usuário ainda pode selecionar o texto em <code> */
    }
  }

  return (
    <div className="aviso aviso-link" role="status">
      <div>
        <span>Entregue este link uma vez: </span>
        <code>{link}</code>
      </div>
      <button type="button" className="btn-sec btn-copiar" onClick={() => void copiar()}>
        <Icone nome={copiado ? "check" : "copiar"} />
        {copiado ? "Copiado" : "Copiar link"}
      </button>
    </div>
  );
}
