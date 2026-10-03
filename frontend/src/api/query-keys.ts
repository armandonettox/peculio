// Chaves de cache que mais de um arquivo da API precisa invalidar. Ficam aqui, sem importar
// nada, para dois arquivos nao se importarem de volta (ex: transacoes e orcamentos).
export const budgetsKey = ["budgets"] as const;
export const billsKey = ["bills"] as const;
export const recurrencesKey = ["recurrences"] as const;
export const piggyBanksKey = ["piggy-banks"] as const;
export const webhooksKey = ["webhooks"] as const;
export const reportsKey = ["reports"] as const;
export const attachmentsKey = ["attachments"] as const;
export const rulesKey = ["rules"] as const;
export const dashboardKey = ["dashboard"] as const;
