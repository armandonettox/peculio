import { Navigate, Outlet, useLocation, useSearchParams } from "react-router-dom";

import { useAuth } from "@/auth/auth-context";
import { safeNextPath } from "@/lib/safe-next-path";

function RestoringSession() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <p role="status" className="text-sm text-muted-foreground">
        Carregando...
      </p>
    </div>
  );
}

// Rotas que exigem login. Quem nao esta logado vai para /login e, depois de entrar, volta
// para onde queria ir (?next=).
export function ProtectedRoute() {
  const { isAuthenticated, isRestoring } = useAuth();
  const location = useLocation();

  if (isAuthenticated) return <Outlet />;
  // Ainda conferindo se ha sessao guardada: nao manda para o login antes de saber
  if (isRestoring) return <RestoringSession />;

  const target = `${location.pathname}${location.search}${location.hash}`;
  // Da raiz nao precisa de ?next=, porque "/" ja e o destino padrao
  const next = safeNextPath(target);
  const search = next === "/" ? "" : `?next=${encodeURIComponent(next)}`;
  return <Navigate to={`/login${search}`} replace />;
}

// Telas de login e cadastro. Quem ja esta logado nao tem o que fazer ali.
export function PublicOnlyRoute() {
  const { isAuthenticated, isRestoring } = useAuth();
  const [searchParams] = useSearchParams();

  // Sem isto o formulario de login piscaria na tela de quem tem sessao guardada
  if (isRestoring && !isAuthenticated) return <RestoringSession />;

  if (isAuthenticated) {
    // Aproveita o mesmo ponto para honrar o ?next= logo apos o login
    return <Navigate to={safeNextPath(searchParams.get("next"))} replace />;
  }
  return <Outlet />;
}
