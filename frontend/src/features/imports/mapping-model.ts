import type { ImportMapping, ImportPreview } from "@/api/imports";

// Quantas linhas de amostra o servidor manda (e a tela mostra)
export const SAMPLE_ROWS = 5;

export type AmountMode = "single" | "split";

/** O que a pessoa escolheu na tela de colunas. Cada coluna e o numero dela como texto ("" = nenhuma). */
export type MappingForm = {
  hasHeader: boolean;
  dateColumn: string;
  descriptionColumn: string;
  amountMode: AmountMode;
  amountColumn: string;
  debitColumn: string;
  creditColumn: string;
};

export type MappingErrors = Partial<
  Record<"dateColumn" | "descriptionColumn" | "amountColumn" | "debitColumn" | "creditColumn", string>
>;

export function emptyMappingForm(): MappingForm {
  return {
    hasHeader: true,
    dateColumn: "",
    descriptionColumn: "",
    amountMode: "single",
    amountColumn: "",
    debitColumn: "",
    creditColumn: "",
  };
}

const text = (column: number | null | undefined) => (column === null || column === undefined ? "" : String(column));

/** Reabre o que o servidor usou (ou adivinhou). Sem mapeamento, tudo vazio e o cabecalho presumido. */
export function formFromMapping(mapping: ImportMapping | null | undefined): MappingForm {
  if (!mapping) return emptyMappingForm();
  const split = mapping.amount_column === null || mapping.amount_column === undefined;
  return {
    hasHeader: mapping.has_header ?? true,
    dateColumn: text(mapping.date_column),
    descriptionColumn: text(mapping.description_column),
    amountMode: split ? "split" : "single",
    amountColumn: text(mapping.amount_column),
    debitColumn: text(mapping.debit_column),
    creditColumn: text(mapping.credit_column),
  };
}

/** Confere as escolhas antes de enviar. `width` e quantas colunas o arquivo tem. */
export function validateMapping(form: MappingForm, width: number): MappingErrors {
  const errors: MappingErrors = {};
  const required: [keyof MappingErrors, string, string][] = [
    ["dateColumn", form.dateColumn, "Escolha a coluna da data."],
    ["descriptionColumn", form.descriptionColumn, "Escolha a coluna da descrição."],
  ];
  if (form.amountMode === "single") {
    required.push(["amountColumn", form.amountColumn, "Escolha a coluna do valor."]);
  } else {
    required.push(["debitColumn", form.debitColumn, "Escolha a coluna de débito."]);
    required.push(["creditColumn", form.creditColumn, "Escolha a coluna de crédito."]);
  }

  const used = new Map<string, keyof MappingErrors>();
  for (const [name, value, message] of required) {
    if (value === "") {
      errors[name] = message;
      continue;
    }
    const column = Number(value);
    if (!Number.isInteger(column) || column < 0 || column >= width) {
      errors[name] = "Essa coluna não existe no arquivo.";
    } else if (used.has(value)) {
      errors[name] = "Cada informação precisa de uma coluna diferente.";
    } else {
      used.set(value, name);
    }
  }
  return errors;
}

/** O corpo que o servidor espera. Chame so depois de `validateMapping` sem erros. */
export function buildMapping(form: MappingForm): ImportMapping {
  const base = {
    date_column: Number(form.dateColumn),
    description_column: Number(form.descriptionColumn),
    has_header: form.hasHeader,
  };
  if (form.amountMode === "single") return { ...base, amount_column: Number(form.amountColumn) };
  return { ...base, debit_column: Number(form.debitColumn), credit_column: Number(form.creditColumn) };
}

// ---------- Amostra do arquivo ----------

export type SampleTable = { headers: string[]; rows: string[][] };

const generic = (width: number) => Array.from({ length: width }, (_, index) => `Coluna ${index + 1}`);

/**
 * A amostra do arquivo como a pessoa quer ver agora. O servidor leu o arquivo com ou sem cabecalho (o que foi
 * pedido da ultima vez); se a pessoa mudou de ideia na tela, a primeira linha troca de lugar aqui mesmo, sem
 * pedir de novo: `columns` e a primeira linha lida e `sample` sao as seguintes.
 */
export function sampleTable(preview: Pick<ImportPreview, "columns" | "sample" | "mapping">, wantHeader: boolean): SampleTable {
  const columns = preview.columns ?? [];
  const sample = preview.sample ?? [];
  const readWithHeader = preview.mapping?.has_header ?? true;
  const width = Math.max(columns.length, ...sample.map((row) => row.length), 0);

  if (readWithHeader === wantHeader) return { headers: columns, rows: sample };
  if (readWithHeader) {
    // Lido com cabecalho, mas a primeira linha e dado: ela desce para a amostra
    return { headers: generic(width), rows: [columns, ...sample].slice(0, SAMPLE_ROWS) };
  }
  // Lido sem cabecalho, mas a primeira linha e o cabecalho: ela sobe
  const [first, ...rest] = sample;
  return { headers: first ?? generic(width), rows: rest };
}

/** "1. Data": o numero ajuda quando duas colunas tem o mesmo nome ou nome vazio. */
export function columnLabel(index: number, header: string | undefined): string {
  const name = header?.trim();
  return `${index + 1}. ${name ? name : "(sem nome)"}`;
}
