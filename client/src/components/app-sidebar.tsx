import { useLocation, Link } from "wouter";
import { 
  LineChart, 
  TrendingUp, 
  History, 
  Activity,
  BarChart3,
  FlaskConical,
  Users
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth-context";

const menuItems = [
  {
    title: "Live Market",
    url: "/",
    icon: LineChart,
    description: "Real-time prices",
    adminOnly: false,
  },
  {
    title: "Predictions",
    url: "/predictions",
    icon: TrendingUp,
    description: "AI predictions",
    adminOnly: false,
  },
  {
    title: "Historical",
    url: "/historical",
    icon: History,
    description: "1-year data",
    adminOnly: false,
  },
  {
    title: "Backtesting",
    url: "/backtesting",
    icon: FlaskConical,
    description: "Model testing",
    adminOnly: false,
  },
  {
    title: "System Status",
    url: "/status",
    icon: Activity,
    description: "Health checks",
    adminOnly: false,
  },
  {
    title: "User Management",
    url: "/users",
    icon: Users,
    description: "Manage users",
    adminOnly: true,
  },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user } = useAuth();
  
  const isAdmin = user?.role === "superadmin" || user?.role === "admin";
  
  const visibleMenuItems = menuItems.filter(item => !item.adminOnly || isAdmin);

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-3 px-2 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary">
            <BarChart3 className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="flex flex-col">
            <span className="text-base font-semibold tracking-tight">TradeViewMon</span>
            <span className="text-xs text-muted-foreground">Market Intelligence</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs uppercase tracking-wider text-muted-foreground">
            Dashboard
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleMenuItems.map((item) => {
                const isActive = location === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton 
                      asChild 
                      isActive={isActive}
                      className="transition-colors"
                    >
                      <Link href={item.url} data-testid={`link-${item.title.toLowerCase().replace(' ', '-')}`}>
                        <item.icon className={isActive ? "text-primary" : ""} />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <div className="px-4 py-3">
          <p className="text-xs text-muted-foreground">
            Version 1.0.0
          </p>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
