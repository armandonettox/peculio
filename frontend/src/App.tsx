import { Navigate, Route, Routes } from "react-router-dom";

import { AppLayout } from "@/components/layout/app-shell";
import { AuthLayout } from "@/components/layout/auth-layout";
import { ProtectedRoute, PublicOnlyRoute } from "@/components/protected-route";
import { PwaBanners } from "@/components/pwa-banners";
import AccountsPage from "@/pages/accounts";
import BudgetsEnvelopesPage from "@/pages/budgets";
import RulesPage from "@/pages/rules";
import BillsRecurrencesPage from "@/pages/bills";
import DashboardPage from "@/pages/dashboard";
import ImportReconciliationPage from "@/pages/import";
import LabelsPage from "@/pages/labels";
import LoginPage from "@/pages/login";
import NotFoundPage from "@/pages/not-found";
import PiggyBanksPage from "@/pages/piggy-banks";
import RegisterPage from "@/pages/register";
import ReportsPage from "@/pages/reports";
import SettingsPage from "@/pages/settings";
import TransactionsPage from "@/pages/transactions";

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
            {/* Recorrentes virou a aba Recorrentes de Contas a pagar (favoritos antigos continuam entrando) */}
            <Route path="recorrentes" element={<Navigate to="/contas-a-pagar?aba=recorrentes" replace />} />
            <Route path="contas-a-pagar" element={<BillsRecurrencesPage />} />
            <Route path="orcamentos" element={<BudgetsEnvelopesPage />} />
            {/* Envelopes virou a aba Envelopes de Orcamentos (favoritos antigos continuam entrando) */}
            <Route path="envelopes" element={<Navigate to="/orcamentos?aba=envelopes" replace />} />
            <Route path="regras" element={<RulesPage />} />
            <Route path="contas" element={<AccountsPage />} />
            <Route path="transacoes" element={<TransactionsPage />} />
            <Route path="importar" element={<ImportReconciliationPage />} />
            {/* Conciliar virou a aba Conciliar de Importar extrato (favoritos antigos continuam entrando) */}
            <Route path="conciliar" element={<Navigate to="/importar?aba=conciliar" replace />} />
            <Route path="categorias" element={<LabelsPage />} />
            {/* Tags virou a aba Tags de Categorias (favoritos antigos continuam entrando) */}
            <Route path="tags" element={<Navigate to="/categorias?aba=tags" replace />} />
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
