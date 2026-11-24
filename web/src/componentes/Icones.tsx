export type NomeIcone =
  | "painel"
  | "lancamentos"
  | "categorias"
  | "contas"
  | "contatos"
  | "pf"
  | "pj"
  | "banco"
  | "cartao"
  | "inativos"
  | "pessoas"
  | "log"
  | "titulares"
  | "alerta"
  | "mais"
  | "editar"
  | "cadeado"
  | "fechar"
  | "info"
  | "copiar"
  | "check"
  | "menu";

const svg = {
  viewBox: "0 0 24 24",
  width: 20,
  height: 20,
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
};

export function iconeConta(tipo: "carteira" | "banco" | "cartao"): NomeIcone {
  if (tipo === "banco") return "banco";
  if (tipo === "cartao") return "cartao";
  return "contas";
}

export function Icone({ nome }: { nome: NomeIcone }) {
  switch (nome) {
    case "painel":
      return (
        <svg {...svg}>
          <path d="M5 20V11M12 20V5M19 20v-6" />
        </svg>
      );
    case "lancamentos":
      return (
        <svg {...svg}>
          <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
        </svg>
      );
    case "categorias":
      return (
        <svg {...svg}>
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
      );
    case "contas":
      return (
        <svg {...svg}>
          <path d="M3 8a2 2 0 0 1 2-2h13v3M3 8v9a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1H5a2 2 0 0 1-2-1M16.5 14h.01" />
        </svg>
      );
    case "contatos":
      return (
        <svg {...svg}>
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <circle cx="12" cy="10" r="2.5" />
          <path d="M8 17a4 4 0 0 1 8 0" />
        </svg>
      );
    case "pf":
      return (
        <svg {...svg}>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 20a7 7 0 0 1 14 0" />
        </svg>
      );
    case "pj":
      return (
        <svg {...svg}>
          <path d="M4 20V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v15M14 10h5a1 1 0 0 1 1 1v9M2 20h20M8 8h2M8 12h2M8 16h2M16.5 14h1" />
        </svg>
      );
    case "banco":
      return (
        <svg {...svg}>
          <path d="M3 10h18M4 20h16M6 10v7M10 10v7M14 10v7M18 10v7M3 10l9-6 9 6" />
        </svg>
      );
    case "cartao":
      return (
        <svg {...svg}>
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <path d="M3 10h18M7 15h4" />
        </svg>
      );
    case "inativos":
      return (
        <svg {...svg}>
          <path d="M3 5h18v4H3zM5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4" />
        </svg>
      );
    case "pessoas":
      return (
        <svg {...svg}>
          <path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14a6.5 6.5 0 0 1 3.5 6" />
        </svg>
      );
    case "log":
      return (
        <svg {...svg}>
          <path d="M12 7v5l3 2M3 12a9 9 0 1 0 3-6.7M3 4v4h4" />
        </svg>
      );
    case "titulares":
      return (
        <svg {...svg}>
          <path d="M4 20V9l8-5 8 5v11M9 20v-6h6v6" />
        </svg>
      );
    case "alerta":
      return (
        <svg {...svg}>
          <path d="M12 9v4M12 17h.01M10.3 4.2 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" />
        </svg>
      );
    case "mais":
      return (
        <svg {...svg}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v8M8 12h8" />
        </svg>
      );
    case "editar":
      return (
        <svg {...svg}>
          <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4zM13.5 6.5l4 4" />
        </svg>
      );
    case "cadeado":
      return (
        <svg {...svg}>
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
      );
    case "fechar":
      return (
        <svg {...svg}>
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      );
    case "info":
      return (
        <svg {...svg}>
          <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM18.5 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z" />
        </svg>
      );
    case "copiar":
      return (
        <svg {...svg}>
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      );
    case "check":
      return (
        <svg {...svg}>
          <path d="M5 13l4 4L19 7" />
        </svg>
      );
    case "menu":
      return (
        <svg {...svg}>
          <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
    default: {
      const _e: never = nome;
      return _e;
    }
  }
}
