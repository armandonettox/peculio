import QRCode from "qrcode";
import { useMemo } from "react";

const QUIET_ZONE = 4;

/**
 * QR code desenhado aqui mesmo, em SVG, sem mandar o texto para nenhum servico. O segredo do
 * 2FA vai dentro dele, entao nada pode sair do navegador.
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const { modules } = QRCode.create(value, { errorCorrectionLevel: "M" });
    const moduleCount = modules.size;
    let d = "";
    for (let row = 0; row < moduleCount; row++) {
      for (let col = 0; col < moduleCount; col++) {
        if (modules.data[row * moduleCount + col]) d += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
      }
    }
    return { size: moduleCount + QUIET_ZONE * 2, path: d };
  }, [value]);

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className="size-48 rounded-md border"
    >
      {/* Preto sobre branco nos dois temas: leitores de QR falham com contraste invertido */}
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
