import type { ChangeEvent, ComponentProps } from "react";

import { Input } from "@/components/ui/input";
import { currentIntlLocale } from "@/i18n";

// Digita como numa calculadora: cada digito entra pela direita, os ultimos viram centavos.
// Formata sozinho (separador de milhar e decimal) a cada tecla, sem exigir "." nem "," do usuario.

function digitsOf(text: string): string {
  return text.replace(/\D/g, "");
}

function formatDigits(digits: string, places: number, locale: string): string {
  const decimal = locale.toLowerCase().startsWith("pt") ? "," : ".";
  const group = decimal === "," ? "." : ",";
  const trimmed = digits.replace(/^0+(?=\d)/, "");
  const padded = trimmed.padStart(places + 1, "0");
  const integer = places > 0 ? padded.slice(0, -places) : padded;
  const fraction = places > 0 ? padded.slice(-places) : "";
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return places > 0 ? `${grouped}${decimal}${fraction}` : grouped;
}

type Props = Omit<ComponentProps<typeof Input>, "value" | "onChange" | "type" | "inputMode"> & {
  // Mesmo texto que parseMoneyInput espera: pode vir no formato da API ("1234.50") ou ja
  // digitado ("1.234,50"), tanto faz, so os digitos importam.
  value: string;
  onChange: (text: string) => void;
  places: number;
  // Mantem o "-" na frente (lancamento rapido: menos vira saida, sem sinal vira entrada)
  signed?: boolean;
};

function format(value: string, places: number, locale: string, signed: boolean): string {
  const digits = digitsOf(value);
  const negative = signed && /^\s*-/.test(value);
  if (!digits) return negative ? "-" : "";
  return `${negative ? "-" : ""}${formatDigits(digits, places, locale)}`;
}

export function MoneyInput({ value, onChange, places, signed = false, ...props }: Props) {
  const locale = currentIntlLocale();
  const display = format(value, places, locale, signed);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onChange(format(event.target.value, places, locale, signed));
  }

  return (
    <Input
      {...props}
      inputMode="numeric"
      autoComplete={props.autoComplete ?? "off"}
      value={display}
      onChange={handleChange}
    />
  );
}
