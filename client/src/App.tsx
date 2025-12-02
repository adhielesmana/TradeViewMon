import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { StatusIndicator } from "@/components/status-indicator";
import { SymbolProvider } from "@/lib/symbol-context";
import { SymbolSelector } from "@/components/symbol-selector";

import LiveMarket from "@/pages/live-market";
import Predictions from "@/pages/predictions";
import Historical from "@/pages/historical";
import SystemStatus from "@/pages/system-status";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={LiveMarket} />
      <Route path="/predictions" component={Predictions} />
      <Route path="/historical" component={Historical} />
      <Route path="/status" component={SystemStatus} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3.5rem",
  };

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="dark" storageKey="tradeviewmon-theme">
        <SymbolProvider>
          <TooltipProvider>
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
                    <ThemeToggle />
                  </header>
                  <main className="flex-1 overflow-auto bg-background">
                    <Router />
                  </main>
                </div>
              </div>
            </SidebarProvider>
            <Toaster />
          </TooltipProvider>
        </SymbolProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
