import { Copy } from "lucide-react";
import { useState, type FormEvent } from "react";

import { useCreateApiToken, type ApiTokenCreated, type ApiTokenScope } from "@/api/api-tokens";
import { getErrorMessage } from "@/api/error-messages";
import { ApiError } from "@/api/errors";
import { FormField } from "@/components/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DEFAULT_VALIDITY, expiresInDays, SCOPE_OPTIONS, VALIDITY_OPTIONS } from "./presentation";

type Props = { onClose: () => void };

/** Cria o token. Depois de criar, mostra o valor uma unica vez e so deixa concluir quando a pessoa marca que guardou. */
export function CreateApiTokenDialog({ onClose }: Props) {
  const create = useCreateApiToken();
  const [name, setName] = useState("");
  // Comeca em so leitura: a opcao mais segura e a que a maioria dos scripts precisa
  const [scope, setScope] = useState<ApiTokenScope>("read");
  const [validity, setValidity] = useState(DEFAULT_VALIDITY);
  const [nameError, setNameError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<ApiTokenCreated | null>(null);

  const busy = create.isPending;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setFormError(null);
    if (name.trim() === "") {
      setNameError("Informe um nome para reconhecer este token.");
      document.getElementById("token-name")?.focus();
      return;
    }
    try {
      setCreated(await create.mutateAsync({ name: name.trim(), scope, expires_in_days: expiresInDays(validity) }));
    } catch (error) {
      const message = getErrorMessage(error);
      // Nome repetido fica no campo; qualquer outra falha vai no aviso do topo
      if (error instanceof ApiError && (error.code === "api_token_name_taken" || error.code === "validation_error")) {
        setNameError(message);
        document.getElementById("token-name")?.focus();
      } else {
        setFormError(message);
      }
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && created === null && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{created ? "Token criado" : "Criar token de API"}</DialogTitle>
          <DialogDescription>
            {created
              ? "Copie o token agora: ele não aparece de novo."
              : "Para um script ou uma integração acessar seus dados sem usar sua senha."}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <TokenShown created={created} onDone={onClose} />
        ) : (
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            {formError && <Alert variant="destructive">{formError}</Alert>}

            <FormField id="token-name" label="Nome" error={nameError} hint="Ex: planilha do Excel, automação da casa.">
              {(props) => (
                <Input
                  {...props}
                  value={name}
                  maxLength={100}
                  autoComplete="off"
                  onChange={(event) => {
                    setName(event.target.value);
                    setNameError(undefined);
                  }}
                />
              )}
            </FormField>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Permissão</legend>
              {SCOPE_OPTIONS.map((option) => (
                <label key={option.value} className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="token-scope"
                    checked={scope === option.value}
                    onChange={() => setScope(option.value)}
                    className="mt-0.5 accent-[var(--primary)]"
                  />
                  <span>
                    <span className="font-medium">{option.label}</span>
                    <span className="block text-xs text-muted-foreground">{option.description}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <FormField
              id="token-validity"
              label="Validade"
              hint="Um token esquecido deixa de valer sozinho. Escolha “Nunca expira” só para uma automação fixa."
            >
              {(props) => (
                <Select {...props} value={validity} onChange={(event) => setValidity(event.target.value)}>
                  {VALIDITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                Cancelar
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Criando..." : "Criar token"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** O valor completo, uma unica vez: o servidor guarda so o hash e nao consegue mostrar de novo. */
function TokenShown({ created, onDone }: { created: ApiTokenCreated; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(created.token);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="select-all break-all rounded-md border bg-muted px-3 py-2 font-mono text-sm" aria-label="Token">
        {created.token}
      </p>

      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
          <Copy />
          Copiar token
        </Button>
        <p role="status" className="text-xs text-muted-foreground">
          {copied === "ok" && "Token copiado."}
          {copied === "fail" && "Não foi possível copiar. Selecione e copie à mão."}
        </p>
      </div>

      <p className="text-sm text-muted-foreground">
        Use no cabeçalho de cada chamada: <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">Authorization: Bearer {"<token>"}</code>.
        Trate como uma senha: quem tem o token acessa seus dados.
      </p>

      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
          className="mt-0.5 accent-[var(--primary)]"
        />
        Copiei o token e guardei em um lugar seguro
      </label>

      <DialogFooter>
        <Button type="button" onClick={onDone} disabled={!saved}>
          Concluir
        </Button>
      </DialogFooter>
    </div>
  );
}
