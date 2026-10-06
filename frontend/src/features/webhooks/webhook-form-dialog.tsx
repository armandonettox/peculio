import { useState, type FormEvent } from "react";

import { getErrorMessage } from "@/api/error-messages";
import { ApiError } from "@/api/errors";
import {
  useCreateWebhook,
  useUpdateWebhook,
  type Webhook,
  type WebhookEventName,
  type WebhookUpdate,
  type WebhookWithSecret,
} from "@/api/webhooks";
import { requiredError } from "@/auth/validation";
import { FormField } from "@/components/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { eventLabel, EVENTS } from "./presentation";
import { useTranslation } from "react-i18next";

type Field = "name" | "url" | "events";
type Errors = Partial<Record<Field, string>>;

const SERVER_FIELDS: Record<string, Field> = { name: "name", url: "url", events: "events" };
const FIELD_ORDER: Field[] = ["name", "url", "events"];

type Props = {
  // Sem `webhook` o dialogo cria; com `webhook` edita
  webhook?: Webhook;
  onClose: () => void;
  // Chamado so na criacao, com o segredo que o servidor mostra uma unica vez
  onCreated?: (created: WebhookWithSecret) => void;
};

// O campo e type=url: o navegador ja tira os espacos do comeco, entao nao ha o que aparar aqui
const isPlainHttp = (value: string) => /^http:\/\//i.test(value);

export function WebhookFormDialog({ webhook, onClose, onCreated }: Props) {
  const { t } = useTranslation();
  const editing = webhook !== undefined;
  const create = useCreateWebhook();
  const update = useUpdateWebhook();

  const [name, setName] = useState(webhook?.name ?? "");
  const [url, setUrl] = useState(webhook?.url ?? "");
  const [events, setEvents] = useState<WebhookEventName[]>(webhook?.events ?? ["transaction.created"]);
  const [active, setActive] = useState(webhook?.active ?? true);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const submitting = create.isPending || update.isPending;

  function clearError(field: Field) {
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  function toggleEvent(event: WebhookEventName) {
    setEvents((current) => (current.includes(event) ? current.filter((item) => item !== event) : [...current, event]));
    clearError("events");
  }

  function focusField(field: Field) {
    // Os eventos sao varias caixas: o foco vai para a primeira
    document.getElementById(field === "events" ? "webhook-event-0" : `webhook-${field}`)?.focus();
  }

  function handleServerError(error: unknown) {
    const message = getErrorMessage(error);
    if (!(error instanceof ApiError)) return setFormError(message);

    const serverErrors: Errors = {};
    for (const item of error.fieldErrors) {
      const field = SERVER_FIELDS[item.field];
      if (field) serverErrors[field] = item.message;
    }
    if (error.code === "webhook_name_taken") serverErrors.name = message;
    if (error.code === "webhook_url_invalid") serverErrors.url = message;

    setErrors(serverErrors);
    const first = FIELD_ORDER.find((field) => serverErrors[field]);
    if (first) focusField(first);
    if (!first || error.code === "validation_error") setFormError(message);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);

    const found: Errors = { name: requiredError(name, t("webhooks.webhookFormDialog.informeONome")) };
    const trimmedUrl = url.trim();
    if (trimmedUrl === "") found.url = t("webhooks.webhookFormDialog.informeOEndereco");
    else if (!/^https?:\/\/\S+$/i.test(trimmedUrl)) found.url = t("webhooks.webhookFormDialog.urlSchemeMessage");
    if (events.length === 0) found.events = t("webhooks.webhookFormDialog.escolhaPeloMenos");

    setErrors(found);
    const firstInvalid = FIELD_ORDER.find((field) => found[field]);
    if (firstInvalid) return focusField(firstInvalid);

    // Mantem a ordem da lista, qualquer que seja a ordem dos cliques
    const chosen = EVENTS.filter((item) => events.includes(item));
    try {
      if (!editing) {
        const created = await create.mutateAsync({ name: name.trim(), url: trimmedUrl, events: chosen, active });
        onClose();
        onCreated?.(created);
        return;
      }
      // Manda so o que mudou, para nao sobrescrever sem querer
      const body: WebhookUpdate = {};
      if (name.trim() !== webhook.name) body.name = name.trim();
      if (trimmedUrl !== webhook.url) body.url = trimmedUrl;
      if (chosen.join() !== webhook.events.join()) body.events = chosen;
      if (active !== webhook.active) body.active = active;
      if (Object.keys(body).length > 0) await update.mutateAsync({ id: webhook.id, body });
      onClose();
    } catch (error) {
      handleServerError(error);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !submitting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? t("webhooks.webhookFormDialog.editarWebhook") : t("webhooks.webhookFormDialog.novoWebhook")}</DialogTitle>
          <DialogDescription>
            {editing
              ? t("webhooks.webhookFormDialog.mudarOEnderecoNao")
              : t("webhooks.webhookFormDialog.oAppEnviaUm")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          {formError && <Alert variant="destructive">{formError}</Alert>}

          <FormField id="webhook-name" label={t("common.nome")} error={errors.name}>
            {(props) => (
              <Input
                {...props}
                autoComplete="off"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  clearError("name");
                }}
              />
            )}
          </FormField>

          <FormField
            id="webhook-url"
            label={t("webhooks.webhookFormDialog.endereco")}
            error={errors.url}
            hint={isPlainHttp(url) ? t("webhooks.webhookFormDialog.plainHttpHint") : t("webhooks.webhookFormDialog.defaultUrlHint")}
          >
            {(props) => (
              <Input
                {...props}
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder={t("webhooks.webhookFormDialog.httpsExemploComWebhook")}
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                  clearError("url");
                }}
              />
            )}
          </FormField>

          <fieldset className="flex flex-col gap-2" aria-describedby={errors.events ? "webhook-events-error" : undefined}>
            <legend className="mb-2 text-sm font-medium">{t("webhooks.webhookFormDialog.eventos")}</legend>
            {EVENTS.map((item, index) => (
              <label key={item} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  id={`webhook-event-${index}`}
                  type="checkbox"
                  checked={events.includes(item)}
                  onChange={() => toggleEvent(item)}
                  aria-invalid={Boolean(errors.events)}
                  className="accent-[var(--primary)]"
                />
                {eventLabel(item)}
              </label>
            ))}
            {errors.events && (
              <p id="webhook-events-error" className="text-xs text-destructive">
                {errors.events}
              </p>
            )}
          </fieldset>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
              className="accent-[var(--primary)]"
            />
            {t("webhooks.webhookFormDialog.ativo")}
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              {t("common.cancelar")}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? t("webhooks.webhookFormDialog.salvando") : editing ? t("webhooks.webhookFormDialog.salvar") : t("webhooks.webhookFormDialog.criarWebhook")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
