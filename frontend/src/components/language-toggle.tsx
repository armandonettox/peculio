import { Languages } from "lucide-react";

import { Button } from "@/components/ui/button";
import { changeLanguage } from "@/i18n";
import { useTranslation } from "react-i18next";

/** Troca entre portugues e ingles. So dois idiomas: um clique basta, como o tema. */
export function LanguageToggle() {
  const { t, i18n } = useTranslation();
  const isEnglish = i18n.language === "en";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => void changeLanguage(isEnglish ? "pt-BR" : "en")}
      aria-label={isEnglish ? t("components.languageToggle.switchToPortuguese") : t("components.languageToggle.switchToEnglish")}
    >
      <Languages />
    </Button>
  );
}
