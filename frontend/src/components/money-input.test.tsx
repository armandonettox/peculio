import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { i18n } from "@/i18n";
import { MoneyInput } from "./money-input";

afterEach(async () => {
  await i18n.changeLanguage("pt-BR");
});

// Guarda o estado como quem usa o componente faria, para testar o comportamento real de digitar.
function Harness({ places }: { places: number }) {
  const [value, setValue] = useState("");
  return <MoneyInput aria-label="valor" value={value} onChange={setValue} places={places} />;
}

describe("MoneyInput", () => {
  it("formata com milhar e centavos conforme digita (pt-BR)", async () => {
    render(<Harness places={2} />);
    await userEvent.type(screen.getByLabelText("valor"), "123456");
    expect(screen.getByLabelText("valor")).toHaveValue("1.234,56");
  });

  it("apaga da direita para a esquerda com backspace", async () => {
    render(<Harness places={2} />);
    const input = screen.getByLabelText("valor");
    await userEvent.type(input, "1500");
    expect(input).toHaveValue("15,00");
    await userEvent.type(input, "{backspace}{backspace}");
    expect(input).toHaveValue("0,15");
  });

  it("ignora letras e outros caracteres nao numericos", async () => {
    render(<Harness places={2} />);
    const input = screen.getByLabelText("valor");
    await userEvent.type(input, "abc12de34");
    expect(input).toHaveValue("12,34");
  });

  it("sem casas decimais (places=0) nao mostra separador decimal", async () => {
    render(<Harness places={0} />);
    const input = screen.getByLabelText("valor");
    await userEvent.type(input, "12345");
    expect(input).toHaveValue("12.345");
  });

  it("formata com virgula de milhar e ponto decimal em ingles", async () => {
    await i18n.changeLanguage("en");
    render(<Harness places={2} />);
    const input = screen.getByLabelText("valor");
    await userEvent.type(input, "123456");
    expect(input).toHaveValue("1,234.56");
  });

  it("aceita o valor inicial ja no formato da API (ponto decimal)", () => {
    function WithInitial() {
      const [value, setValue] = useState("1234.50");
      return <MoneyInput aria-label="valor" value={value} onChange={setValue} places={2} />;
    }
    render(<WithInitial />);
    expect(screen.getByLabelText("valor")).toHaveValue("1.234,50");
  });

  it("campo vazio fica vazio", () => {
    render(<Harness places={2} />);
    expect(screen.getByLabelText("valor")).toHaveValue("");
  });

  describe("signed", () => {
    function SignedHarness() {
      const [value, setValue] = useState("");
      return <MoneyInput aria-label="valor" value={value} onChange={setValue} places={2} signed />;
    }

    it("mantem o menos na frente", async () => {
      render(<SignedHarness />);
      const input = screen.getByLabelText("valor");
      await userEvent.type(input, "-1500");
      expect(input).toHaveValue("-15,00");
    });

    it("sem sinal nao aparece menos", async () => {
      render(<SignedHarness />);
      const input = screen.getByLabelText("valor");
      await userEvent.type(input, "1500");
      expect(input).toHaveValue("15,00");
    });

    it("apagar o menos volta a ser positivo", async () => {
      render(<SignedHarness />);
      const input = screen.getByLabelText("valor");
      await userEvent.type(input, "-1500");
      expect(input).toHaveValue("-15,00");
      await userEvent.type(input, "{Home}{Delete}");
      expect(input).toHaveValue("15,00");
    });
  });
});
