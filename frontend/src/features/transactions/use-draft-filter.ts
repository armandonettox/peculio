import { useEffect, useRef, useState } from "react";

type Options = {
  // Valor que ja esta nos filtros (na URL)
  committed: string;
  // Rascunho -> valor do filtro. null quando o rascunho e invalido (nada e enviado).
  toCommitted: (draft: string) => string | null;
  // Valor do filtro -> texto mostrado no campo
  toDraft: (committed: string) => string;
  onCommit: (draft: string) => void;
  delay?: number;
};

/**
 * Campo de filtro que o usuario digita: o rascunho aparece na hora, mas o filtro (e a busca na
 * API) so muda depois de uma pausa na digitacao. Se o filtro mudar por fora (Limpar filtros,
 * botao Voltar), o rascunho acompanha. As funcoes toCommitted e toDraft precisam ser estaveis
 * (declaradas fora do componente).
 */
export function useDraftFilter({ committed, toCommitted, toDraft, onCommit, delay = 300 }: Options) {
  const [draft, setDraft] = useState(() => toDraft(committed));
  const onCommitRef = useRef(onCommit);

  useEffect(() => {
    onCommitRef.current = onCommit;
  });

  useEffect(() => {
    const next = toCommitted(draft);
    if (next === null || next === committed) return;
    const timer = setTimeout(() => onCommitRef.current(draft), delay);
    return () => clearTimeout(timer);
  }, [draft, committed, delay, toCommitted]);

  useEffect(() => {
    // So troca o que o usuario ve quando o filtro mudou por outro caminho que nao a digitacao
    setDraft((current) => (toCommitted(current) === committed ? current : toDraft(committed)));
  }, [committed, toCommitted, toDraft]);

  return [draft, setDraft] as const;
}
