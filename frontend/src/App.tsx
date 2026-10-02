import { Route, Routes } from "react-router-dom";

import { AppLayout } from "@/components/layout/app-shell";
import { AuthLayout } from "@/components/layout/auth-layout";
import { ProtectedRoute, PublicOnlyRoute } from "@/components/protected-route";
import AccountsPage from "@/pages/accounts";
import BudgetsPage from "@/pages/budgets";
import BillsPage from "@/pages/bills";
import CategoriesPage from "@/pages/categories";
import DashboardPage from "@/pages/dashboard";
import LoginPage from "@/pages/login";
import NotFoundPage from "@/pages/not-found";
import PiggyBanksPage from "@/pages/piggy-banks";
import RecurrencesPage from "@/pages/recurrences";
import RegisterPage from "@/pages/register";
import SecurityPage from "@/pages/security";
import TagsPage from "@/pages/tags";
import TransactionsPage from "@/pages/transactions";

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
          <Route path="cofrinhos" element={<PiggyBanksPage />} />
          <Route path="recorrentes" element={<RecurrencesPage />} />
          <Route path="contas-a-pagar" element={<BillsPage />} />
          <Route path="orcamentos" element={<BudgetsPage />} />
          <Route path="contas" element={<AccountsPage />} />
          <Route path="transacoes" element={<TransactionsPage />} />
          <Route path="categorias" element={<CategoriesPage />} />
          <Route path="tags" element={<TagsPage />} />
          <Route path="seguranca" element={<SecurityPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
