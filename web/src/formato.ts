/** Data de hoje no calendário de São Paulo, AAAA-MM-DD. */
export function hojeSP(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** "2026-11-13" → "13/11/2026". */
export function formatarData(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

/** "2026-11-13" → "sexta-feira, 13 de novembro". */
export function formatarDiaGrupo(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/** "2026-11" → "Novembro de 2026". */
export function formatarMes(aaaaMm: string): string {
  const [y, m] = aaaaMm.split("-").map(Number);
  if (!y || !m) return aaaaMm;
  const texto = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Soma `delta` meses a "AAAA-MM". */
export function deslocarMes(aaaaMm: string, delta: number): string {
  const [y, m] = aaaaMm.split("-").map(Number);
  if (!y || !m) return aaaaMm;
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function primeiroDiaDoMes(isoDia: string): string {
  return `${isoDia.slice(0, 7)}-01`;
}

export function ultimoDiaDoMes(isoDia: string): string {
  const [y, m] = isoDia.split("-").map(Number) as [number, number];
  const dt = new Date(Date.UTC(y, m, 0));
  const dia = String(dt.getUTCDate()).padStart(2, "0");
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${dia}`;
}

export function rotuloTipo(t: string): string {
  if (t === "receita") return "Receita";
  if (t === "despesa") return "Despesa";
  if (t === "carteira") return "Carteira";
  if (t === "banco") return "Banco";
  if (t === "cartao") return "Cartão";
  if (t === "pf") return "Pessoa física";
  if (t === "pj") return "Pessoa jurídica";
  if (t === "cliente") return "Cliente";
  if (t === "fornecedor") return "Fornecedor";
  if (t === "ambos") return "Cliente e fornecedor";
  if (t === "fixa") return "Fixa";
  if (t === "variavel") return "Variável";
  if (t === "previsto") return "Previsto";
  if (t === "realizado") return "Realizado";
  return t;
}

/** Formata CPF (11 dígitos) ou CNPJ (14 dígitos). */
export function formatarDocumento(doc: string | null): string {
  if (!doc) return "";
  if (doc.length === 11) {
    return doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  if (doc.length === 14) {
    return doc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  }
  return doc;
}
