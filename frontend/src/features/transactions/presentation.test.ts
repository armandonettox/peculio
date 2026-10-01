import { describe, expect, it } from "vitest";

import { deposit, makeSplit, makeTransaction, transfer } from "@/test-utils/transaction-fixtures";
import {
  counterpartyLabel,
  directionOf,
  foreignNote,
  formatSplitAmount,
  formatTransactionAmount,
  groupByDay,
  ownAccountName,
  transactionDate,
  transactionTitle,
} from "./presentation";

// O Intl usa espaco sem quebra (U+00A0) entre o simbolo e o numero
const nbsp = (text: string) => text.replaceAll(" ", " ");

describe("directionOf", () => {
  it("saque sai, deposito entra, transferencia e neutra", () => {
    expect(directionOf(makeSplit({ type: "withdrawal" }))).toBe("out");
    expect(directionOf(makeSplit({ type: "deposit" }))).toBe("in");
    expect(directionOf(makeSplit({ type: "transfer" }))).toBe("neutral");
  });
});

describe("counterpartyLabel e ownAccountName", () => {
  it("saque: a contraparte e o destino e a conta e a origem", () => {
    const split = makeSplit();
    expect(counterpartyLabel(split)).toBe("Supermercado");
    expect(ownAccountName(split)).toBe("Nubank");
  });

  it("deposito: a contraparte e a origem e a conta e o destino", () => {
    const split = deposit();
    expect(counterpartyLabel(split)).toBe("Empregador");
    expect(ownAccountName(split)).toBe("Nubank");
  });

  it("transferencia: mostra A → B e nao tem uma conta so", () => {
    const split = transfer();
    expect(counterpartyLabel(split)).toBe("Nubank → Poupanca");
    expect(ownAccountName(split)).toBeNull();
  });

  it("pagamento de divida e um saque para a conta de passivo", () => {
    const split = makeSplit({ destination_account_name: "Financiamento", destination_account_type: "liability" });
    expect(counterpartyLabel(split)).toBe("Financiamento");
    expect(directionOf(split)).toBe("out");
  });
});

describe("formatSplitAmount", () => {
  it("saida com sinal de menos", () => {
    expect(formatSplitAmount(makeSplit({ amount: "50.00" }))).toBe(nbsp("-R$ 50,00"));
  });

  it("entrada com sinal de mais", () => {
    expect(formatSplitAmount(deposit({ amount: "3000.00" }))).toBe(nbsp("+R$ 3.000,00"));
  });

  it("transferencia sem sinal", () => {
    expect(formatSplitAmount(transfer({ amount: "100.00" }))).toBe(nbsp("R$ 100,00"));
  });

  it("transferencia entre moedas mostra o que saiu e o que chegou", () => {
    const split = transfer({ amount: "500.00", foreign_amount: "100.00", foreign_currency_code: "USD" });
    expect(formatSplitAmount(split)).toBe(`${nbsp("R$ 500,00")} → ${nbsp("US$ 100,00")}`);
  });

  it("valor original de compra em outra moeda nao entra no valor principal", () => {
    const split = makeSplit({ amount: "50.00", foreign_amount: "10.00", foreign_currency_code: "USD" });
    expect(formatSplitAmount(split)).toBe(nbsp("-R$ 50,00"));
  });

  it("outras moedas e iene sem centavos", () => {
    expect(formatSplitAmount(makeSplit({ amount: "20.00", currency_code: "USD" }))).toBe(nbsp("-US$ 20,00"));
    expect(formatSplitAmount(makeSplit({ amount: "100", currency_code: "JPY" }))).toBe(nbsp("-JP¥ 100"));
  });
});

describe("foreignNote", () => {
  it("avisa o valor original em compra de outra moeda", () => {
    const split = makeSplit({ foreign_amount: "10.00", foreign_currency_code: "USD" });
    expect(foreignNote(split)).toBe(`Valor original: ${nbsp("US$ 10,00")}`);
  });

  it("nao mostra nada sem valor estrangeiro nem em transferencia", () => {
    expect(foreignNote(makeSplit())).toBeNull();
    expect(foreignNote(transfer({ foreign_amount: "100.00", foreign_currency_code: "USD" }))).toBeNull();
  });
});

describe("transactionTitle e transactionDate", () => {
  it("usa o titulo do grupo e, sem ele, a descricao do primeiro split", () => {
    expect(transactionTitle(makeTransaction({ title: "Compras da semana" }))).toBe("Compras da semana");
    expect(transactionTitle(makeTransaction({}, [{ description: "Padaria" }]))).toBe("Padaria");
  });

  it("a data do grupo e a mais recente entre os splits", () => {
    const t = makeTransaction({}, [{ date: "2026-03-01" }, { date: "2026-03-15" }, { date: "2026-03-05" }]);
    expect(transactionDate(t)).toBe("2026-03-15");
  });
});

describe("formatTransactionAmount", () => {
  it("um split: igual ao do split", () => {
    const t = makeTransaction({}, [{ amount: "50.00" }]);
    expect(formatTransactionAmount(t)).toBe(nbsp("-R$ 50,00"));
  });

  it("varios splits do mesmo tipo: soma exata, sem erro de float", () => {
    const t = makeTransaction({}, [{ amount: "0.10" }, { amount: "0.20" }]);
    expect(formatTransactionAmount(t)).toBe(nbsp("-R$ 0,30"));
  });

  it("soma de entradas leva o sinal de mais", () => {
    const t = makeTransaction({}, []);
    t.splits = [deposit({ amount: "100.00" }), deposit({ amount: "50.50" })];
    expect(formatTransactionAmount(t)).toBe(nbsp("+R$ 150,50"));
  });

  it("transferencia entre moedas com um split so mostra o que saiu e o que chegou", () => {
    const t = makeTransaction({}, []);
    t.splits = [transfer({ amount: "500.00", foreign_amount: "100.00", foreign_currency_code: "USD" })];
    expect(formatTransactionAmount(t)).toBe(`${nbsp("R$ 500,00")} → ${nbsp("US$ 100,00")}`);
  });

  it("sentidos diferentes nao somam", () => {
    const t = makeTransaction({}, []);
    t.splits = [makeSplit({ amount: "10.00" }), deposit({ amount: "20.00" })];
    expect(formatTransactionAmount(t)).toBeNull();
  });

  it("moedas diferentes nao somam", () => {
    const t = makeTransaction({}, [{ amount: "10.00" }, { amount: "5.00", currency_code: "USD" }]);
    expect(formatTransactionAmount(t)).toBeNull();
  });

  it("transferencia entre moedas nao soma", () => {
    const t = makeTransaction({}, []);
    t.splits = [
      transfer({ amount: "10.00", foreign_amount: "2.00", foreign_currency_code: "USD" }),
      transfer({ amount: "10.00", foreign_amount: "2.00", foreign_currency_code: "USD" }),
    ];
    expect(formatTransactionAmount(t)).toBeNull();
  });

  it("sem splits devolve null", () => {
    expect(formatTransactionAmount(makeTransaction({ splits: [] }))).toBeNull();
  });
});

describe("groupByDay", () => {
  const today = "2026-03-12";
  const at = (date: string, description = "x") => makeTransaction({}, [{ date, description }]);

  it("agrupa lancamentos seguidos do mesmo dia", () => {
    const groups = groupByDay([at("2026-03-12", "a"), at("2026-03-12", "b"), at("2026-03-10", "c")], today);
    expect(groups.map((g) => [g.date, g.label, g.items.length])).toEqual([
      ["2026-03-12", "Hoje", 2],
      ["2026-03-10", "Terça-feira, 10 de março de 2026", 1],
    ]);
  });

  it("chama o dia anterior de Ontem", () => {
    expect(groupByDay([at("2026-03-11")], today)[0].label).toBe("Ontem");
  });

  it("um dia que continua na pagina seguinte nao se divide em dois", () => {
    const firstPage = [at("2026-03-10", "a")];
    const secondPage = [at("2026-03-10", "b"), at("2026-03-09", "c")];
    const groups = groupByDay([...firstPage, ...secondPage], today);
    expect(groups.map((g) => g.items.length)).toEqual([2, 1]);
  });

  it("usa a data mais recente do grupo para escolher o dia", () => {
    const t = makeTransaction({}, [{ date: "2026-03-01" }, { date: "2026-03-10" }]);
    expect(groupByDay([t], today)[0].date).toBe("2026-03-10");
  });

  it("lista vazia nao gera grupos", () => {
    expect(groupByDay([], today)).toEqual([]);
  });
});
