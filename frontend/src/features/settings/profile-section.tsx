import { useState, type FormEvent } from "react";

import { useCurrencies } from "@/api/accounts";
import { useUpdateProfile } from "@/api/account";
import { getErrorMessage } from "@/api/error-messages";
import { useAuth } from "@/auth/auth-context";
import { FormField } from "@/components/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { profileChanges, profileErrors, type ProfileErrors } from "./model";
import { useTranslation } from "react-i18next";

/** Nome e moeda padrao da conta. O e-mail aparece mas nao se troca: trocar exigiria confirmar por e-mail. */
export function ProfileSection() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const currencies = useCurrencies();
  const update = useUpdateProfile();
  // O que esta salvo agora: o usuario do app no inicio e, depois de cada Salvar, o que o servidor devolveu
  const [saved, setSaved] = useState({ name: user?.name ?? "", default_currency: user?.default_currency ?? "BRL" });
  const [name, setName] = useState(user?.name ?? "");
  const [currency, setCurrency] = useState(user?.default_currency ?? "BRL");
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  if (!user) return null;
  const changes = profileChanges({ name, currency }, saved);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    setServerError(null);
    const found = profileErrors({ name, currency });
    setErrors(found);
    if (Object.keys(found).length > 0) {
      document.getElementById(found.name ? "settings-name" : "settings-currency")?.focus();
      return;
    }
    if (!changes) return;
    try {
      const result = await update.mutateAsync(changes);
      setSaved({ name: result.name, default_currency: result.default_currency });
      setName(result.name);
      setCurrency(result.default_currency);
      setNotice(t("settings.profileSection.perfilSalvo"));
    } catch (failure) {
      setServerError(getErrorMessage(failure));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t("settings.profileSection.perfil")}</CardTitle>
        <CardDescription>{t("settings.profileSection.comoVoceApareceNo")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
          {serverError && <Alert variant="destructive">{serverError}</Alert>}
          {notice && (
            <p role="status" className="rounded-md border bg-accent/30 px-3 py-2 text-sm">
              {notice}
            </p>
          )}

          <FormField id="settings-name" label={t("common.nome")} error={errors.name}>
            {(field) => (
              <Input
                {...field}
                autoComplete="name"
                value={name}
                disabled={update.isPending}
                onChange={(event) => {
                  setName(event.target.value);
                  setErrors((current) => ({ ...current, name: undefined }));
                  setNotice(null);
                }}
              />
            )}
          </FormField>

          <FormField id="settings-email" label={t("common.eMail")} hint={t("settings.profileSection.oEMailNao")}>
            {(field) => <Input {...field} value={user.email} readOnly />}
          </FormField>

          <FormField id="settings-currency" label={t("settings.profileSection.moedaPadrao")} error={errors.currency}>
            {(field) => (
              <Select
                {...field}
                value={currency}
                disabled={update.isPending}
                onChange={(event) => {
                  setCurrency(event.target.value);
                  setErrors((current) => ({ ...current, currency: undefined }));
                  setNotice(null);
                }}
              >
                {(currencies.data ?? []).map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.code} · {item.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <div>
            <Button type="submit" disabled={update.isPending || !changes}>
              {update.isPending ? t("settings.profileSection.salvando") : t("settings.profileSection.salvarPerfil")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
