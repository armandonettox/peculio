import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useTheme, type Theme } from "@/hooks/use-theme";

const OPTIONS: { value: Theme; label: string; hint: string }[] = [
  { value: "light", label: "Claro", hint: "Fundo claro o tempo todo." },
  { value: "dark", label: "Escuro", hint: "Fundo escuro o tempo todo." },
  { value: "system", label: "Do sistema", hint: "Acompanha o tema do seu aparelho." },
];

/** O tema do app. A escolha fica neste navegador; o botao do topo muda a mesma coisa. */
export function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Aparência</CardTitle>
        <CardDescription>A escolha vale neste navegador.</CardDescription>
      </CardHeader>
      <CardContent>
        <div role="radiogroup" aria-label="Tema" className="flex flex-col gap-3">
          {OPTIONS.map((option) => (
            <label key={option.value} className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="radio"
                name="theme"
                value={option.value}
                checked={theme === option.value}
                onChange={() => setTheme(option.value)}
                className="mt-0.5 accent-[var(--primary)]"
              />
              <span className="flex flex-col">
                <span className="font-medium">{option.label}</span>
                <span className="text-xs text-muted-foreground">{option.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
