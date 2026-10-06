import { i18n } from "@/i18n";
import type { BulkAction } from "@/api/bulk";

// Os textos da acao em massa, sem tela: o aviso de sucesso e o resumo dos lancamentos travados.

export function entriesText(count: number): string {
  return i18n.t("transactions.bulk.entries", { count });
}

/** O aviso depois de uma acao que deu certo. `categoryCleared`: a categoria foi tirada, nao trocada. */
export function bulkNotice(action: BulkAction, count: number, categoryCleared = false): string {
  const entries = entriesText(count);
  switch (action) {
    case "set_category":
      return i18n.t(categoryCleared ? "transactions.bulk.categoryRemoved" : "transactions.bulk.categoryChanged", { entries });
    case "set_date":
      return i18n.t("transactions.bulk.dateChanged", { entries });
    case "duplicate":
      return i18n.t("transactions.bulk.duplicated", { count });
    case "delete":
      return i18n.t("transactions.bulk.deleted", { count });
  }
}

const SHOWN_LOCKED = 5;

/** Os travados pelo nome, para a pessoa saber o que desmarcar: ate 5 e "e mais N". */
export function lockedSummary(titles: string[]): string {
  const shown = titles.slice(0, SHOWN_LOCKED).join(", ");
  const rest = titles.length - SHOWN_LOCKED;
  return rest > 0 ? i18n.t("transactions.bulk.andMore", { shown, count: rest }) : shown;
}
