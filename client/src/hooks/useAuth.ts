import { useQuery } from "@tanstack/react-query";
import type { User } from "@shared/schema";

interface AuthUser extends User {
  inviter?: User;
  inviteCount: number;
}

interface AuthResponse extends AuthUser {
  pending?: boolean;
  message?: string;
  userId?: string;
}

export function useAuth() {
  const { data: userData, isLoading, error } = useQuery<AuthResponse>({
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  // If response has pending flag, user is authenticated but registration is pending
  // Don't treat this as a user object, but do treat as authenticated
  const isPendingRegistration = userData?.pending === true;
  const user = isPendingRegistration ? undefined : (userData as AuthUser | undefined);

  return {
    user,
    isLoading,
    isAuthenticated: !!user || isPendingRegistration, // Authenticated if user exists OR registration is pending
    error,
    isPendingRegistration,
  };
}

export function useSetupRequired() {
  const { data, isLoading } = useQuery<{ setupRequired: boolean }>({
    queryKey: ["/api/auth/setup-required"],
    retry: false,
  });

  return {
    setupRequired: data?.setupRequired ?? false,
    isLoading,
  };
}
