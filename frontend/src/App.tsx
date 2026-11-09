import { Navigate, Route, Routes, useSearchParams } from "react-router-dom";

import { AppLayout } from "@/components/layout/app-shell";
import { AuthLayout } from "@/components/layout/auth-layout";
import { ProtectedRoute, PublicOnlyRoute } from "@/components/protected-route";
import { PwaBanners } from "@/components/pwa-banners";
import AccountsPage from "@/pages/accounts";
import CreditCardsPage from "@/pages/credit-cards";
import BudgetsPage from "@/pages/budgets";
import RulesPage from "@/pages/rules";
import DashboardPage from "@/pages/dashboard";
import ImportReconciliationPage from "@/pages/import";
import InvoicePage from "@/pages/invoice";
import CategoriesPage from "@/pages/categories";
import TagsPage from "@/pages/tags";
import LoginPage from "@/pages/login";
import NotFoundPage from "@/pages/not-found";
import PlanWizardPage from "@/pages/plan-wizard";
import PiggyBanksPage from "@/pages/piggy-banks";
import RegisterPage from "@/pages/register";
import ReportsPage from "@/pages/reports";
import SettingsPage from "@/pages/settings";
import TransactionsPage from "@/pages/transactions";

// O link antigo /categorias?aba=tags (do tempo em que categorias e tags eram abas da mesma tela) leva a pagina de tags
function CategoriesRoute() {
  const [searchParams] = useSearchParams();
  if (searchParams.get("aba") === "tags") return <Navigate to="/tags" replace />;
  return <CategoriesPage />;
}

export default function App() {
  return (
    <>
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
            {/* Recorrentes e Contas a pagar viraram o filtro Fixas de Transacoes (favoritos antigos continuam entrando) */}
            <Route path="recorrentes" element={<Navigate to="/transacoes?situacao=fixed" replace />} />
            <Route path="contas-a-pagar" element={<Navigate to="/transacoes?situacao=fixed" replace />} />
            <Route path="orcamentos" element={<BudgetsPage />} />
            <Route path="orcamentos/planejar" element={<PlanWizardPage />} />
            {/* Envelopes virou orcamento com "carrega sobra" (favoritos antigos continuam entrando) */}
            <Route path="envelopes" element={<Navigate to="/orcamentos" replace />} />
            <Route path="regras" element={<RulesPage />} />
            <Route path="contas" element={<AccountsPage />} />
            <Route path="cartoes" element={<CreditCardsPage />} />
            <Route path="contas/:accountId/fatura" element={<InvoicePage />} />
            <Route path="transacoes" element={<TransactionsPage />} />
            <Route path="importar" element={<ImportReconciliationPage />} />
            {/* Conciliar virou a aba Conciliar de Importar extrato (favoritos antigos continuam entrando) */}
            <Route path="conciliar" element={<Navigate to="/importar?aba=conciliar" replace />} />
            <Route path="categorias" element={<CategoriesRoute />} />
            {/* Tags virou a aba Tags de Categorias (favoritos antigos continuam entrando) */}
            <Route path="tags" element={<TagsPage />} />
            {/* Webhooks virou a aba Webhooks de Configuracoes (favoritos antigos continuam entrando) */}
            <Route path="webhooks" element={<Navigate to="/configuracoes?aba=webhooks" replace />} />
            <Route path="relatorios" element={<ReportsPage />} />
            {/* /seguranca virou a aba Seguranca de Configuracoes (favoritos antigos continuam entrando) */}
            <Route path="seguranca" element={<Navigate to="/configuracoes?aba=seguranca" replace />} />
            <Route path="configuracoes" element={<SettingsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
      <PwaBanners />
    </>
  );
}
