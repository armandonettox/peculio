import { http, HttpResponse } from "msw";

import type { Invoice } from "@/api/invoices";

/** Fatura de mentira: o teste escolhe o conteudo, a API falsa so devolve (ou recusa). */
export function fakeInvoicesApi(invoice: Invoice | null, { error }: { error?: { status: number; code: string } } = {}) {
  const requests: URLSearchParams[] = [];

  const handler = http.get("*/api/v1/accounts/:accountId/invoice", ({ request }) => {
    requests.push(new URL(request.url).searchParams);
    if (error) return HttpResponse.json({ detail: "erro", code: error.code }, { status: error.status });
    if (!invoice) return HttpResponse.json({ detail: "erro", code: "account_not_credit_card" }, { status: 400 });
    return HttpResponse.json(invoice);
  });

  return { handlers: [handler], requests };
}

let splitCounter = 0;

export function makeInvoiceSplit(overrides: Partial<Invoice["splits"][number]> = {}): Invoice["splits"][number] {
  splitCounter += 1;
  return {
    id: `e0000000-0000-4000-8000-${String(splitCounter).padStart(12, "0")}`,
    date: "2026-03-10",
    description: `Compra ${splitCounter}`,
    amount: "50.00",
    currency_code: "BRL",
    ...overrides,
  };
}

export function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    account_id: "a0000000-0000-4000-8000-000000000001",
    currency_code: "BRL",
    period_start: "2026-02-11",
    period_end: "2026-03-10",
    due_date: "2026-03-17",
    total: "50.00",
    splits: [makeInvoiceSplit()],
    ...overrides,
  };
}
