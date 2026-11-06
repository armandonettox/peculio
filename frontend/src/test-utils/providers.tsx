import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

import { SidebarNewButton } from "@/components/layout/sidebar-new-button";
import { AuthContext, AuthProvider, type AuthContextValue, type User } from "@/auth/auth-context";

export type TransactionKind = "Despesa" | "Receita" | "Despesa Cartão" | "Transferência";

export const testUser: User = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Ana Teste",
  email: "ana@example.com",
  is_admin: true, default_currency: "BRL",
};

export function newTestQueryClient() {
  // Sem repeticao automatica: o teste de erro nao pode esperar tentativas
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

// Providers reais (AuthProvider de verdade), para testes que passam pela API simulada
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={newTestQueryClient()}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}

// Wrapper que inclui sidebar para testes de paginas que usam SidebarNewButton.
// SidebarNewButton nao faz parte de nenhuma pagina — fica no AppShell (layout global).
// Testes de paginas que abrem o formulario de lancamento precisam renderizar o SidebarNewButton
// junto, pois e ele que contem o botao "Novo lancamento" e o dropdown de tipo.
export function WithSidebar({ children, route = "/" }: { children: ReactNode; route?: string }) {
  return (
    <MemoryRouter initialEntries={[route]}>
      <SidebarNewButton collapsed={false} />
      {children}
    </MemoryRouter>
  );
}

// Abre o formulario de lancamento via o sidebar dropdown.
// Deve ser chamado dentro de um render que usa WithSidebar ou inclua SidebarNewButton.
export async function openTransactionForm(kind: TransactionKind = "Despesa") {
  await userEvent.click(await screen.findByRole("button", { name: /Novo lançamento/ }));
  await userEvent.click(await screen.findByRole("menuitem", { name: kind }));
  return screen.findByRole("dialog", { name: "Novo lançamento" });
}

// Estado de login fixo, para testar uma tela ja logada (ou nao) sem passar pelo login
export function FakeAuth({
  user = testUser,
  logout = () => undefined,
  updateUser = () => undefined,
  restoring = false,
  children,
}: {
  user?: User | null;
  logout?: () => void;
  updateUser?: (user: User) => void;
  // O app ainda confere, ao abrir, se ha sessao guardada
  restoring?: boolean;
  children: ReactNode;
}) {
  const value: AuthContextValue = {
    user,
    isAuthenticated: user !== null,
    isRestoring: restoring,
    login: async () => ({ status: "ok" }),
    verifyTwoFactor: async () => undefined,
    register: async () => undefined,
    logout,
    updateUser,
  };
  return (
    <QueryClientProvider client={newTestQueryClient()}>
      <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
    </QueryClientProvider>
  );
}
