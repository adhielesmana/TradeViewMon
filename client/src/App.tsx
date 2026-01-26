import { Switch, Route, useLocation, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { StatusIndicator } from "@/components/status-indicator";
import { SymbolProvider } from "@/lib/symbol-context";
import { SymbolSelector } from "@/components/symbol-selector";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { LogOut, Loader2 } from "lucide-react";
import { lazy, Suspense } from "react";

// Lazy load pages for faster initial load
const LiveMarket = lazy(() => import("@/pages/live-market"));
const Predictions = lazy(() => import("@/pages/predictions"));
const AiSuggestions = lazy(() => import("@/pages/ai-suggestions"));
const Historical = lazy(() => import("@/pages/historical"));
const Backtesting = lazy(() => import("@/pages/backtesting"));
const LiveDemo = lazy(() => import("@/pages/live-demo"));
const SystemStatus = lazy(() => import("@/pages/system-status"));
const UserManagement = lazy(() => import("@/pages/user-management"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const NewsAnalysisPage = lazy(() => import("@/pages/news-analysis"));
const PublicNewsPage = lazy(() => import("@/pages/public-news"));
const LoginPage = lazy(() => import("@/pages/login"));
const RegisterPage = lazy(() => import("@/pages/register"));
const NotFound = lazy(() => import("@/pages/not-found"));

// Loading spinner for lazy components
function PageLoader() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function ProtectedRoutes() {
  const { user } = useAuth();
  const isAdmin = user?.role === "superadmin" || user?.role === "admin";
  
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/dashboard" component={LiveMarket} />
        <Route path="/predictions" component={Predictions} />
        <Route path="/ai-suggestions" component={AiSuggestions} />
        <Route path="/historical" component={Historical} />
        <Route path="/backtesting" component={Backtesting} />
        <Route path="/live-demo" component={LiveDemo} />
        <Route path="/news" component={NewsAnalysisPage} />
        {isAdmin && <Route path="/status" component={SystemStatus} />}
        {isAdmin && <Route path="/users" component={UserManagement} />}
        {isAdmin && <Route path="/settings" component={SettingsPage} />}
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  
  if (!user) return null;
  
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">
        {user.username}
        {user.role === "superadmin" && (
          <span className="ml-1 text-xs text-primary">(Admin)</span>
        )}
      </span>
      <Button 
        variant="ghost" 
        size="icon" 
        onClick={logout}
        data-testid="button-logout"
      >
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  );
}

function AuthenticatedApp() {
  const { isAuthenticated, isLoading } = useAuth();
  const [location] = useLocation();

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3.5rem",
  };

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // Allow access to public routes without authentication
  const isPublicRoute = location === "/" || location === "/login" || location.startsWith("/register");
  
  // Public news page is the landing page (accessible to everyone)
  if (location === "/") {
    return (
      <Suspense fallback={<PageLoader />}>
        <PublicNewsPage />
      </Suspense>
    );
  }
  
  if (!isAuthenticated && !isPublicRoute) {
    return <Redirect to="/login" />;
  }

  if (location === "/login") {
    if (isAuthenticated) {
      return <Redirect to="/dashboard" />;
    }
    return <Redirect to="/" />;
  }

  if (location.startsWith("/register")) {
    if (isAuthenticated) {
      return <Redirect to="/dashboard" />;
    }
    return <Redirect to="/" />;
  }

  return (
    <SymbolProvider>
      <SidebarProvider style={style as React.CSSProperties}>
        <div className="flex h-screen w-full">
          <AppSidebar />
          <div className="flex flex-1 flex-col overflow-hidden">
            <header className="flex h-14 items-center justify-between gap-4 border-b border-border bg-background px-4">
              <div className="flex items-center gap-4">
                <SidebarTrigger data-testid="button-sidebar-toggle" />
                <SymbolSelector />
                <div className="flex items-center gap-2">
                  <StatusIndicator status="online" size="sm" />
                  <span className="text-sm font-medium">Live</span>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <UserMenu />
              </div>
            </header>
            <main className="flex-1 overflow-auto bg-background">
              <ProtectedRoutes />
            </main>
          </div>
        </div>
      </SidebarProvider>
    </SymbolProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="dark" storageKey="trady-theme">
        <TooltipProvider>
          <AuthProvider>
            <AuthenticatedApp />
          </AuthProvider>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
