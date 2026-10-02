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
  const text = value >= 10 ? Math.round(value).toString() : value.toFixed(1).replace(".", ",").replace(/,0$/, "");
  return `${text} ${units[unit]}`;
}

/** Data do envio no formato do Brasil, no fuso do navegador: "05/03/2026". */
export function formatUploadDate(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleDateString("pt-BR");
}
