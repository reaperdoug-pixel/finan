import { formatBRL } from "@finan/shared";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiErro } from "../api";
import { folhasDaArvore, FormLancamento } from "../componentes/FormLancamento";
import {
  Delta,
  GraficoCategorias,
  GraficoMovimentoContas,
  GraficoRoscaNatureza,
  GraficoSerieMensal,
} from "../componentes/Graficos";
import { Icone, iconeConta } from "../componentes/Icones";
import { deslocarMes, formatarMes, hojeSP } from "../formato";
import { gerarAlertas, mesPorExtenso } from "../painel-alertas";
import { calcularFolego, destaqueDeCategorias } from "../painel-insights";
import { podeLancar } from "../rotas";
import { useMe } from "../sessao";
import type { Categoria, Conta, Contato, Painel as DadosPainel } from "../tipos";

/** Mais que isso deixa de ser leitura de relance. Os mais graves vêm primeiro. */
const MAX_AVISOS = 4;

export function PainelGeral() {
  const { permissoes } = useMe();
  const [mes, setMes] = useState(hojeSP().slice(0, 7));
  const [dados, setDados] = useState<DadosPainel | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [recarregarSeq, setRecarregarSeq] = useState(0);
  const [novoAberto, setNovoAberto] = useState(false);
  const [cats, setCats] = useState<Categoria[]>([]);
  const [contas, setContas] = useState<Conta[]>([]);
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [carregandoForm, setCarregandoForm] = useState(false);
  const mesAtualReal = hojeSP().slice(0, 7);
  const podeCriar = podeLancar(permissoes);

  useEffect(() => {
    let ativo = true;
    setErro(null);
    api<DadosPainel>(`/painel?mes=${mes}`)
      .then((d) => {
        if (ativo) setDados(d);
      })
      .catch((e) => {
        if (ativo) setErro(e instanceof ApiErro ? e.message : "Não foi possível carregar o painel");
      });
    return () => {
      ativo = false;
    };
  }, [mes, recarregarSeq]);

  async function abrirNovoLancamento() {
    setCarregandoForm(true);
    setErro(null);
    try {
      const [c, ct, cts] = await Promise.all([
        api<{ arvore: Categoria[] }>("/categorias"),
        api<{ contas: Conta[] }>("/contas"),
        permissoes.contatos.ver
          ? api<{ contatos: Contato[] }>("/contatos")
          : Promise.resolve({ contatos: [] as Contato[] }),
      ]);
      setCats(folhasDaArvore(c.arvore));
      setContas(ct.contas);
      setContatos(cts.contatos);
      setNovoAberto(true);
    } catch (e) {
      setErro(e instanceof ApiErro ? e.message : "Não foi possível abrir o formulário");
    } finally {
      setCarregandoForm(false);
    }
  }

  return (
    <>
      <div className="pagina-cab">
        <div>
          <h1>Painel</h1>
          <div className="mes-nav">
            <button
              type="button"
              className="btn-sec"
              aria-label="Mês anterior"
              onClick={() => setMes((m) => deslocarMes(m, -1))}
            >
              ‹
            </button>
            <p className="mes-atual">{formatarMes(mes)}</p>
            <button
              type="button"
              className="btn-sec"
              aria-label="Próximo mês"
              disabled={mes >= mesAtualReal}
              onClick={() => setMes((m) => deslocarMes(m, 1))}
            >
              ›
            </button>
          </div>
        </div>
        {podeCriar ? (
          <button
            type="button"
            className="btn cab-novo"
            disabled={carregandoForm}
            onClick={() => void abrirNovoLancamento()}
          >
            + Novo lançamento
          </button>
        ) : null}
      </div>
      {erro ? <p className="erro">{erro}</p> : null}
      {!dados && !erro ? <SkeletonPainel /> : null}
      {dados ? <Conteudo p={dados} /> : null}
      {novoAberto ? (
        <FormLancamento
          inicial={null}
          categorias={cats}
          contas={contas}
          contatos={contatos}
          aoCancelar={() => setNovoAberto(false)}
          aoSalvo={async () => {
            setNovoAberto(false);
            setRecarregarSeq((n) => n + 1);
          }}
        />
      ) : null}
      {podeCriar ? (
        <button
          type="button"
          className="fab"
          aria-label="Novo lançamento"
          disabled={carregandoForm}
          onClick={() => void abrirNovoLancamento()}
        >
          +
        </button>
      ) : null}
    </>
  );
}

function SkeletonPainel() {
  return (
    <div className="pn" aria-busy="true" aria-label="Carregando painel">
      <div className="pn-card pn-skel pn-skel-hero" />
      <div className="pn-card pn-skel pn-skel-card" />
      <div className="pn-card pn-skel pn-skel-tall" />
      <div className="pn-card pn-skel pn-skel-tall" />
    </div>
  );
}

function Conteudo({ p }: { p: DadosPainel }) {
  const vazio =
    p.serie.every((m) => m.receitas === 0 && m.despesas === 0) &&
    p.previstosDoMes.quantidade === 0 &&
    p.atrasados.quantidade === 0 &&
    (p.contas?.itens.length ?? 0) === 0;
  if (vazio) {
    return (
      <p className="vazio">
        Ainda não há lançamentos para mostrar. <Link to="/lancamentos">Registre o primeiro</Link>
      </p>
    );
  }
  const alertas = gerarAlertas(p);
  const visiveis = alertas.slice(0, MAX_AVISOS);
  const escondidos = alertas.length - visiveis.length;
  return (
    <div className="pn">
      <Resultado p={p} />
      <section className="pn-card pn-atencao" aria-labelledby="pn-atencao-t">
        <h2 id="pn-atencao-t">O que pede decisão</h2>
        {alertas.length === 0 ? (
          <p className="pn-ok">Nada pede atenção agora. As contas e o mês estão em ordem.</p>
        ) : (
          <ul className="pn-alertas">
            {visiveis.map((a) => (
              <li key={a.id}>
                <Link className={`pn-alerta ${a.nivel}`} to={a.para}>
                  <span className="pn-icone" aria-hidden="true">
                    <Icone nome="alerta" />
                  </span>
                  <span>
                    <strong>{a.titulo}</strong>
                    <small>{a.detalhe}</small>
                  </span>
                  <span className="pn-nivel">{a.nivel === "critico" ? "Urgente" : "Atenção"}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {escondidos > 0 ? (
          <p className="pn-mais">
            Mais {escondidos} {escondidos === 1 ? "aviso menos grave" : "avisos menos graves"}
          </p>
        ) : null}
      </section>
      <GraficoSerieMensal p={p} />
      <PrevistoRealizado p={p} />
      {p.despesasPorCategoria ? (
        <GraficoCategorias
          mes={p.mes}
          mesAnterior={p.mesAnterior}
          titulo="Para onde foi o dinheiro"
          itens={p.despesasPorCategoria}
          tipo="despesa"
          destaque={destaqueDeCategorias(p)}
          acaoCabecalho={
            <Link to={`/lancamentos?mes=${p.mes}&tipo=despesa`} className="pn-link">
              Ver lançamentos
            </Link>
          }
        />
      ) : null}
      <div className="pn-col">
        <GraficoRoscaNatureza p={p} />
        {p.receitasPorCategoria ? (
          <GraficoCategorias
            mes={p.mes}
            mesAnterior={p.mesAnterior}
            titulo="De onde veio o dinheiro"
            itens={p.receitasPorCategoria}
            tipo="receita"
            destaque={null}
            acaoCabecalho={
              <Link to={`/lancamentos?mes=${p.mes}&tipo=receita`} className="pn-link">
                Ver lançamentos
              </Link>
            }
          />
        ) : null}
      </div>
      {p.movimentoPorConta ? <GraficoMovimentoContas p={p} /> : null}
      {p.contas ? <Contas p={p} /> : null}
    </div>
  );
}

function Resultado({ p }: { p: DadosPainel }) {
  const resultado = p.atual.receitas - p.atual.despesas;
  const anterior = p.anterior.receitas - p.anterior.despesas;
  const dif = resultado - anterior;
  const soma = p.atual.receitas + p.atual.despesas;
  const pctReceita = soma === 0 ? 0 : (p.atual.receitas / soma) * 100;
  const aPagar = p.previstosDoMes.despesas - p.previstosDoMes.receitas;
  const folego = calcularFolego(p);
  return (
    <section
      className={`pn-card pn-hero ${resultado < 0 ? "negativo" : "positivo"}`}
      aria-labelledby="pn-resultado-t"
    >
      <div className="pn-hero-res">
        <h2 id="pn-resultado-t">Resultado de {mesPorExtenso(p.mes)}</h2>
        <p className={`pn-grande ${resultado < 0 ? "despesa" : "receita"}`}>
          {resultado < 0 ? "−" : ""}
          {formatBRL(Math.abs(resultado))}
        </p>
        <p className="pn-comparativo">
          {dif === 0
            ? `Igual a ${mesPorExtenso(p.mesAnterior)}`
            : `${formatBRL(Math.abs(dif))} ${dif > 0 ? "acima" : "abaixo"} de ${mesPorExtenso(p.mesAnterior)}`}
        </p>
        {soma > 0 ? (
          <div className="resumo-barra" aria-hidden="true">
            <i className="r" style={{ width: `${pctReceita}%` }} />
            <i className="d" style={{ width: `${100 - pctReceita}%` }} />
          </div>
        ) : null}
        <dl className="pn-trio">
          <div>
            <dt>Receitas</dt>
            <dd className="receita">{formatBRL(p.atual.receitas)}</dd>
            <Delta atual={p.atual.receitas} anterior={p.anterior.receitas} subirEhBom />
          </div>
          <div>
            <dt>Despesas</dt>
            <dd className="despesa">{formatBRL(p.atual.despesas)}</dd>
            <Delta atual={p.atual.despesas} anterior={p.anterior.despesas} subirEhBom={false} />
          </div>
          {p.previstosDoMes.quantidade > 0 ? (
            <div>
              <dt>{aPagar > 0 ? "Ainda a pagar" : "Ainda a receber"}</dt>
              <dd>{formatBRL(Math.abs(aPagar))}</dd>
              <span className="pn-delta neutro">
                {p.previstosDoMes.quantidade}{" "}
                {p.previstosDoMes.quantidade === 1 ? "previsto" : "previstos"}
              </span>
            </div>
          ) : null}
        </dl>
      </div>
      {folego ? (
        <div className="pn-folego">
          <h3>Fôlego do saldo</h3>
          <p className="pn-folego-dias">
            <strong>{folego.dias > 365 ? "365+" : folego.dias}</strong>{" "}
            {folego.dias === 1 ? "dia" : "dias"}
          </p>
          <div className="pn-regua" aria-hidden="true">
            {Array.from({ length: 30 }, (_, i) => (
              <i key={i} className={i < Math.min(30, folego.dias) ? "on" : undefined} />
            ))}
          </div>
          <p>
            No ritmo de gastos de {mesPorExtenso(p.mes)} ({formatBRL(folego.ritmoDiario)} por dia),
            o saldo de {formatBRL(folego.saldo)} cobre{" "}
            {folego.dias > 365
              ? "mais de um ano"
              : `${folego.dias} ${folego.dias === 1 ? "dia" : "dias"}`}
            . O medidor cheio equivale a 30 dias.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function PrevistoRealizado({ p }: { p: DadosPainel }) {
  const linhas = [
    {
      id: "d",
      rotulo: "Despesas",
      realizado: p.atual.despesas,
      previsto: p.previstosDoMes.despesas,
    },
    {
      id: "r",
      rotulo: "Receitas",
      realizado: p.atual.receitas,
      previsto: p.previstosDoMes.receitas,
    },
  ];
  const maximo = Math.max(1, ...linhas.map((l) => l.realizado + l.previsto));
  return (
    <section className="pn-card" aria-labelledby="pn-prev-t">
      <div className="pn-titulo">
        <div>
          <h2 id="pn-prev-t">Realizado e previsto em {mesPorExtenso(p.mes)}</h2>
          <p className="pn-subtitulo">Projeção total do mês somando o que ainda está previsto</p>
        </div>
        <span className="pn-legenda" aria-hidden="true">
          <i className="solido" /> Realizado <i className="listrado" /> Previsto
        </span>
      </div>
      <ul className="pn-categorias">
        {linhas.map((l) => {
          const total = l.realizado + l.previsto;
          const pct = total > 0 ? Math.round((l.realizado / total) * 100) : 0;
          return (
            <li key={l.id}>
              <div className="pn-linha">
                <span className="prev-rotulo">
                  <strong>{l.rotulo}</strong>
                  {total > 0 ? <span className="pn-delta neutro">{pct}% realizado</span> : null}
                </span>
                <span className="pn-valor">{formatBRL(total)}</span>
              </div>
              <div className="pn-trilho pn-empilhado" aria-hidden="true">
                <i
                  className={l.id}
                  style={{ width: `${(l.realizado / maximo) * 100}%` }}
                  title={`Realizado: ${formatBRL(l.realizado)}`}
                />
                <i
                  className={`${l.id} previsto`}
                  style={{ width: `${(l.previsto / maximo) * 100}%` }}
                  title={`Previsto: ${formatBRL(l.previsto)}`}
                />
              </div>
              <div className="pn-sub">
                <span>Realizado {formatBRL(l.realizado)}</span>
                <span>Ainda previsto {formatBRL(l.previsto)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Contas({ p }: { p: DadosPainel }) {
  const contas = p.contas!;
  return (
    <section className="pn-card pn-contas-card" aria-labelledby="pn-contas-t">
      <div className="pn-titulo">
        <h2 id="pn-contas-t">Saldo nas contas</h2>
        <Link to="/contas" className="pn-link">
          Ver contas
        </Link>
      </div>
      <p className={`pn-medio ${contas.total < 0 ? "despesa" : ""}`}>
        {contas.total < 0 ? "−" : ""}
        {formatBRL(Math.abs(contas.total))}
      </p>
      {contas.itens.length === 0 ? (
        <p className="meta">Nenhuma conta ativa.</p>
      ) : (
        <ul className="pn-contas">
          {contas.itens.map((c) => (
            <li key={c.id} className={c.saldo < 0 ? "negativa" : undefined}>
              <span className="pn-conta-nome">
                <Icone nome={iconeConta(c.tipo)} />
                {c.nome}
              </span>
              <span className={`pn-valor ${c.saldo < 0 ? "despesa" : ""}`}>
                {c.saldo < 0 ? "−" : ""}
                {formatBRL(Math.abs(c.saldo))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
