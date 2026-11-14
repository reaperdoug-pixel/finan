import { formatBRL } from "@finan/shared";
import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { api, ApiErro } from "../api";
import { deslocarMes, formatarMes, hojeSP } from "../formato";
import { Icone } from "../componentes/Icones";
import { gerarAlertas, mesPorExtenso, variacao } from "../painel-alertas";
import { calcularFolego, destaqueDeCategorias } from "../painel-insights";
import type { GastoPorCategoria, Painel as DadosPainel } from "../tipos";

const TOP_CATEGORIAS = 6;
/** Mais que isso deixa de ser leitura de relance. Os mais graves vêm primeiro. */
const MAX_AVISOS = 4;

function mesCurto(aaaaMm: string): string {
  const [y, m] = aaaaMm.split("-").map(Number) as [number, number];
  return new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, 1)))
    .replace(".", "");
}

/** Variação em %, colorida pelo que ela significa (subir despesa é ruim, subir receita é bom). */
function Delta({
  atual,
  anterior,
  subirEhBom,
}: {
  atual: number;
  anterior: number;
  subirEhBom: boolean;
}) {
  const v = variacao(atual, anterior);
  if (v.pct === null) {
    return atual > 0 ? <span className="pn-delta neutro">novo</span> : null;
  }
  if (v.abs === 0) return <span className="pn-delta neutro">igual</span>;
  const bom = v.abs > 0 === subirEhBom;
  return (
    <span className={`pn-delta ${bom ? "bom" : "ruim"}`}>
      {v.pct > 0 ? "+" : "−"}
      {Math.abs(v.pct)}%
    </span>
  );
}

export function PainelGeral() {
  const [mes, setMes] = useState(hojeSP().slice(0, 7));
  const [dados, setDados] = useState<DadosPainel | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const mesAtualReal = hojeSP().slice(0, 7);

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
  }, [mes]);

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
      </div>
      {erro ? <p className="erro">{erro}</p> : null}
      {!dados && !erro ? <p className="vazio">Carregando…</p> : null}
      {dados ? <Conteudo p={dados} /> : null}
    </>
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
      <Serie p={p} />
      <PrevistoRealizado p={p} />
      {p.despesasPorCategoria ? (
        <Categorias
          mes={p.mes}
          titulo="Para onde foi o dinheiro"
          itens={p.despesasPorCategoria}
          tipo="despesa"
          destaque={destaqueDeCategorias(p)}
        />
      ) : null}
      <div className="pn-col">
        <FixoVariavel p={p} />
        {p.receitasPorCategoria ? (
          <Categorias
            mes={p.mes}
            titulo="De onde veio o dinheiro"
            itens={p.receitasPorCategoria}
            tipo="receita"
            destaque={null}
          />
        ) : null}
      </div>
      {p.movimentoPorConta ? <MovimentoContas p={p} /> : null}
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
    <section className="pn-card pn-hero" aria-labelledby="pn-resultado-t">
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
            <strong>{folego.dias > 365 ? "365+" : folego.dias}</strong> {folego.dias === 1 ? "dia" : "dias"}
          </p>
          <div className="pn-regua" aria-hidden="true">
            {Array.from({ length: 30 }, (_, i) => (
              <i key={i} className={i < Math.min(30, folego.dias) ? "on" : undefined} />
            ))}
          </div>
          <p>
            No ritmo de gastos de {mesPorExtenso(p.mes)} ({formatBRL(folego.ritmoDiario)} por dia), o
            saldo de {formatBRL(folego.saldo)} cobre {folego.dias > 365 ? "mais de um ano" : `${folego.dias} ${folego.dias === 1 ? "dia" : "dias"}`}.
            O medidor cheio equivale a 30 dias.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function Serie({ p }: { p: DadosPainel }) {
  const maximo = Math.max(1, ...p.serie.flatMap((m) => [m.receitas, m.despesas]));
  const altura = (v: number) => (v === 0 ? 0 : Math.max(3, (v / maximo) * 100));
  return (
    <section className="pn-card pn-serie-card" aria-labelledby="pn-serie-t">
      <div className="pn-titulo">
        <h2 id="pn-serie-t">Últimos {p.serie.length} meses</h2>
        <span className="pn-legenda" aria-hidden="true">
          <i className="r" /> Receitas <i className="d" /> Despesas
        </span>
      </div>
      <div className="pn-serie" aria-hidden="true">
        {p.serie.map((m) => (
          <div key={m.mes} className={`pn-mes${m.mes === p.mes ? " atual" : ""}`}>
            <div className="pn-barras">
              <i
                className="r"
                style={{ height: `${altura(m.receitas)}%` }}
                title={`Receitas: ${formatBRL(m.receitas)}`}
              />
              <i
                className="d"
                style={{ height: `${altura(m.despesas)}%` }}
                title={`Despesas: ${formatBRL(m.despesas)}`}
              />
            </div>
            <span>{mesCurto(m.mes)}</span>
            <small className={m.receitas >= m.despesas ? "r" : "d"}>
              {m.receitas >= m.despesas ? "+" : "−"}
              {Math.round(Math.abs(m.receitas - m.despesas) / 100).toLocaleString("pt-BR")}
            </small>
          </div>
        ))}
      </div>
      <table className="so-leitor">
        <caption>Receitas e despesas por mês</caption>
        <thead>
          <tr>
            <th>Mês</th>
            <th>Receitas</th>
            <th>Despesas</th>
          </tr>
        </thead>
        <tbody>
          {p.serie.map((m) => (
            <tr key={m.mes}>
              <td>{formatarMes(m.mes)}</td>
              <td>{formatBRL(m.receitas)}</td>
              <td>{formatBRL(m.despesas)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function PrevistoRealizado({ p }: { p: DadosPainel }) {
  const linhas = [
    { id: "d", rotulo: "Despesas", realizado: p.atual.despesas, previsto: p.previstosDoMes.despesas },
    { id: "r", rotulo: "Receitas", realizado: p.atual.receitas, previsto: p.previstosDoMes.receitas },
  ];
  const maximo = Math.max(1, ...linhas.map((l) => l.realizado + l.previsto));
  return (
    <section className="pn-card" aria-labelledby="pn-prev-t">
      <div className="pn-titulo">
        <h2 id="pn-prev-t">Realizado e previsto em {mesPorExtenso(p.mes)}</h2>
        <span className="pn-legenda" aria-hidden="true">
          <i className="solido" /> Realizado <i className="listrado" /> Previsto
        </span>
      </div>
      <ul className="pn-categorias">
        {linhas.map((l) => (
          <li key={l.id}>
            <div className="pn-linha">
              <span>{l.rotulo}</span>
              <span className="pn-valor">{formatBRL(l.realizado + l.previsto)}</span>
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
        ))}
      </ul>
    </section>
  );
}

function FixoVariavel({ p }: { p: DadosPainel }) {
  const n = p.despesasPorNatureza;
  const total = n.fixa + n.variavel;
  const pctFixa = total === 0 ? 0 : (n.fixa / total) * 100;
  const linhas = [
    { rotulo: "Fixas", cls: "fixa", valor: n.fixa, anterior: n.fixaAnterior },
    { rotulo: "Variáveis", cls: "variavel", valor: n.variavel, anterior: n.variavelAnterior },
  ];
  return (
    <section className="pn-card" aria-labelledby="pn-nat-t">
      <h2 id="pn-nat-t">Despesas fixas e variáveis</h2>
      {total === 0 ? (
        <p className="meta">Nenhuma despesa realizada em {mesPorExtenso(p.mes)}.</p>
      ) : (
        <div className="pn-nat">
          <div
            className="pn-rosca"
            style={{ "--fixa": `${pctFixa}%` } as CSSProperties}
            role="img"
            aria-label={`Fixas ${Math.round(pctFixa)}% e variáveis ${Math.round(100 - pctFixa)}% das despesas`}
          >
            <span>{formatBRL(total)}</span>
            <small>despesas</small>
          </div>
          <ul className="pn-categorias">
            {linhas.map((l) => (
              <li key={l.rotulo}>
                <div className="pn-linha">
                  <span className="pn-chave">
                    <i className={l.cls} aria-hidden="true" />
                    {l.rotulo} · {Math.round((l.valor / total) * 100)}%
                  </span>
                </div>
                <div className="pn-sub">
                  <span className="pn-valor">{formatBRL(l.valor)}</span>
                  <Delta atual={l.valor} anterior={l.anterior} subirEhBom={false} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Categorias({
  mes,
  titulo,
  itens,
  tipo,
  destaque,
}: {
  mes: string;
  titulo: string;
  itens: GastoPorCategoria[];
  tipo: "receita" | "despesa";
  destaque: string | null;
}) {
  const todas = itens.filter((c) => c.valor > 0);
  const total = todas.reduce((s, c) => s + c.valor, 0);
  const topo = todas.slice(0, TOP_CATEGORIAS);
  const maximo = Math.max(1, ...topo.map((c) => c.valor));
  const resto = todas.slice(TOP_CATEGORIAS).reduce((s, c) => s + c.valor, 0);
  const plural = tipo === "despesa" ? "despesas" : "receitas";
  const id = `pn-cat-${tipo}`;
  return (
    <section className={`pn-card pn-cat-${tipo}`} aria-labelledby={id}>
      <h2 id={id}>{titulo}</h2>
      {topo.length === 0 ? (
        <p className="meta">
          Nenhuma {tipo} realizada em {mesPorExtenso(mes)}.
        </p>
      ) : (
        <ul className="pn-categorias">
          {topo.map((c) => (
            <li key={c.id}>
              <div className="pn-linha">
                <span>{c.nome}</span>
                <span className="pn-valor">{formatBRL(c.valor)}</span>
              </div>
              <div className="pn-trilho" aria-hidden="true">
                <i style={{ width: `${(c.valor / maximo) * 100}%` }} />
              </div>
              <div className="pn-sub">
                <span>
                  {Math.round((c.valor / total) * 100)}% das {plural}
                </span>
                <Delta atual={c.valor} anterior={c.anterior} subirEhBom={tipo === "receita"} />
              </div>
            </li>
          ))}
          {resto > 0 ? (
            <li className="pn-resto">
              <div className="pn-linha">
                <span>Outras categorias</span>
                <span className="pn-valor">{formatBRL(resto)}</span>
              </div>
            </li>
          ) : null}
        </ul>
      )}
      {destaque ? <p className="pn-destaque">{destaque}</p> : null}
    </section>
  );
}

function MovimentoContas({ p }: { p: DadosPainel }) {
  const itens = p.movimentoPorConta ?? [];
  const maximo = Math.max(1, ...itens.flatMap((c) => [c.receitas, c.despesas]));
  return (
    <section className="pn-card" aria-labelledby="pn-mov-t">
      <div className="pn-titulo">
        <h2 id="pn-mov-t">Movimento por conta</h2>
        <span className="pn-legenda" aria-hidden="true">
          <i className="r" /> Entrou <i className="d" /> Saiu
        </span>
      </div>
      {itens.length === 0 ? (
        <p className="meta">Nenhum movimento realizado em {mesPorExtenso(p.mes)}.</p>
      ) : (
        <ul className="pn-categorias">
          {itens.map((c) => (
            <li key={c.id}>
              <div className="pn-linha">
                <span>{c.nome}</span>
              </div>
              {(
                [
                  ["r", "Entrou", c.receitas],
                  ["d", "Saiu", c.despesas],
                ] as const
              ).map(([cls, rotulo, valor]) => (
                <div key={cls} className="pn-duplo">
                  <span>{rotulo}</span>
                  <div className="pn-trilho" aria-hidden="true">
                    <i className={cls} style={{ width: `${(valor / maximo) * 100}%` }} />
                  </div>
                  <span className="pn-valor">{formatBRL(valor)}</span>
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
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
              <span>{c.nome}</span>
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
