import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { api, ApiErro } from "../api";
import { Modal } from "../componentes/Modal";
import { DialogoSenha } from "../componentes/DialogoSenha";
import { rotuloTipo } from "../formato";
import { useMe } from "../sessao";
import type { Categoria } from "../tipos";

export function Categorias() {
  const { permissoes } = useMe();
  const [arvore, setArvore] = useState<Categoria[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [nova, setNova] = useState<{ pai: Categoria | null } | null>(null);
  const [editando, setEditando] = useState<Categoria | null>(null);
  const [inativar, setInativar] = useState<Categoria | null>(null);

  const carregar = useCallback(async () => {
    setArvore((await api<{ arvore: Categoria[] }>("/categorias")).arvore);
  }, []);
  useEffect(() => {
    carregar().catch((e) => setErro(e instanceof ApiErro ? e.message : "Falha ao carregar"));
  }, [carregar]);

  return (
    <>
      <div className="pagina-cab">
        <h1>Categorias</h1>
        {permissoes.categorias.cadastrar ? (
          <button type="button" className="btn" onClick={() => setNova({ pai: null })}>
            Nova categoria raiz
          </button>
        ) : null}
      </div>
      {erro ? <p className="erro">{erro}</p> : null}
      {nova ? (
        <FormCategoria
          pai={nova.pai}
          inicial={null}
          aoCancelar={() => setNova(null)}
          aoSalvo={async () => {
            setNova(null);
            await carregar();
          }}
        />
      ) : null}
      {editando ? (
        <FormCategoria
          pai={null}
          inicial={editando}
          aoCancelar={() => setEditando(null)}
          aoSalvo={async () => {
            setEditando(null);
            await carregar();
          }}
        />
      ) : null}
      <ListaNos
        nos={arvore}
        nivel={0}
        podeCadastrar={permissoes.categorias.cadastrar}
        podeAlterar={permissoes.categorias.alterar}
        podeExcluir={permissoes.categorias.excluir}
        onFilha={(c) => setNova({ pai: c })}
        onEditar={setEditando}
        onInativar={setInativar}
      />
      {inativar ? (
        <DialogoSenha
          titulo={`Inativar ${inativar.nome}`}
          aoFechar={() => setInativar(null)}
          aoConfirmar={async (senha) => {
            await api(`/categorias/${inativar.id}/inativar`, { method: "POST", body: { senha } });
            setInativar(null);
            await carregar();
          }}
        />
      ) : null}
    </>
  );
}

function ListaNos({
  nos,
  nivel,
  podeCadastrar,
  podeAlterar,
  podeExcluir,
  onFilha,
  onEditar,
  onInativar,
}: {
  nos: Categoria[];
  nivel: number;
  podeCadastrar: boolean;
  podeAlterar: boolean;
  podeExcluir: boolean;
  onFilha: (c: Categoria) => void;
  onEditar: (c: Categoria) => void;
  onInativar: (c: Categoria) => void;
}) {
  return (
    <ul className="arvore">
      {nos.map((c) => (
        <li key={c.id} className="no" style={{ "--n": nivel } as CSSProperties}>
          <div className="cab">
            <span className={`ponto ${c.tipo}`} aria-hidden="true" />
            <strong>{c.nome}</strong>
            <span className="meta">
              {rotuloTipo(c.tipo)} · {rotuloTipo(c.natureza)}
            </span>
            <span className="acoes">
              {podeCadastrar && c.nivel < 3 ? (
                <button type="button" className="btn-sec" onClick={() => onFilha(c)}>
                  Subcategoria
                </button>
              ) : null}
              {podeAlterar ? (
                <button type="button" className="btn-sec" onClick={() => onEditar(c)}>
                  Editar
                </button>
              ) : null}
              {podeExcluir ? (
                <button type="button" className="btn-perigo" onClick={() => onInativar(c)}>
                  Inativar
                </button>
              ) : null}
            </span>
          </div>
          {c.filhas.length ? (
            <ListaNos
              nos={c.filhas}
              nivel={nivel + 1}
              podeCadastrar={podeCadastrar}
              podeAlterar={podeAlterar}
              podeExcluir={podeExcluir}
              onFilha={onFilha}
              onEditar={onEditar}
              onInativar={onInativar}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function FormCategoria({
  pai,
  inicial,
  aoCancelar,
  aoSalvo,
}: {
  pai: Categoria | null;
  inicial: Categoria | null;
  aoCancelar: () => void;
  aoSalvo: () => Promise<void>;
}) {
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [tipo, setTipo] = useState<"receita" | "despesa">(inicial?.tipo ?? pai?.tipo ?? "despesa");
  const [natureza, setNatureza] = useState<"fixa" | "variavel">(
    inicial?.natureza ?? pai?.natureza ?? "variavel",
  );
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    try {
      if (inicial) {
        await api(`/categorias/${inicial.id}`, { method: "PATCH", body: { nome, natureza } });
      } else {
        await api("/categorias", {
          method: "POST",
          body: { nome, natureza, ...(pai ? { paiId: pai.id } : { tipo }) },
        });
      }
      await aoSalvo();
    } catch (err) {
      setErro(err instanceof ApiErro ? err.message : "Não foi possível salvar");
    }
  }

  return (
    <Modal
      titulo={inicial ? "Editar categoria" : pai ? "Nova subcategoria" : "Nova categoria"}
      icone={inicial ? "editar" : "mais"}
      erro={erro}
      aoEnviar={(e) => void enviar(e)}
      aoFechar={aoCancelar}
    >
      {pai && !inicial ? <p className="meta">Filha de {pai.nome}</p> : null}
      <label>
        Nome
        <input value={nome} onChange={(e) => setNome(e.target.value)} required maxLength={80} />
      </label>
      {!inicial && !pai ? (
        <label>
          Tipo
          <select value={tipo} onChange={(e) => setTipo(e.target.value as "receita" | "despesa")}>
            <option value="despesa">Despesa</option>
            <option value="receita">Receita</option>
          </select>
        </label>
      ) : null}
      <label>
        Natureza
        <select value={natureza} onChange={(e) => setNatureza(e.target.value as "fixa" | "variavel")}>
          <option value="variavel">Variável</option>
          <option value="fixa">Fixa</option>
        </select>
      </label>
    </Modal>
  );
}
