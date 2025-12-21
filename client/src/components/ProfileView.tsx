import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import UserAvatar from "./UserAvatar";
import LevelBadge from "./LevelBadge";
import StatusDot from "./StatusDot";
import GPIChainNode from "./GPIChainNode";
import ThemeToggle from "./ThemeToggle";
import { Calendar, Users, ArrowUpCircle, ArrowDownCircle, Shield, LogOut, Settings, Pencil, Check, X, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { User } from "@shared/schema";

interface UserWithInvitees extends User {
  inviter?: User;
  invitees: User[];
  inviteCount: number;
}

function buildGPITree(user: UserWithInvitees): any {
  return {
    id: user.id,
    name: user.username || `${user.firstName || ""} ${user.lastName || ""}`.trim() || "Unknown",
    level: user.level as 1 | 2 | 3 | 4 | 5,
    imageUrl: user.profileImageUrl || undefined,
    invitees: user.invitees?.map(inv => ({
      id: inv.id,
      name: inv.username || `${inv.firstName || ""} ${inv.lastName || ""}`.trim() || "Unknown",
      level: inv.level as 1 | 2 | 3 | 4 | 5,
      imageUrl: inv.profileImageUrl || undefined,
    })) || [],
  };
}

export default function ProfileView() {
  const [isPromoteDialogOpen, setIsPromoteDialogOpen] = useState(false);
  const [isEditUsernameOpen, setIsEditUsernameOpen] = useState(false);
  const [isSelfDemoteDialogOpen, setIsSelfDemoteDialogOpen] = useState(false);
  const [isSetLevelDialogOpen, setIsSetLevelDialogOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [debouncedUsername, setDebouncedUsername] = useState("");
  const [selectedMember, setSelectedMember] = useState<string>("");
  const [selectedLevel, setSelectedLevel] = useState<string>("");
  const [selectedDirectLevel, setSelectedDirectLevel] = useState<string>("");
  const [selectedDemoteLevel, setSelectedDemoteLevel] = useState<string>("");
  const [justification, setJustification] = useState("");
  const [directLevelReason, setDirectLevelReason] = useState("");
  const [demoteReason, setDemoteReason] = useState("");
  const { toast } = useToast();
  const { user: authUser, isLoading: authLoading } = useAuth();

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedUsername(newUsername.toLowerCase().trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [newUsername]);

  const { data: profileData, isLoading: profileLoading } = useQuery<UserWithInvitees>({
    queryKey: ["/api/users", authUser?.id],
    enabled: !!authUser?.id,
  });

  const { data: allUsers = [] } = useQuery<User[]>({
    queryKey: ["/api/users"],
    enabled: !!authUser && authUser.level >= 4,
  });

  const { data: usernameAvailability, isLoading: checkingUsername } = useQuery<{ available: boolean; reason: string | null }>({
    queryKey: ["/api/username/check", debouncedUsername],
    enabled: isEditUsernameOpen && debouncedUsername.length >= 3 && debouncedUsername !== authUser?.username,
  });

  const updateUsernameMutation = useMutation({
    mutationFn: async ({ userId, username }: { userId: string; username: string }) => {
      const response = await apiRequest("PATCH", `/api/users/${userId}/username`, { username });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Username Updated", description: "Your username has been updated successfully." });
      setIsEditUsernameOpen(false);
      setNewUsername("");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Update Username",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    },
  });

  const createPromotionMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest("POST", "/api/promotions", data);
      return response.json();
    },
    onSuccess: () => {
      toast({ 
        title: "Promotion Request Created", 
        description: "Level 4+ members will now vote on this promotion."
      });
      setIsPromoteDialogOpen(false);
      setSelectedMember("");
      setSelectedLevel("");
      setJustification("");
      queryClient.invalidateQueries({ queryKey: ["/api/promotions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Create Promotion",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    },
  });

  const setLevelDirectlyMutation = useMutation({
    mutationFn: async ({ userId, newLevel, reason }: { userId: string; newLevel: number; reason: string }) => {
      const response = await apiRequest("POST", `/api/users/${userId}/level`, { newLevel, reason });
      return response.json();
    },
    onSuccess: () => {
      toast({ 
        title: "Level Set Successfully", 
        description: "The member's level has been updated directly."
      });
      setIsSetLevelDialogOpen(false);
      setSelectedMember("");
      setSelectedDirectLevel("");
      setDirectLevelReason("");
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
    },
    onError: (error: any) => {
      let errorMessage = "An error occurred";
      
      if (error.message) {
        const match = error.message.match(/^\d+:\s*(.+)$/);
        if (match) {
          try {
            const errorData = JSON.parse(match[1]);
            errorMessage = errorData.message || errorMessage;
          } catch {
            errorMessage = match[1];
          }
        } else {
          errorMessage = error.message;
        }
      }
      
      toast({
        title: "Failed to Set Level",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const selfDemoteMutation = useMutation({
    mutationFn: async (data: { newLevel: number; reason: string }) => {
      const response = await apiRequest("POST", "/api/users/self/demote", data);
      return response.json();
    },
    onSuccess: () => {
      toast({ 
        title: "Level Demoted", 
        description: "Your level has been successfully demoted."
      });
      setIsSelfDemoteDialogOpen(false);
      setSelectedDemoteLevel("");
      setDemoteReason("");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
    },
    onError: (error: any) => {
      let errorMessage = "An error occurred";
      
      // Try to extract error message from response
      if (error.message) {
        // Error format from apiRequest is "400: {...}" or "400: message"
        const match = error.message.match(/^\d+:\s*(.+)$/);
        if (match) {
          try {
            const errorData = JSON.parse(match[1]);
            errorMessage = errorData.message || errorMessage;
          } catch {
            // If not JSON, use the message as-is
            errorMessage = match[1];
          }
        } else {
          errorMessage = error.message;
        }
      }
      
      toast({
        title: "Failed to Demote",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const handleLogout = async () => {
    try {
      // Clear auth state immediately
      queryClient.setQueryData(["/api/auth/user"], null);
      // Call logout endpoint which will clear cookie and redirect
      window.location.href = "/api/logout";
    } catch (error) {
      // If logout fails, still redirect to home
      window.location.href = "/";
    }
  };

  const handlePromoteSubmit = () => {
    const candidate = allUsers.find(u => u.id === selectedMember);
    if (!candidate) return;

    createPromotionMutation.mutate({
      candidateUserId: selectedMember,
      currentLevel: candidate.level,
      proposedLevel: parseInt(selectedLevel),
      justification,
    });
  };

  const handleSelfDemoteSubmit = () => {
    if (!selectedDemoteLevel || !demoteReason) return;
    selfDemoteMutation.mutate({
      newLevel: parseInt(selectedDemoteLevel),
      reason: demoteReason,
    });
  };

  const isLoading = authLoading || profileLoading;
  const user = profileData || authUser;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-9 w-20" />
        </div>
        <Skeleton className="h-64" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">Please sign in to view your profile</p>
      </div>
    );
  }

  const displayName = user.username || `${user.firstName || ""} ${user.lastName || ""}`.trim() || "Unknown";
  const gpiTree = profileData ? buildGPITree(profileData) : null;

  // Members eligible for promotion (lower level than proposer)
  const eligibleMembers = allUsers.filter(u => u.level < user.level && u.id !== user.id);
  
  // Members eligible for direct level setting (Level 5 only, users < Level 5)
  const eligibleForDirectLevel = user.level === 5 
    ? allUsers.filter(u => u.level < 5 && u.id !== user.id)
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Profile</h1>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button variant="ghost" size="icon" data-testid="button-settings">
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center text-center">
            <UserAvatar 
              name={displayName} 
              imageUrl={user.profileImageUrl || undefined}
              level={user.level as 1 | 2 | 3 | 4 | 5} 
              size="lg" 
            />
            <div className="flex items-center gap-2 mt-4">
              <h2 className="text-xl font-bold">{displayName}</h2>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => {
                  setNewUsername(user.username || "");
                  setIsEditUsernameOpen(true);
                }}
                data-testid="button-edit-username"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">{user.email}</p>
            <div className="flex items-center gap-2 mt-2">
              <LevelBadge level={user.level as 1 | 2 | 3 | 4 | 5} />
              <StatusDot status={user.status as "active" | "suspended" | "expelled"} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mt-6">
            <div className="text-center p-3 bg-muted rounded-md">
              <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                <Calendar className="h-3.5 w-3.5" />
                <span className="text-xs">Joined</span>
              </div>
              <p className="font-medium text-sm">
                {user.createdAt ? format(new Date(user.createdAt), "MMM d, yyyy") : "Unknown"}
              </p>
            </div>
            <div className="text-center p-3 bg-muted rounded-md">
              <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                <Users className="h-3.5 w-3.5" />
                <span className="text-xs">Invited</span>
              </div>
              <p className="font-medium text-sm">{profileData?.inviteCount || 0} people</p>
            </div>
          </div>

          {profileData?.inviter && (
            <div className="mt-4 p-3 bg-muted rounded-md">
              <p className="text-xs text-muted-foreground mb-2">Invited by</p>
              <div className="flex items-center gap-2">
                <UserAvatar 
                  name={profileData.inviter.username || `${profileData.inviter.firstName || ""} ${profileData.inviter.lastName || ""}`.trim() || "Unknown"}
                  imageUrl={profileData.inviter.profileImageUrl || undefined}
                  level={profileData.inviter.level as 1 | 2 | 3 | 4 | 5} 
                  size="sm" 
                />
                <span className="font-medium text-sm">
                  {profileData.inviter.username || `${profileData.inviter.firstName || ""} ${profileData.inviter.lastName || ""}`.trim() || profileData.inviter.email}
                </span>
                <LevelBadge level={profileData.inviter.level as 1 | 2 | 3 | 4 | 5} size="sm" />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isEditUsernameOpen} onOpenChange={setIsEditUsernameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Username</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-username">New Username</Label>
              <div className="relative">
                <Input
                  id="new-username"
                  type="text"
                  placeholder="your_username"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 30))}
                  className="pr-10"
                  data-testid="input-new-username"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {checkingUsername && debouncedUsername.length >= 3 && (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                  {!checkingUsername && usernameAvailability?.available && debouncedUsername !== user.username && (
                    <Check className="h-4 w-4 text-green-500" />
                  )}
                  {!checkingUsername && usernameAvailability && !usernameAvailability.available && (
                    <X className="h-4 w-4 text-destructive" />
                  )}
                </div>
              </div>
              {debouncedUsername.length > 0 && debouncedUsername.length < 3 && (
                <p className="text-xs text-muted-foreground">Username must be at least 3 characters</p>
              )}
              {usernameAvailability?.reason && (
                <p className="text-xs text-destructive">{usernameAvailability.reason}</p>
              )}
              <p className="text-xs text-muted-foreground">
                3-30 characters, letters, numbers, and underscores only
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditUsernameOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => user && updateUsernameMutation.mutate({ userId: user.id, username: newUsername })}
              disabled={
                !newUsername || 
                newUsername.length < 3 || 
                (debouncedUsername !== user?.username && !usernameAvailability?.available) ||
                updateUsernameMutation.isPending
              }
              data-testid="button-save-username"
            >
              {updateUsernameMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Username"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Self-Demotion Section - Available to all members except Level 1 */}
      {user.level > 1 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowDownCircle className="h-4 w-4" />
              Self-Demotion
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              You can voluntarily demote yourself to a lower level. This action cannot be undone without going through the promotion process.
            </p>
            <Dialog open={isSelfDemoteDialogOpen} onOpenChange={setIsSelfDemoteDialogOpen}>
              <DialogTrigger asChild>
                <Button 
                  variant="outline" 
                  className="w-full"
                  data-testid="button-self-demote"
                >
                  <ArrowDownCircle className="h-4 w-4 mr-2" />
                  Demote Myself
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Demote Yourself</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Select New Level</Label>
                    <Select value={selectedDemoteLevel} onValueChange={setSelectedDemoteLevel}>
                      <SelectTrigger data-testid="select-demote-level">
                        <SelectValue placeholder="Select level" />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: user.level - 1 }, (_, i) => i + 1).map(level => (
                          <SelectItem key={level} value={level.toString()}>
                            Level {level}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Currently Level {user.level} → Level {selectedDemoteLevel || "?"}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Reason</Label>
                    <Textarea
                      placeholder="Explain why you want to demote yourself..."
                      value={demoteReason}
                      onChange={(e) => setDemoteReason(e.target.value)}
                      rows={3}
                      data-testid="input-demote-reason"
                    />
                    <p className="text-xs text-muted-foreground">{demoteReason.length}/500 characters</p>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsSelfDemoteDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button 
                    onClick={handleSelfDemoteSubmit}
                    disabled={!selectedDemoteLevel || demoteReason.length < 10 || selfDemoteMutation.isPending}
                    variant="destructive"
                    data-testid="button-submit-self-demote"
                  >
                    {selfDemoteMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Demoting...
                      </>
                    ) : (
                      "Confirm Demotion"
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
      )}

      {user.level >= 4 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-4 w-4" />
              Admin Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Dialog open={isPromoteDialogOpen} onOpenChange={setIsPromoteDialogOpen}>
              <DialogTrigger asChild>
                <Button className="w-full" variant="outline" data-testid="button-propose-promotion">
                  <ArrowUpCircle className="h-4 w-4 mr-2" />
                  Propose Promotion
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Propose Level Promotion</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Select Member</Label>
                    <Select value={selectedMember} onValueChange={setSelectedMember}>
                      <SelectTrigger data-testid="select-member">
                        <SelectValue placeholder="Choose a member" />
                      </SelectTrigger>
                      <SelectContent>
                        {eligibleMembers.map(member => (
                          <SelectItem key={member.id} value={member.id}>
                            {member.username || `${member.firstName || ""} ${member.lastName || ""}`.trim() || member.email} (Level {member.level})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Propose New Level</Label>
                    <Select value={selectedLevel} onValueChange={setSelectedLevel}>
                      <SelectTrigger data-testid="select-new-level">
                        <SelectValue placeholder="Select level" />
                      </SelectTrigger>
                      <SelectContent>
                        {[2, 3, 4, 5].filter(l => {
                          const candidate = allUsers.find(u => u.id === selectedMember);
                          return candidate && l > candidate.level && l <= user.level;
                        }).map(level => (
                          <SelectItem key={level} value={level.toString()}>
                            Level {level}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Justification</Label>
                    <Textarea
                      placeholder="Explain why this member deserves a promotion..."
                      value={justification}
                      onChange={(e) => setJustification(e.target.value)}
                      rows={3}
                      data-testid="input-justification"
                    />
                    <p className="text-xs text-muted-foreground">{justification.length}/500 characters</p>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsPromoteDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button 
                    onClick={handlePromoteSubmit}
                    disabled={!selectedMember || !selectedLevel || justification.length < 10 || createPromotionMutation.isPending}
                    data-testid="button-submit-promotion"
                  >
                    {createPromotionMutation.isPending ? "Submitting..." : "Submit Proposal"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            
            {user.level === 5 && eligibleForDirectLevel.length > 0 && (
              <Dialog open={isSetLevelDialogOpen} onOpenChange={setIsSetLevelDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="w-full" variant="default" data-testid="button-set-level-directly">
                    <Shield className="h-4 w-4 mr-2" />
                    Set Level Directly
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Set Level Directly</DialogTitle>
                    <p className="text-sm text-muted-foreground">
                      As a Level 5 member, you can directly set levels for members below Level 5 without voting.
                    </p>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Select Member</Label>
                      <Select value={selectedMember} onValueChange={setSelectedMember}>
                        <SelectTrigger data-testid="select-member-direct">
                          <SelectValue placeholder="Choose a member" />
                        </SelectTrigger>
                        <SelectContent>
                          {eligibleForDirectLevel.map(member => (
                            <SelectItem key={member.id} value={member.id}>
                              {member.username || `${member.firstName || ""} ${member.lastName || ""}`.trim() || member.email} (Level {member.level})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Set New Level</Label>
                      <Select value={selectedDirectLevel} onValueChange={setSelectedDirectLevel}>
                        <SelectTrigger data-testid="select-direct-level">
                          <SelectValue placeholder="Select level" />
                        </SelectTrigger>
                        <SelectContent>
                          {[1, 2, 3, 4].filter(l => {
                            const candidate = allUsers.find(u => u.id === selectedMember);
                            return candidate && l !== candidate.level;
                          }).map(level => (
                            <SelectItem key={level} value={level.toString()}>
                              Level {level}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {selectedMember && selectedDirectLevel && (
                        <p className="text-xs text-muted-foreground">
                          {(() => {
                            const candidate = allUsers.find(u => u.id === selectedMember);
                            return candidate 
                              ? `Level ${candidate.level} → Level ${selectedDirectLevel}`
                              : "";
                          })()}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>Reason</Label>
                      <Textarea
                        placeholder="Explain why you're setting this level..."
                        value={directLevelReason}
                        onChange={(e) => setDirectLevelReason(e.target.value)}
                        rows={3}
                        data-testid="input-direct-level-reason"
                      />
                      <p className="text-xs text-muted-foreground">{directLevelReason.length}/500 characters</p>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsSetLevelDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button 
                      onClick={() => {
                        if (!selectedMember || !selectedDirectLevel || directLevelReason.length < 10) return;
                        setLevelDirectlyMutation.mutate({
                          userId: selectedMember,
                          newLevel: parseInt(selectedDirectLevel, 10),
                          reason: directLevelReason,
                        });
                      }}
                      disabled={!selectedMember || !selectedDirectLevel || directLevelReason.length < 10 || setLevelDirectlyMutation.isPending}
                      data-testid="button-submit-direct-level"
                    >
                      {setLevelDirectlyMutation.isPending ? "Setting..." : "Set Level"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </CardContent>
        </Card>
      )}

      {gpiTree && gpiTree.invitees && gpiTree.invitees.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" />
              My Network
            </CardTitle>
          </CardHeader>
          <CardContent>
            <GPIChainNode
              node={gpiTree}
              onSelectUser={(id) => console.log("Selected user:", id)}
            />
          </CardContent>
        </Card>
      )}

      <Button 
        variant="outline" 
        className="w-full text-destructive"
        onClick={handleLogout}
        data-testid="button-logout"
      >
        <LogOut className="h-4 w-4 mr-2" />
        Sign Out
      </Button>
    </div>
  );
}
