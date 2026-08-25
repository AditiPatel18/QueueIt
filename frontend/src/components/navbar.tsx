"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LayersIcon,
  LayoutDashboard,
  BarChart3,
  History,
  Sparkles,
  User,
  LogOutIcon,
  Plus,
  ChevronDownIcon,
  Menu,
  X,
  Loader2,
} from "lucide-react";
import dynamic from "next/dynamic";
import type { User as SupabaseUser } from "@supabase/supabase-js";

const AddItemDialog = dynamic(
  () => import("@/components/add-item-dialog").then((m) => ({ default: m.AddItemDialog })),
  { ssr: false, loading: () => null }
);

const RemindersPopover = dynamic(
  () => import("@/components/reminders-popover").then((m) => ({ default: m.RemindersPopover })),
  { ssr: false, loading: () => null }
);

interface NavbarProps {
  onItemAdded?: () => void;
}

export function Navbar({ onItemAdded }: NavbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const navLinks = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/analytics", label: "Analytics", icon: BarChart3 },
    { href: "/history", label: "History", icon: History },
    { href: "/chat", label: "AI Assistant", icon: Sparkles },
  ];

  const handleLogout = async () => {
    setLoggingOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  const getInitials = (u: SupabaseUser) => {
    const name = u.user_metadata?.full_name || u.email || "U";
    return name
      .split(" ")
      .map((n: string) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const getDisplayName = (u: SupabaseUser) => {
    return u.user_metadata?.full_name || u.email?.split("@")[0] || "User";
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/30 glass">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3.5 relative">
        {/* Left: Brand Logo */}
        <Link href="/dashboard" className="flex items-center gap-2.5 group shrink-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl gradient-primary shadow-md shadow-primary/20 transition-transform group-hover:scale-105">
            <LayersIcon className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-extrabold tracking-tight gradient-text">
            QueueIt
          </span>
        </Link>

        {/* Center: Desktop Nav Links */}
        <nav className="hidden md:flex items-center justify-center gap-2 md:absolute md:left-1/2 md:-translate-x-1/2">
          {navLinks.map((link) => {
            const Icon = link.icon;
            const isActive = pathname === link.href;
            return (
              <Link key={link.href} href={link.href}>
                <Button
                  variant="ghost"
                  size="sm"
                  className={`h-9 px-3.5 rounded-lg text-xs font-semibold gap-2 transition-all cursor-pointer ${
                    isActive
                      ? "bg-primary/15 text-primary border border-primary/20 shadow-xs"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                  }`}
                >
                  <Icon className={`h-4 w-4 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                  <span>{link.label}</span>
                </Button>
              </Link>
            );
          })}
        </nav>

        {/* Right: Add Item CTA, Reminders, User Profile */}
        <div className="hidden md:flex items-center gap-3 shrink-0">
          <AddItemDialog
            trigger={
              <Button
                size="sm"
                className="gradient-primary text-white border-0 hover:opacity-95 transition-all shadow-md shadow-primary/20 cursor-pointer font-medium gap-1.5 h-9"
              >
                <Plus className="h-4 w-4" />
                <span>Add Item</span>
              </Button>
            }
            onItemAdded={onItemAdded}
          />

          <RemindersPopover />

          {/* User Menu Dropdown */}
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center h-9 px-2 gap-2 rounded-lg hover:bg-secondary/50 cursor-pointer border border-transparent hover:border-border/30 transition-colors">
                <Avatar className="h-7 w-7 border border-primary/30">
                  <AvatarImage src={user.user_metadata?.avatar_url} />
                  <AvatarFallback className="gradient-primary text-white text-[11px] font-bold">
                    {getInitials(user)}
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs font-medium max-w-[100px] truncate text-foreground/90">
                  {getDisplayName(user)}
                </span>
                <ChevronDownIcon className="h-3.5 w-3.5 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 glass-strong border-border/30 p-1.5">
                <div className="px-2 py-2">
                  <p className="text-xs font-bold text-foreground">{getDisplayName(user)}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{user.email}</p>
                </div>
                <DropdownMenuSeparator className="bg-border/20" />
                <Link href="/profile">
                  <DropdownMenuItem className="flex items-center gap-2 cursor-pointer text-xs font-medium">
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>Profile & Settings</span>
                  </DropdownMenuItem>
                </Link>
                <Link href="/analytics">
                  <DropdownMenuItem className="flex items-center gap-2 cursor-pointer text-xs font-medium">
                    <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>Analytics</span>
                  </DropdownMenuItem>
                </Link>
                <DropdownMenuSeparator className="bg-border/20" />
                <DropdownMenuItem
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="flex items-center gap-2 cursor-pointer text-xs font-medium text-destructive focus:text-destructive"
                >
                  {loggingOut ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <LogOutIcon className="h-3.5 w-3.5" />
                  )}
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Mobile Navigation Controls */}
        <div className="flex md:hidden items-center gap-2">
          <RemindersPopover />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="h-9 w-9 text-muted-foreground hover:text-foreground cursor-pointer"
            aria-label="Toggle Navigation Menu"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-border/20 glass-strong px-4 pt-3 pb-4 space-y-3 animate-in slide-in-from-top duration-200">
          <div className="grid grid-cols-2 gap-2">
            {navLinks.map((link) => {
              const Icon = link.icon;
              const isActive = pathname === link.href;
              return (
                <Link key={link.href} href={link.href} onClick={() => setMobileMenuOpen(false)}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`w-full justify-start h-10 text-xs font-medium gap-2.5 rounded-lg ${
                      isActive ? "bg-primary/20 text-primary border border-primary/25 font-bold" : "text-muted-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{link.label}</span>
                  </Button>
                </Link>
              );
            })}
          </div>

          <div className="pt-2 border-t border-border/15 flex flex-col gap-2">
            <AddItemDialog
              trigger={
                <Button className="w-full gradient-primary text-white border-0 text-xs h-9 font-semibold gap-1.5 shadow-md shadow-primary/20">
                  <Plus className="h-4 w-4" />
                  <span>Add Item</span>
                </Button>
              }
              onItemAdded={() => { onItemAdded?.(); setMobileMenuOpen(false); }}
            />

            <Link href="/profile" onClick={() => setMobileMenuOpen(false)}>
              <Button variant="outline" size="sm" className="w-full justify-start h-9 text-xs glass border-border/30 gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <span>Profile & Settings</span>
              </Button>
            </Link>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              disabled={loggingOut}
              className="w-full justify-start h-9 text-xs text-destructive hover:bg-destructive/10 gap-2"
            >
              {loggingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOutIcon className="h-4 w-4" />}
              <span>Log out</span>
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}
