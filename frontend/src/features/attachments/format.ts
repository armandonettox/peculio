import { currentIntlLocale } from "@/i18n";
/** Tamanho legivel: "850 B", "1,5 KB", "2,3 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // Uma casa so abaixo de 10, na pontuacao do idioma ("1,5 KB" em portugues, "1.5 KB" em ingles); "1,0" vira "1"
  const text = new Intl.NumberFormat(currentIntlLocale(), { maximumFractionDigits: value >= 10 ? 0 : 1 }).format(value);
  return `${text} ${units[unit]}`;
}

/** Data do envio no formato do Brasil, no fuso do navegador: "05/03/2026". */
export function formatUploadDate(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleDateString(currentIntlLocale());
}
