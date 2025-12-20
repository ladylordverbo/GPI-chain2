import { useState, useEffect } from "react";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/ThemeProvider";
import BottomNav from "@/components/BottomNav";
import DashboardView from "@/components/DashboardView";
import InvitesView from "@/components/InvitesView";
import PromotionsView from "@/components/PromotionsView";
import ProfileView from "@/components/ProfileView";
import LoginView from "@/components/LoginView";
import FirstAdminSetup from "@/components/FirstAdminSetup";
import UsernameRegistration from "@/components/UsernameRegistration";
import { useAuth, useSetupRequired } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";

type Tab = "dashboard" | "invites" | "promotions" | "profile";

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-background p-4 flex flex-col items-center justify-center gap-4">
      <Skeleton className="h-16 w-16 rounded-2xl" />
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-4 w-48" />
    </div>
  );
}

function MainApp() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const { user, isLoading: authLoading, isAuthenticated, isPendingRegistration } = useAuth();
  const { setupRequired, isLoading: setupLoading } = useSetupRequired();

  // Check for invite token, error, and registration pending in URL
  const urlParams = new URLSearchParams(window.location.search);
  const inviteToken = urlParams.get("invite");
  const errorParam = urlParams.get("error");
  const registerParam = urlParams.get("register");
  const [inviterName, setInviterName] = useState<string | undefined>();
  const [authError, setAuthError] = useState<string | undefined>(errorParam || undefined);

  // Check for pending registration
  const { data: pendingRegData, isLoading: pendingLoading } = useQuery<{ pending: boolean }>({
    queryKey: ["/api/auth/pending-registration"],
    enabled: registerParam === "pending" || isAuthenticated,
  });

  useEffect(() => {
    if (inviteToken) {
      fetch(`/api/invite/${inviteToken}`)
        .then(res => res.json())
        .then(data => {
          if (data.valid) {
            setInviterName(data.inviterName);
          }
        })
        .catch(() => {});
    }
  }, [inviteToken]);

  // Clear error from URL but keep in state
  useEffect(() => {
    if (errorParam) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [errorParam]);

  const isLoading = authLoading || setupLoading || pendingLoading;

  const handleLogin = () => {
    // Redirect to login with invite token if present
    const loginUrl = inviteToken ? `/api/login?invite=${inviteToken}` : "/api/login";
    window.location.href = loginUrl;
  };

  const handleRegistrationComplete = () => {
    // Clear the register param from URL and refresh
    window.history.replaceState({}, document.title, window.location.pathname);
    queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    queryClient.invalidateQueries({ queryKey: ["/api/auth/pending-registration"] });
  };

  if (isLoading) {
    return <LoadingScreen />;
  }

  // First admin setup (empty database)
  if (setupRequired && !isAuthenticated) {
    return <FirstAdminSetup onSetup={handleLogin} />;
  }

  // Login page (regular or invite)
  if (!isAuthenticated && !pendingRegData?.pending) {
    return (
      <LoginView 
        onLogin={handleLogin} 
        inviteToken={inviteToken || undefined}
        inviterName={inviterName}
        error={authError}
      />
    );
  }

  // Pending registration - need to choose username
  // Check both pendingRegData and useAuth's isPendingRegistration flag
  if (pendingRegData?.pending || isPendingRegistration) {
    return <UsernameRegistration onComplete={handleRegistrationComplete} />;
  }

  // Clear invite token from URL after successful login
  if (inviteToken && isAuthenticated) {
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  // Calculate pending votes for badge
  const pendingVotes = 0; // This would come from stats query

  // Authenticated - main app
  return (
    <div className="min-h-screen bg-background">
      <main className="pb-20 px-4 pt-4 max-w-2xl mx-auto">
        {activeTab === "dashboard" && (
          <DashboardView onNavigate={setActiveTab} />
        )}
        {activeTab === "invites" && <InvitesView />}
        {activeTab === "promotions" && <PromotionsView />}
        {activeTab === "profile" && <ProfileView />}
      </main>
      <BottomNav
        activeTab={activeTab}
        onTabChange={setActiveTab}
        pendingVotes={pendingVotes}
      />
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <MainApp />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
