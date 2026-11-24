import { parseBRLToCents } from "@finan/shared";
import { useState, type FormEvent } from "react";
import { api, ApiErro } from "../api";
import { hojeSP, rotuloTipo } from "../formato";
import type { Categoria, Conta, Contato, Lancamento } from "../tipos";
import { Modal } from "./Modal";

/** Retorna todas as categorias folha ativas da árvore. */
export function folhasDaArvore(nos: Categoria[]): Categoria[] {
  const out: Categoria[] = [];
  for (const n of nos) {
    if (n.filhas.length) out.push(...folhasDaArvore(n.filhas));
    else if (n.ativo && !n.temFilhasAtivas) out.push(n);
  }
  return out;
}

export function FormLancamento({
  inicial,
  categorias,
  contas,
  contatos = [],
  aoCancelar,
  aoSalvo,
}: {
  inicial: Lancamento | null;
  categorias: Categoria[];
  contas: Conta[];
  contatos?: Contato[];
  aoCancelar: () => void;
  aoSalvo: () => Promise<void>;
}) {
  const catInicial = inicial?.categoriaId ?? categorias[0]?.id ?? "";
  const naturezaInicial =
    inicial?.natureza ?? categorias.find((c) => c.id === catInicial)?.natureza ?? "variavel";

  const [descricao, setDescricao] = useState(inicial?.descricao ?? "");
  const [valorTxt, setValorTxt] = useState(
    inicial ? (inicial.valor / 100).toFixed(2).replace(".", ",") : "",
  );
  const [data, setData] = useState(inicial?.data ?? hojeSP());
  const [categoriaId, setCategoriaId] = useState(catInicial);
  const [contaId, setContaId] = useState(inicial?.contaId ?? contas[0]?.id ?? "");
  const [contatoId, setContatoId] = useState(inicial?.contatoId ?? "");
  const [status, setStatus] = useState<"previsto" | "realizado">(inicial?.status ?? "realizado");
  const [natureza, setNatureza] = useState<"fixa" | "variavel">(naturezaInicial);
  const [observacao, setObservacao] = useState(inicial?.observacao ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const tipoCat = categorias.find((c) => c.id === categoriaId)?.tipo ?? "despesa";

  function aoTrocarCategoria(novoId: string) {
    setCategoriaId(novoId);
    const cat = categorias.find((c) => c.id === novoId);
    if (cat) setNatureza(cat.natureza);
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const valor = parseBRLToCents(valorTxt);
    if (valor === null || valor <= 0) {
      setErro("Informe um valor maior que zero usando vírgula, como 25,90");
      return;
    }
    setErro(null);
    setEnviando(true);
    try {
      const corpo = {
        descricao,
        valor,
        data,
        categoriaId,
        contaId,
        contatoId: contatoId || null,
        status,
        natureza,
        observacao,
      };
      if (inicial) await api(`/lancamentos/${inicial.id}`, { method: "PATCH", body: corpo });
      else await api("/lancamentos", { method: "POST", body: corpo });
      await aoSalvo();
    } catch (err) {
      setErro(err instanceof ApiErro ? err.message : "Não foi possível salvar");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal
      titulo={inicial ? "Editar lançamento" : "Novo lançamento"}
      icone={inicial ? "editar" : "mais"}
      dica="Os indicadores, o fôlego de caixa e os gráficos são recalculados em seguida."
      enviando={enviando}
      erro={erro}
      aoEnviar={(e) => void enviar(e)}
      aoFechar={aoCancelar}
    >
      <div className="modal-grade">
        <label className="largo">
          Descrição
          <input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            required
            maxLength={120}
          />
        </label>
        <label className={`campo-valor ${tipoCat}`}>
          Valor
          <input
            inputMode="decimal"
            placeholder="0,00"
            value={valorTxt}
            onChange={(e) => setValorTxt(e.target.value)}
            required
          />
        </label>
        <label>
          Data
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} required />
        </label>
        <label>
          Categoria
          <select
            value={categoriaId}
            onChange={(e) => aoTrocarCategoria(e.target.value)}
            required
          >
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome} ({rotuloTipo(c.tipo)})
              </option>
            ))}
          </select>
        </label>
        <label>
          Conta
          <select value={contaId} onChange={(e) => setContaId(e.target.value)} required>
            {contas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as "previsto" | "realizado")}
          >
            <option value="realizado">Realizado</option>
            <option value="previsto">Previsto</option>
          </select>
        </label>
        <label>
          Natureza
          <select
            value={natureza}
            onChange={(e) => setNatureza(e.target.value as "fixa" | "variavel")}
          >
            <option value="variavel">Variável</option>
            <option value="fixa">Fixa</option>
          </select>
        </label>
        {contatos.length > 0 ? (
          <label className="largo">
            Cliente ou fornecedor (opcional)
            <select value={contatoId} onChange={(e) => setContatoId(e.target.value)}>
              <option value="">Nenhum</option>
              {contatos.map((ct) => (
                <option key={ct.id} value={ct.id}>
                  {ct.nome} ({rotuloTipo(ct.papel)} · {ct.tipo.toUpperCase()})
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="largo">
          Observação (opcional)
          <textarea
            rows={2}
            maxLength={500}
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="Detalhes adicionais, se precisar"
          />
        </label>
      </div>
    </Modal>
  );
}
