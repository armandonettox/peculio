import { useTranslation } from "react-i18next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useTheme, type Theme } from "@/hooks/use-theme";
import { changeLanguage } from "@/i18n";
import { LANGUAGES, LANGUAGE_NAMES, type Language } from "@/i18n/languages";

const THEMES: { value: Theme; label: "light" | "dark" | "system"; hint: "lightHint" | "darkHint" | "systemHint" }[] = [
  { value: "light", label: "light", hint: "lightHint" },
  { value: "dark", label: "dark", hint: "darkHint" },
  { value: "system", label: "system", hint: "systemHint" },
];

/** O tema e o idioma do app. A escolha fica neste navegador; o botao do topo muda o mesmo tema. */
export function AppearanceSection() {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const language: Language = i18n.language === "en" ? "en" : "pt-BR";

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t("appearance.title")}</CardTitle>
        <CardDescription>{t("appearance.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div role="radiogroup" aria-label={t("appearance.theme.label")} className="flex flex-col gap-3">
          {THEMES.map((option) => (
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
                <span className="font-medium">{t(`appearance.theme.${option.label}`)}</span>
                <span className="text-xs text-muted-foreground">{t(`appearance.theme.${option.hint}`)}</span>
              </span>
            </label>
          ))}
        </div>

        <div role="radiogroup" aria-label={t("appearance.language.label")} className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">{t("appearance.language.hint")}</p>
          {LANGUAGES.map((option) => (
            <label key={option} className="flex cursor-pointer items-center gap-3 text-sm">
              <input
                type="radio"
                name="language"
                value={option}
                checked={language === option}
                onChange={() => void changeLanguage(option)}
                className="accent-[var(--primary)]"
                // O nome do idioma fica na propria lingua, independente do idioma da tela
                lang={option}
              />
              <span lang={option} className="font-medium">
                {LANGUAGE_NAMES[option]}
              </span>
            </label>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
