/** Marca do finan: três degraus, o saldo subindo. Cores vêm dos tokens (claro e escuro). */
export function MarcaFinan({ tamanho = 28 }: { tamanho?: number }) {
  return (
    <svg
      className="marca-svg"
      width={tamanho}
      height={tamanho}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="0.5" y="0.5" width="31" height="31" rx="9" className="marca-fundo" />
      <rect x="6" y="17" width="5" height="9" rx="2" className="marca-d1" />
      <rect x="13.5" y="12" width="5" height="14" rx="2" className="marca-d2" />
      <rect x="21" y="6" width="5" height="20" rx="2" className="marca-d3" />
    </svg>
  );
}
