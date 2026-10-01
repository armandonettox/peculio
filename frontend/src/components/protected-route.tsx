import { Navigate, Outlet, useLocation, useSearchParams } from "react-router-dom";

import { useAuth } from "@/auth/auth-context";
import { safeNextPath } from "@/lib/safe-next-path";

// Rotas que exigem login. Quem nao esta logado vai para /login e, depois de entrar, volta
// para onde queria ir (?next=).
export function ProtectedRoute() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (isAuthenticated) return <Outlet />;

  const target = `${location.pathname}${location.search}${location.hash}`;
  // Da raiz nao precisa de ?next=, porque "/" ja e o destino padrao
  const next = safeNextPath(target);
  const search = next === "/" ? "" : `?next=${encodeURIComponent(next)}`;
  return <Navigate to={`/login${search}`} replace />;
}

// Telas de login e cadastro. Quem ja esta logado nao tem o que fazer ali.
export function PublicOnlyRoute() {
  const { isAuthenticated } = useAuth();
  const [searchParams] = useSearchParams();

  if (isAuthenticated) {
    // Aproveita o mesmo ponto para honrar o ?next= logo apos o login
    return <Navigate to={safeNextPath(searchParams.get("next"))} replace />;
  }
  return <Outlet />;
}
