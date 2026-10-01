import { render, screen } from "@testing-library/react";
import { Landmark } from "lucide-react";
import { expect, it } from "vitest";

import { Button } from "@/components/ui/button";
import { EmptyState } from "./empty-state";
import { PageHeader } from "./page-header";

it("PageHeader mostra titulo, descricao e acoes", () => {
  render(
    <PageHeader title="Contas" description="Suas contas" actions={<Button>Nova conta</Button>} />,
  );
  expect(screen.getByRole("heading", { level: 1, name: "Contas" })).toBeInTheDocument();
  expect(screen.getByText("Suas contas")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Nova conta" })).toBeInTheDocument();
});

it("PageHeader funciona so com o titulo", () => {
  render(<PageHeader title="Contas" />);
  expect(screen.getByRole("heading", { name: "Contas" })).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("EmptyState mostra titulo, descricao e a acao opcional", () => {
  render(
    <EmptyState
      icon={Landmark}
      title="Nada aqui"
      description="Cadastre algo"
      action={<Button>Criar</Button>}
    />,
  );
  expect(screen.getByRole("heading", { level: 2, name: "Nada aqui" })).toBeInTheDocument();
  expect(screen.getByText("Cadastre algo")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Criar" })).toBeInTheDocument();
});

it("EmptyState sem acao nao mostra botao", () => {
  render(<EmptyState icon={Landmark} title="Nada aqui" description="Cadastre algo" />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
