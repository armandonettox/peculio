import type { BulkAction } from "@/api/bulk";

// Os textos da acao em massa, sem tela: o aviso de sucesso e o resumo dos lancamentos travados.

export function entriesText(count: number): string {
  return count === 1 ? "1 lançamento" : `${count} lançamentos`;
}

/** O aviso depois de uma acao que deu certo. `categoryCleared`: a categoria foi tirada, nao trocada. */
export function bulkNotice(action: BulkAction, count: number, categoryCleared = false): string {
  const entries = entriesText(count);
  switch (action) {
    case "set_category":
      return categoryCleared ? `Categoria removida de ${entries}.` : `Categoria mudada em ${entries}.`;
    case "set_date":
      return `Data mudada em ${entries}.`;
    case "duplicate":
      return `${entries} ${count === 1 ? "duplicado" : "duplicados"} com a data de hoje.`;
    case "delete":
      return `${entries} ${count === 1 ? "excluído" : "excluídos"}.`;
  }
}

const SHOWN_LOCKED = 5;

/** Os travados pelo nome, para a pessoa saber o que desmarcar: ate 5 e "e mais N". */
export function lockedSummary(titles: string[]): string {
  const shown = titles.slice(0, SHOWN_LOCKED).join(", ");
  const rest = titles.length - SHOWN_LOCKED;
  return rest > 0 ? `${shown} e mais ${rest}` : shown;
}
