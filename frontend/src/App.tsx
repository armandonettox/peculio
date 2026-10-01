import { Route, Routes } from "react-router-dom";

import { AppLayout } from "@/components/layout/app-shell";
import { AuthLayout } from "@/components/layout/auth-layout";
import { ProtectedRoute, PublicOnlyRoute } from "@/components/protected-route";
import AccountsPage from "@/pages/accounts";
import CategoriesPage from "@/pages/categories";
import DashboardPage from "@/pages/dashboard";
import LoginPage from "@/pages/login";
import NotFoundPage from "@/pages/not-found";
import RegisterPage from "@/pages/register";
import TagsPage from "@/pages/tags";

export default function App() {
  return (
    <Routes>
      <Route element={<PublicOnlyRoute />}>
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="contas" element={<AccountsPage />} />
          <Route path="categorias" element={<CategoriesPage />} />
          <Route path="tags" element={<TagsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
