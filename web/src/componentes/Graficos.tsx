import { formatBRL } from "@finan/shared";
import { useId, useState } from "react";
import { formatarMes } from "../formato";
import { mesPorExtenso, variacao } from "../painel-alertas";
import type { GastoPorCategoria, MovimentoDaConta, Painel as DadosPainel } from "../tipos";

/** Formata centavos de forma compacta para o eixo Y (ex.: "R$ 4,5k", "R$ 800"). */
function eixoCompacto(centavos: number): string {
  const reais = centavos / 100;
  if (Math.abs(reais) >= 1_000_000) {
    return `R$ ${(reais / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M`;
  }
  if (Math.abs(reais) >= 1_000) {
    return `R$ ${(reais / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`;
  }
  return `R$ ${Math.round(reais).toLocaleString("pt-BR")}`;
}

function mesCurto(aaaaMm: string): string {
  const [y, m] = aaaaMm.split("-").map(Number) as [number, number];
  return new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, 1)))
    .replace(".", "");
}

/** Calcula um topo "bonito" para o eixo Y (múltiplo limpo de 1, 2, 2.5 ou 5). */
function topoBonito(maximoCentavos: number): number {
  if (maximoCentavos <= 0) return 100_00;
  const reais = maximoCentavos / 100;
  const pot = 10 ** Math.floor(Math.log10(reais));
  const norm = reais / pot;
  const passo = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return Math.round(passo * pot * 100);
}

/** Variação em %, colorida pelo significado (subir despesa é ruim, subir receita é bom). */
export function Delta({
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

/**
 * Gráfico SVG interativo dos últimos 6 meses:
 * - Linhas de grade sutis e eixo Y formatado em R$
 * - Barras de Receitas e Despesas com gradiente suave
 * - Linha de tendência do saldo líquido (receitas - despesas) quando positivo
 * - Painel/tooltip instantâneo ao passar o mouse, focar ou tocar em qualquer mês
 */
export function GraficoSerieMensal({ p }: { p: DadosPainel }) {
  const idBase = useId();
  const [ativoIdx, setAtivoIdx] = useState<number | null>(null);
  const serie = p.serie;
  const maxBruto = Math.max(0, ...serie.flatMap((m) => [m.receitas, m.despesas]));
  const topo = topoBonito(maxBruto);

  // Dimensões do viewBox SVG (escala limpa em qualquer largura)
  const W = 560;
  const H = 220;
  const padEsq = 58;
  const padDir = 14;
  const padTopo = 18;
  const padBase = 44;
  const largGraf = W - padEsq - padDir;
  const altGraf = H - padTopo - padBase;
  const colW = largGraf / Math.max(1, serie.length);
  const barW = Math.min(22, Math.max(10, colW * 0.27));
  const gapBar = 4;

  const yDe = (valor: number) => {
    const clamped = Math.max(0, Math.min(topo, valor));
    return padTopo + altGraf - (clamped / topo) * altGraf;
  };
  const hDe = (valor: number) => {
    if (valor <= 0) return 0;
    return Math.max(3, (valor / topo) * altGraf);
  };

  const grades = [0, 0.5, 1];
  const idxFocado = ativoIdx ?? serie.findIndex((m) => m.mes === p.mes);
  const itemFocado = idxFocado >= 0 ? serie[idxFocado] : serie[serie.length - 1];

  // Pontos da linha de resultado líquido (ancorada na faixa positiva ou na base quando negativo)
  const pontosLinha = serie.map((m, i) => {
    const cx = padEsq + colW * i + colW / 2;
    const saldo = m.receitas - m.despesas;
    const cy = yDe(Math.max(0, saldo));
    return { cx, cy, saldo };
  });
  const dLinha = pontosLinha
    .map((pt, i) => `${i === 0 ? "M" : "L"} ${pt.cx.toFixed(1)} ${pt.cy.toFixed(1)}`)
    .join(" ");

  return (
    <section className="pn-card pn-serie-card" aria-labelledby="pn-serie-t">
      <div className="pn-titulo">
        <div>
          <h2 id="pn-serie-t">Últimos {serie.length} meses</h2>
          <p className="pn-subtitulo">Passe o mouse ou toque em um mês para ver o detalhe</p>
        </div>
        <span className="pn-legenda" aria-hidden="true">
          <i className="r" /> Receitas <i className="d" /> Despesas <i className="linha-leg" /> Saldo
        </span>
      </div>

      {itemFocado ? (
        <div className="graf-detalhe" aria-live="polite">
          <span className="graf-detalhe-mes">{formatarMes(itemFocado.mes)}</span>
          <span className="graf-detalhe-par">
            <small>Receitas</small>
            <strong className="receita">{formatBRL(itemFocado.receitas)}</strong>
          </span>
          <span className="graf-detalhe-par">
            <small>Despesas</small>
            <strong className="despesa">{formatBRL(itemFocado.despesas)}</strong>
          </span>
          <span className="graf-detalhe-par">
            <small>Resultado</small>
            <strong className={itemFocado.receitas >= itemFocado.despesas ? "receita" : "despesa"}>
              {itemFocado.receitas < itemFocado.despesas ? "−" : "+"}
              {formatBRL(Math.abs(itemFocado.receitas - itemFocado.despesas))}
            </strong>
          </span>
        </div>
      ) : null}

      <div className="graf-svg-wrap" onMouseLeave={() => setAtivoIdx(null)}>
        <svg
          className="graf-svg"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Gráfico de receitas e despesas dos últimos ${serie.length} meses`}
        >
          <defs>
            <linearGradient id={`${idBase}-r`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--receita)" stopOpacity="1" />
              <stop offset="100%" stopColor="var(--receita)" stopOpacity="0.62" />
            </linearGradient>
            <linearGradient id={`${idBase}-d`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--despesa)" stopOpacity="1" />
              <stop offset="100%" stopColor="var(--despesa)" stopOpacity="0.62" />
            </linearGradient>
          </defs>

          {grades.map((g) => {
            const y = padTopo + altGraf * (1 - g);
            return (
              <g key={g}>
                <line
                  x1={padEsq}
                  x2={W - padDir}
                  y1={y}
                  y2={y}
                  className={g === 0 ? "graf-eixo" : "graf-grade"}
                />
                <text x={padEsq - 8} y={y + 4} textAnchor="end" className="graf-eixo-txt">
                  {eixoCompacto(Math.round(topo * g))}
                </text>
              </g>
            );
          })}

          {serie.map((m, i) => {
            const x0 = padEsq + colW * i;
            const cx = x0 + colW / 2;
            const ehAtual = m.mes === p.mes;
            const destacado = ativoIdx === null ? ehAtual : ativoIdx === i;
            const hr = hDe(m.receitas);
            const hd = hDe(m.despesas);
            const yr = padTopo + altGraf - hr;
            const yd = padTopo + altGraf - hd;
            const saldo = m.receitas - m.despesas;
            return (
              <g
                key={m.mes}
                className={`graf-col${destacado ? " ativo" : ""}${ehAtual ? " atual" : ""}`}
                tabIndex={0}
                role="button"
                aria-label={`${formatarMes(m.mes)}: receitas ${formatBRL(m.receitas)}, despesas ${formatBRL(m.despesas)}`}
                onMouseEnter={() => setAtivoIdx(i)}
                onFocus={() => setAtivoIdx(i)}
                onClick={() => setAtivoIdx(i)}
              >
                <rect
                  x={x0 + 4}
                  y={padTopo - 4}
                  width={colW - 8}
                  height={altGraf + 8}
                  rx={10}
                  className="graf-col-fundo"
                />
                {hr > 0 ? (
                  <rect
                    x={cx - barW - gapBar / 2}
                    y={yr}
                    width={barW}
                    height={hr}
                    rx={5}
                    fill={`url(#${idBase}-r)`}
                    className="graf-barra"
                  />
                ) : null}
                {hd > 0 ? (
                  <rect
                    x={cx + gapBar / 2}
                    y={yd}
                    width={barW}
                    height={hd}
                    rx={5}
                    fill={`url(#${idBase}-d)`}
                    className="graf-barra"
                  />
                ) : null}
                <text x={cx} y={padTopo + altGraf + 18} textAnchor="middle" className="graf-mes-txt">
                  {mesCurto(m.mes)}
                </text>
                <text
                  x={cx}
                  y={padTopo + altGraf + 34}
                  textAnchor="middle"
                  className={`graf-saldo-txt ${saldo >= 0 ? "r" : "d"}`}
                >
                  {saldo >= 0 ? "+" : "−"}
                  {Math.round(Math.abs(saldo) / 100).toLocaleString("pt-BR")}
                </text>
              </g>
            );
          })}

          {maxBruto > 0 ? (
            <g className="graf-linha-grupo" aria-hidden="true">
              <path d={dLinha} className="graf-linha-saldo" />
              {pontosLinha.map((pt, i) => {
                const destacado = ativoIdx === i || (ativoIdx === null && serie[i]?.mes === p.mes);
                return (
                  <circle
                    key={serie[i]?.mes ?? i}
                    cx={pt.cx}
                    cy={pt.cy}
                    r={destacado ? 4.5 : 3}
                    className={`graf-ponto-saldo${pt.saldo < 0 ? " neg" : ""}${destacado ? " ativo" : ""}`}
                  />
                );
              })}
            </g>
          ) : null}
        </svg>
      </div>

      <table className="so-leitor">
        <caption>Receitas e despesas por mês</caption>
        <thead>
          <tr>
            <th>Mês</th>
            <th>Receitas</th>
            <th>Despesas</th>
            <th>Resultado</th>
          </tr>
        </thead>
        <tbody>
          {serie.map((m) => (
            <tr key={m.mes}>
              <td>{formatarMes(m.mes)}</td>
              <td>{formatBRL(m.receitas)}</td>
              <td>{formatBRL(m.despesas)}</td>
              <td>{formatBRL(m.receitas - m.despesas)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * Rosca SVG interativa para Despesas Fixas × Variáveis:
 * traço nítido com extremidades arredondadas, 2 cores distintas e foco interativo no centro.
 */
export function GraficoRoscaNatureza({ p }: { p: DadosPainel }) {
  const [foco, setFoco] = useState<"fixa" | "variavel" | null>(null);
  const n = p.despesasPorNatureza;
  const total = n.fixa + n.variavel;
  const pctFixa = total === 0 ? 0 : (n.fixa / total) * 100;
  const pctVar = total === 0 ? 0 : 100 - pctFixa;

  const r = 52;
  const circ = 2 * Math.PI * r;
  const gap = n.fixa > 0 && n.variavel > 0 ? 6 : 0;
  const compFixa = Math.max(0, (pctFixa / 100) * circ - gap);
  const compVar = Math.max(0, (pctVar / 100) * circ - gap);

  const centroValor =
    foco === "fixa" ? formatBRL(n.fixa) : foco === "variavel" ? formatBRL(n.variavel) : formatBRL(total);
  const centroRotulo =
    foco === "fixa"
      ? `fixas · ${Math.round(pctFixa)}%`
      : foco === "variavel"
        ? `variáveis · ${Math.round(pctVar)}%`
        : "despesas";

  const linhas = [
    { id: "fixa" as const, rotulo: "Fixas", valor: n.fixa, anterior: n.fixaAnterior, pct: Math.round(pctFixa) },
    {
      id: "variavel" as const,
      rotulo: "Variáveis",
      valor: n.variavel,
      anterior: n.variavelAnterior,
      pct: Math.round(pctVar),
    },
  ];

  return (
    <section className="pn-card" aria-labelledby="pn-nat-t">
      <h2 id="pn-nat-t">Despesas fixas e variáveis</h2>
      {total === 0 ? (
        <p className="meta">Nenhuma despesa realizada em {mesPorExtenso(p.mes)}.</p>
      ) : (
        <div className="pn-nat" onMouseLeave={() => setFoco(null)}>
          <div
            className="rosca-svg-box"
            role="img"
            aria-label={`Fixas ${Math.round(pctFixa)}% e variáveis ${Math.round(pctVar)}% das despesas`}
          >
            <svg viewBox="0 0 132 132" className="rosca-svg">
              <circle cx="66" cy="66" r={r} className="rosca-trilho" />
              {n.variavel > 0 ? (
                <circle
                  cx="66"
                  cy="66"
                  r={r}
                  className={`rosca-arco variavel${foco === "fixa" ? " suave" : ""}${foco === "variavel" ? " foco" : ""}`}
                  strokeDasharray={`${compVar} ${circ}`}
                  strokeDashoffset={-(compFixa + gap)}
                  transform="rotate(-90 66 66)"
                  onMouseEnter={() => setFoco("variavel")}
                  onClick={() => setFoco((f) => (f === "variavel" ? null : "variavel"))}
                />
              ) : null}
              {n.fixa > 0 ? (
                <circle
                  cx="66"
                  cy="66"
                  r={r}
                  className={`rosca-arco fixa${foco === "variavel" ? " suave" : ""}${foco === "fixa" ? " foco" : ""}`}
                  strokeDasharray={`${compFixa} ${circ}`}
                  strokeDashoffset={0}
                  transform="rotate(-90 66 66)"
                  onMouseEnter={() => setFoco("fixa")}
                  onClick={() => setFoco((f) => (f === "fixa" ? null : "fixa"))}
                />
              ) : null}
            </svg>
            <div className="rosca-centro">
              <span>{centroValor}</span>
              <small>{centroRotulo}</small>
            </div>
          </div>

          <ul className="pn-categorias">
            {linhas.map((l) => (
              <li
                key={l.id}
                className={`nat-item${foco === l.id ? " foco" : ""}`}
                onMouseEnter={() => setFoco(l.id)}
                onClick={() => setFoco((f) => (f === l.id ? null : l.id))}
              >
                <div className="pn-linha">
                  <span className="pn-chave">
                    <i className={l.id} aria-hidden="true" />
                    {l.rotulo} · {l.pct}%
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

const CORES_DESPESA = [
  "var(--graf-1)",
  "var(--graf-2)",
  "var(--graf-3)",
  "var(--graf-4)",
  "var(--graf-5)",
  "var(--graf-6)",
];
const CORES_RECEITA = [
  "var(--receita)",
  "var(--graf-2)",
  "var(--graf-6)",
  "var(--graf-1)",
  "var(--graf-3)",
  "var(--graf-4)",
];

/**
 * Distribuição por categoria-raiz com barra segmentada proporcional no topo + lista sincronizada.
 */
export function GraficoCategorias({
  mes,
  mesAnterior,
  titulo,
  itens,
  tipo,
  destaque,
  acaoCabecalho,
}: {
  mes: string;
  mesAnterior: string;
  titulo: string;
  itens: GastoPorCategoria[];
  tipo: "receita" | "despesa";
  destaque: string | null;
  acaoCabecalho: React.ReactNode;
}) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const todas = itens.filter((c) => c.valor > 0);
  const total = todas.reduce((s, c) => s + c.valor, 0);
  const topo = todas.slice(0, 6);
  const maximo = Math.max(1, ...topo.map((c) => c.valor));
  const resto = todas.slice(6).reduce((s, c) => s + c.valor, 0);
  const plural = tipo === "despesa" ? "despesas" : "receitas";
  const paleta = tipo === "despesa" ? CORES_DESPESA : CORES_RECEITA;
  const id = `pn-cat-${tipo}`;

  return (
    <section
      className={`pn-card pn-cat-${tipo}`}
      aria-labelledby={id}
      onMouseLeave={() => setHoverId(null)}
    >
      <div className="pn-titulo">
        <div>
          <h2 id={id}>{titulo}</h2>
          <p className="pn-subtitulo">
            {tipo === "despesa" ? "Despesas" : "Receitas"} em {mesPorExtenso(mes)}, comparadas a{" "}
            {mesPorExtenso(mesAnterior)}
          </p>
        </div>
        {acaoCabecalho}
      </div>

      {topo.length === 0 ? (
        <p className="meta">
          Nenhuma {tipo} realizada em {mesPorExtenso(mes)}.
        </p>
      ) : (
        <>
          {total > 0 ? (
            <div className="cat-barra-composta" aria-hidden="true">
              {topo.map((c, idx) => {
                const cor = paleta[idx % paleta.length];
                const pct = (c.valor / total) * 100;
                const opaco = hoverId !== null && hoverId !== c.id;
                return (
                  <i
                    key={c.id}
                    className={opaco ? "suave" : undefined}
                    style={{ width: `${pct}%`, background: cor }}
                    onMouseEnter={() => setHoverId(c.id)}
                  />
                );
              })}
              {resto > 0 ? (
                <i
                  className={hoverId !== null && hoverId !== "__resto__" ? "suave" : undefined}
                  style={{ width: `${(resto / total) * 100}%`, background: "var(--linha-forte)" }}
                  onMouseEnter={() => setHoverId("__resto__")}
                />
              ) : null}
            </div>
          ) : null}

          <ul className="pn-categorias">
            {topo.map((c, idx) => {
              const cor = paleta[idx % paleta.length];
              const focado = hoverId === c.id;
              const suave = hoverId !== null && !focado;
              return (
                <li
                  key={c.id}
                  className={`cat-item${focado ? " foco" : ""}${suave ? " suave" : ""}`}
                  onMouseEnter={() => setHoverId(c.id)}
                >
                  <div className="pn-linha">
                    <span className="cat-nome">
                      <i className="cat-dot" style={{ background: cor }} aria-hidden="true" />
                      {c.nome}
                    </span>
                    <span className="pn-valor">{formatBRL(c.valor)}</span>
                  </div>
                  <div className="pn-trilho" aria-hidden="true">
                    <i style={{ width: `${(c.valor / maximo) * 100}%`, background: cor }} />
                  </div>
                  <div className="pn-sub">
                    <span>
                      {Math.round((c.valor / total) * 100)}% das {plural}
                    </span>
                    <Delta atual={c.valor} anterior={c.anterior} subirEhBom={tipo === "receita"} />
                  </div>
                </li>
              );
            })}
            {resto > 0 ? (
              <li
                className={`pn-resto cat-item${hoverId === "__resto__" ? " foco" : ""}`}
                onMouseEnter={() => setHoverId("__resto__")}
              >
                <div className="pn-linha">
                  <span className="cat-nome">
                    <i
                      className="cat-dot"
                      style={{ background: "var(--linha-forte)" }}
                      aria-hidden="true"
                    />
                    Outras categorias
                  </span>
                  <span className="pn-valor">{formatBRL(resto)}</span>
                </div>
              </li>
            ) : null}
          </ul>
        </>
      )}
      {destaque ? <p className="pn-destaque">{destaque}</p> : null}
    </section>
  );
}

/** Movimento por conta com saldo líquido do mês ao lado do nome da conta. */
export function GraficoMovimentoContas({ p }: { p: DadosPainel }) {
  const itens: MovimentoDaConta[] = p.movimentoPorConta ?? [];
  const maximo = Math.max(1, ...itens.flatMap((c) => [c.receitas, c.despesas]));
  return (
    <section className="pn-card" aria-labelledby="pn-mov-t">
      <div className="pn-titulo">
        <div>
          <h2 id="pn-mov-t">Movimento por conta</h2>
          <p className="pn-subtitulo">Entradas e saídas realizadas em {mesPorExtenso(p.mes)}</p>
        </div>
        <span className="pn-legenda" aria-hidden="true">
          <i className="r" /> Entrou <i className="d" /> Saiu
        </span>
      </div>
      {itens.length === 0 ? (
        <p className="meta">Nenhum movimento realizado em {mesPorExtenso(p.mes)}.</p>
      ) : (
        <ul className="pn-categorias">
          {itens.map((c) => {
            const liquido = c.receitas - c.despesas;
            return (
              <li key={c.id} className="mov-conta-item">
                <div className="pn-linha">
                  <strong>{c.nome}</strong>
                  <span className={`pn-delta ${liquido >= 0 ? "bom" : "ruim"}`}>
                    {liquido >= 0 ? "+" : "−"}
                    {formatBRL(Math.abs(liquido))}
                  </span>
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
            );
          })}
        </ul>
      )}
    </section>
  );
}
