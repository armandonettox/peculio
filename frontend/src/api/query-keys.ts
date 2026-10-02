// Chaves de cache que mais de um arquivo da API precisa invalidar. Ficam aqui, sem importar
// nada, para dois arquivos nao se importarem de volta (ex: transacoes e orcamentos).
export const budgetsKey = ["budgets"] as const;
export const billsKey = ["bills"] as const;
