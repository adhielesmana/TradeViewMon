import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { 
  LineChart, 
  TrendingUp, 
  History, 
  Activity,
  BarChart3,
  FlaskConical,
  Users,
  Brain,
  Wallet,
  Settings,
  Newspaper,
  Home
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

interface LogoSettings {
  logoPath: string | null;
  logoIconPath: string | null;
}

const menuItems = [
  {
    title: "Homepage",
    url: "/",
    icon: Home,
    description: "Public landing",
    adminOnly: false,
  },
  {
    title: "Live Market",
    url: "/dashboard",
    icon: LineChart,
    description: "Real-time prices",
    adminOnly: false,
  },
  {
    title: "News & AI",
    url: "/news",
    icon: Newspaper,
    description: "AI news analysis",
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
    title: "AI Suggestions",
    url: "/ai-suggestions",
    icon: Brain,
    description: "Buy/Sell signals",
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
    title: "Live Demo",
    url: "/live-demo",
    icon: Wallet,
    description: "Paper trading",
    adminOnly: false,
  },
  {
    title: "System Status",
    url: "/status",
    icon: Activity,
    description: "Health checks",
    adminOnly: true,
  },
  {
    title: "User Management",
    url: "/users",
    icon: Users,
    description: "Manage users",
    adminOnly: true,
  },
  {
    title: "Settings",
    url: "/settings",
    icon: Settings,
    description: "App settings",
    adminOnly: true,
  },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user } = useAuth();
  
  const isAdmin = user?.role === "superadmin" || user?.role === "admin";
  
  const visibleMenuItems = menuItems.filter(item => !item.adminOnly || isAdmin);

  // Fetch custom logo settings - use public endpoint so it works without auth
  const { data: logoSettings } = useQuery<LogoSettings>({
    queryKey: ["/api/public/logo"],
    staleTime: 60000, // Cache for 1 minute
  });

  // Determine which logo to display - prefer custom, fallback to default
  const iconLogo = logoSettings?.logoIconPath || "/trady-icon.jpg";
  const fullLogo = logoSettings?.logoPath;

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-3 px-2 py-3">
          <img 
            src={iconLogo} 
            alt="Trady" 
            className="h-9 w-9 rounded-md object-contain"
            onError={(e) => {
              e.currentTarget.src = "/trady-icon.jpg";
            }}
          />
          <div className="flex flex-col">
            <span className="text-base font-semibold tracking-tight">Trady</span>
            <span className="text-xs text-muted-foreground">Global Market Trading News</span>
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
                      <Link href={item.url} data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, '-')}`}>
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
