import { ArrowLeftRight, Landmark, LayoutDashboard, PiggyBank, Plus, Target, UserPlus, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useUpdateProfile } from "@/api/account";
import { useAuth } from "@/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// O menu do usuario avisa por aqui que a pessoa quer rever o passo a passo (o menu e o tour moram em lugares diferentes)
export const OPEN_TOUR_EVENT = "peculio:open-tour";

type StepKey = "welcome" | "accounts" | "entries" | "planning" | "goals" | "home" | "invites";
type GoKey = "tour.steps.accounts.go" | "tour.steps.planning.go" | "tour.steps.goals.go" | "tour.steps.home.go" | "tour.steps.invites.go";
// Os passos que levam a uma tela trazem o destino e a chave do texto do botao
type Step = { key: StepKey; icon: LucideIcon; to?: string; goKey?: GoKey };

// Os passos do primeiro uso, na ordem em que uma pessoa nova precisa deles
const STEPS: Step[] = [
  { key: "welcome", icon: PiggyBank },
  { key: "accounts", icon: Landmark, to: "/contas", goKey: "tour.steps.accounts.go" },
  { key: "entries", icon: Plus },
  { key: "planning", icon: Target, to: "/orcamentos", goKey: "tour.steps.planning.go" },
  { key: "goals", icon: ArrowLeftRight, to: "/objetivos", goKey: "tour.steps.goals.go" },
  { key: "home", icon: LayoutDashboard, to: "/configuracoes?aba=painel", goKey: "tour.steps.home.go" },
  { key: "invites", icon: UserPlus, to: "/configuracoes?aba=convites", goKey: "tour.steps.invites.go" },
];

/**
 * Passo a passo do primeiro uso, para todo mundo. Abre sozinho uma vez (o servidor guarda que a pessoa ja viu) e fecha a
 * qualquer momento: "Pular", o X e o Esc contam como visto. O menu do usuario reabre quando quiser.
 */
export function OnboardingTour() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const update = useUpdateProfile();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const pending = user !== null && !user.onboarding_done;

  // Abre sozinho enquanto a pessoa ainda nao viu; depois de fechar, o servidor passa a dizer que viu e nao abre mais
  useEffect(() => {
    if (pending) {
      setIndex(0);
      setOpen(true);
    }
  }, [pending, user?.id]);

  useEffect(() => {
    function reopen() {
      setIndex(0);
      setOpen(true);
    }
    window.addEventListener(OPEN_TOUR_EVENT, reopen);
    return () => window.removeEventListener(OPEN_TOUR_EVENT, reopen);
  }, []);

  function close() {
    setOpen(false);
    // So avisa o servidor quando ainda nao estava marcado; rever pelo menu e fechar de novo nao escreve nada
    if (pending) update.mutate({ onboarding_done: true });
  }

  if (!open) return null;

  const step = STEPS[index];
  const last = index === STEPS.length - 1;
  const Icon = step.icon;

  return (
    <Dialog open onOpenChange={(next) => !next && close()}>
      <DialogContent>
        <DialogHeader>
          <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-hidden="true">
            <Icon className="size-6" />
          </div>
          <DialogTitle>{t(`tour.steps.${step.key}.title`)}</DialogTitle>
          <DialogDescription>{t(`tour.steps.${step.key}.text`)}</DialogDescription>
        </DialogHeader>

        {step.to && step.goKey && (
          <Button asChild variant="outline" className="self-start">
            <Link to={step.to} onClick={close}>
              {t(step.goKey)}
            </Link>
          </Button>
        )}

        <p className="text-xs text-muted-foreground" aria-live="polite">
          {t("tour.progress", { current: index + 1, total: STEPS.length })}
        </p>

        <DialogFooter>
          {!last && (
            <Button type="button" variant="ghost" onClick={close}>
              {t("tour.skip")}
            </Button>
          )}
          {index > 0 && (
            <Button type="button" variant="outline" onClick={() => setIndex(index - 1)}>
              {t("tour.back")}
            </Button>
          )}
          {last ? (
            <Button type="button" onClick={close}>
              {t("tour.finish")}
            </Button>
          ) : (
            <Button type="button" onClick={() => setIndex(index + 1)}>
              {t("tour.next")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
