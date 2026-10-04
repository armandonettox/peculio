import { describe, expect, it } from "vitest";

import type { ImportMapping } from "@/api/imports";

import {
  buildMapping,
  columnLabel,
  emptyMappingForm,
  formFromMapping,
  sampleTable,
  validateMapping,
  type MappingForm,
} from "./mapping-model";

const filled = (overrides: Partial<MappingForm> = {}): MappingForm => ({
  hasHeader: true,
  dateColumn: "0",
  descriptionColumn: "1",
  amountMode: "single",
  amountColumn: "2",
  debitColumn: "",
  creditColumn: "",
  ...overrides,
});

describe("formFromMapping", () => {
  it("sem mapeamento volta tudo vazio, com cabecalho presumido", () => {
    expect(formFromMapping(null)).toEqual(emptyMappingForm());
    expect(formFromMapping(undefined)).toEqual(emptyMappingForm());
    expect(emptyMappingForm()).toMatchObject({ hasHeader: true, amountMode: "single", dateColumn: "", amountColumn: "" });
  });

  it("reabre uma coluna de valor", () => {
    expect(
      formFromMapping({ date_column: 0, description_column: 1, amount_column: 2, debit_column: null, credit_column: null, has_header: true }),
    ).toEqual(filled());
  });

  it("reabre debito e credito e a coluna zero nao vira vazio", () => {
    expect(
      formFromMapping({ date_column: 0, description_column: 1, amount_column: null, debit_column: 0 + 2, credit_column: 3, has_header: false }),
    ).toEqual(filled({ amountMode: "split", amountColumn: "", debitColumn: "2", creditColumn: "3", hasHeader: false }));
    expect(formFromMapping({ date_column: 0, description_column: 1, amount_column: 0, has_header: true }).amountColumn).toBe("0");
  });

  it("sem o campo da coluna unica (ausente, nao nulo) tambem abre como debito e credito", () => {
    const form = formFromMapping({ date_column: 0, description_column: 1, debit_column: 2, credit_column: 3, has_header: true });
    expect(form.amountMode).toBe("split");
    expect(form.debitColumn).toBe("2");
  });

  it("o cabecalho fica marcado quando o servidor nao diz", () => {
    // O tipo gerado exige o campo, mas um servidor mais antigo pode nao mandar
    expect(formFromMapping({ date_column: 0, description_column: 1, amount_column: 2 } as ImportMapping).hasHeader).toBe(true);
  });
});

describe("validateMapping", () => {
  it("escolhas validas nao tem erro", () => {
    expect(validateMapping(filled(), 3)).toEqual({});
    expect(validateMapping(filled({ amountMode: "split", amountColumn: "", debitColumn: "2", creditColumn: "3" }), 4)).toEqual({});
  });

  it("pede cada coluna que falta, com a mensagem da informacao", () => {
    expect(validateMapping(emptyMappingForm(), 3)).toEqual({
      dateColumn: "Escolha a coluna da data.",
      descriptionColumn: "Escolha a coluna da descrição.",
      amountColumn: "Escolha a coluna do valor.",
    });
    expect(validateMapping({ ...emptyMappingForm(), amountMode: "split" }, 3)).toEqual({
      dateColumn: "Escolha a coluna da data.",
      descriptionColumn: "Escolha a coluna da descrição.",
      debitColumn: "Escolha a coluna de débito.",
      creditColumn: "Escolha a coluna de crédito.",
    });
  });

  it("a coluna zero e uma escolha valida", () => {
    expect(validateMapping(filled({ dateColumn: "0", descriptionColumn: "1", amountColumn: "2" }), 3)).toEqual({});
  });

  it("recusa coluna que nao existe no arquivo", () => {
    expect(validateMapping(filled({ amountColumn: "3" }), 3)).toEqual({ amountColumn: "Essa coluna não existe no arquivo." });
    expect(validateMapping(filled({ amountColumn: "2" }), 3)).toEqual({});
    expect(validateMapping(filled({ dateColumn: "-1" }), 3)).toEqual({ dateColumn: "Essa coluna não existe no arquivo." });
    expect(validateMapping(filled({ dateColumn: "abc" }), 3)).toEqual({ dateColumn: "Essa coluna não existe no arquivo." });
  });

  it("recusa a mesma coluna para duas informacoes, apontando a segunda", () => {
    expect(validateMapping(filled({ descriptionColumn: "0" }), 3)).toEqual({
      descriptionColumn: "Cada informação precisa de uma coluna diferente.",
    });
    expect(validateMapping(filled({ amountColumn: "1" }), 3)).toEqual({
      amountColumn: "Cada informação precisa de uma coluna diferente.",
    });
    expect(
      validateMapping(filled({ amountMode: "split", amountColumn: "", debitColumn: "2", creditColumn: "2" }), 3),
    ).toEqual({ creditColumn: "Cada informação precisa de uma coluna diferente." });
  });

  it("ignora o que sobrou do outro modo de valor", () => {
    // Trocou para debito e credito mas a coluna unica ainda guarda um numero antigo
    expect(
      validateMapping(filled({ amountMode: "split", amountColumn: "0", debitColumn: "2", creditColumn: "3" }), 4),
    ).toEqual({});
  });
});

describe("buildMapping", () => {
  it("monta o corpo de uma coluna de valor", () => {
    expect(buildMapping(filled({ dateColumn: "3", descriptionColumn: "1", amountColumn: "0" }))).toEqual({
      date_column: 3,
      description_column: 1,
      amount_column: 0,
      has_header: true,
    });
  });

  it("monta o corpo de debito e credito, sem coluna unica", () => {
    const body = buildMapping(filled({ amountMode: "split", amountColumn: "9", debitColumn: "2", creditColumn: "3", hasHeader: false }));
    expect(body).toEqual({ date_column: 0, description_column: 1, debit_column: 2, credit_column: 3, has_header: false });
    expect("amount_column" in body).toBe(false);
  });
});

describe("sampleTable", () => {
  const withHeader = {
    columns: ["Data", "Texto", "Valor"],
    sample: [
      ["05/03", "Mercado", "-50,00"],
      ["06/03", "Salario", "1000,00"],
    ],
    mapping: null,
  };

  it("lido com cabecalho e a pessoa quer cabecalho: nada muda", () => {
    expect(sampleTable(withHeader, true)).toEqual({ headers: withHeader.columns, rows: withHeader.sample });
  });

  it("lido com cabecalho mas a primeira linha e dado: ela desce e as colunas ganham nome generico", () => {
    expect(sampleTable(withHeader, false)).toEqual({
      headers: ["Coluna 1", "Coluna 2", "Coluna 3"],
      rows: [["Data", "Texto", "Valor"], ...withHeader.sample],
    });
  });

  it("a amostra continua com no maximo 5 linhas quando a primeira desce", () => {
    const five = Array.from({ length: 5 }, (_, n) => [`0${n}/03`, "x", "1,00"]);
    const table = sampleTable({ ...withHeader, sample: five }, false);
    expect(table.rows).toHaveLength(5);
    expect(table.rows[0]).toEqual(["Data", "Texto", "Valor"]);
    expect(table.rows[4]).toEqual(five[3]);
  });

  const withoutHeader = {
    columns: ["Coluna 1", "Coluna 2", "Coluna 3"],
    sample: [
      ["Data", "Texto", "Valor"],
      ["05/03", "Mercado", "-50,00"],
    ],
    mapping: { date_column: 0, description_column: 1, amount_column: 2, has_header: false },
  };

  it("lido sem cabecalho e a pessoa quer sem cabecalho: nada muda", () => {
    expect(sampleTable(withoutHeader, false)).toEqual({ headers: withoutHeader.columns, rows: withoutHeader.sample });
  });

  it("lido sem cabecalho mas a primeira linha e o cabecalho: ela sobe", () => {
    expect(sampleTable(withoutHeader, true)).toEqual({
      headers: ["Data", "Texto", "Valor"],
      rows: [["05/03", "Mercado", "-50,00"]],
    });
  });

  it("sem amostra nenhuma nao quebra", () => {
    expect(sampleTable({ columns: null, sample: null, mapping: null }, true)).toEqual({ headers: [], rows: [] });
    expect(sampleTable({ columns: null, sample: null, mapping: { date_column: 0, description_column: 1, has_header: false } }, true)).toEqual({
      headers: [],
      rows: [],
    });
  });

  it("uma linha mais larga que o cabecalho aumenta o numero de colunas genericas", () => {
    const table = sampleTable({ columns: ["a", "b"], sample: [["1", "2", "3"]], mapping: null }, false);
    expect(table.headers).toEqual(["Coluna 1", "Coluna 2", "Coluna 3"]);
  });
});

describe("columnLabel", () => {
  it("numera a partir de 1 e usa o nome", () => {
    expect(columnLabel(0, "Data")).toBe("1. Data");
    expect(columnLabel(2, "  Valor  ")).toBe("3. Valor");
  });

  it("nome vazio ou ausente vira (sem nome)", () => {
    expect(columnLabel(1, "")).toBe("2. (sem nome)");
    expect(columnLabel(1, "   ")).toBe("2. (sem nome)");
    expect(columnLabel(4, undefined)).toBe("5. (sem nome)");
  });
});
