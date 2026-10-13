import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

type Props = {
  // Com `to`, a marca vira um link (no app, leva ao painel inicial); sem ele, e so a marca (telas de entrada)
  to?: string;
  onNavigate?: () => void;
};

export function Brand({ to, onNavigate }: Props) {
  const { t } = useTranslation();
  const content = (
    <>
      <img src="/favicon.svg" alt="" width={32} height={32} className="size-8 rounded-md" />
      <span className="text-base font-semibold text-primary-text">Pecúlio</span>
    </>
  );

  if (!to) return <div className="flex items-center gap-2">{content}</div>;

  return (
    <Link
      to={to}
      onClick={onNavigate}
      title={t("components.appShell.irParaOPainel")}
      className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {content}
    </Link>
  );
}
