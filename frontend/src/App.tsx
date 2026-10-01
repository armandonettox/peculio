import { Route, Routes } from "react-router-dom";

import { AppLayout } from "@/components/layout/app-shell";
import DashboardPage from "@/pages/dashboard";
import NotFoundPage from "@/pages/not-found";

// As rotas de login e registro e o ProtectedRoute entram na etapa 4
export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
