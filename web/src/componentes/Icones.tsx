export type NomeIcone =
  | "painel"
  | "lancamentos"
  | "categorias"
  | "contas"
  | "inativos"
  | "pessoas"
  | "log"
  | "titulares"
  | "alerta"
  | "mais"
  | "editar"
  | "cadeado"
  | "fechar"
  | "info";

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
    default: {
      const _e: never = nome;
      return _e;
    }
  }
}
