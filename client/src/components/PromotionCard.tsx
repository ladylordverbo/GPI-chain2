import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { ArrowRight, ThumbsUp, ThumbsDown, ChevronDown, ChevronUp, Shield, ArrowDown } from "lucide-react";
import UserAvatar from "./UserAvatar";
import LevelBadge from "./LevelBadge";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface PromotionCardProps {
  id: string;
  candidateName: string;
  candidateImage?: string;
  currentLevel: 1 | 2 | 3 | 4 | 5;
  proposedLevel: 1 | 2 | 3 | 4 | 5;
  createdByName: string;
  justification: string;
  createdAt: Date;
  votesFor: number;
  votesAgainst: number;
  requiredVotes: number;
  status: "open" | "approved" | "rejected" | "expired";
  requestType?: "PROMOTE" | "DEMOTE" | "PROMOTE_TO_5" | "DEMOTE_FROM_5";
  allowedVoterMinLevel?: number;
  hasVoted?: boolean;
  canVote?: boolean;
  onVote?: (id: string, vote: "for" | "against", comment?: string) => void;
}

const statusStyles = {
  open: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  approved: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  expired: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
};

export default function PromotionCard({
  id,
  candidateName,
  candidateImage,
  currentLevel,
  proposedLevel,
  createdByName,
  justification,
  createdAt,
  votesFor,
  votesAgainst,
  requiredVotes,
  status,
  requestType = "PROMOTE",
  allowedVoterMinLevel = 4,
  hasVoted = false,
  canVote = true,
  onVote,
}: PromotionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [comment, setComment] = useState("");
  const [voting, setVoting] = useState(false);
  
  const progressPercent = requiredVotes > 0 ? Math.min((votesFor / requiredVotes) * 100, 100) : 0;
  const isLevel5Governance = requestType === "PROMOTE_TO_5" || requestType === "DEMOTE_FROM_5";
  const isDemotion = requestType === "DEMOTE" || requestType === "DEMOTE_FROM_5";

  const handleVote = (vote: "for" | "against") => {
    setVoting(true);
    onVote?.(id, vote, comment || undefined);
    setTimeout(() => setVoting(false), 500);
  };

  return (
    <Card className="p-4" data-testid={`card-promotion-${id}`}>
      <div className="flex items-start gap-3">
        <UserAvatar name={candidateName} imageUrl={candidateImage} level={currentLevel} size="md" />
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium" data-testid={`text-candidate-${id}`}>{candidateName}</span>
            <Badge className={cn("text-xs border-0", statusStyles[status])}>
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </Badge>
            {isDemotion && (
              <Badge 
                variant="destructive"
                className="text-xs gap-1"
              >
                <ArrowDown className="h-3 w-3" />Demotion
              </Badge>
            )}
            {isLevel5Governance && !isDemotion && (
              <Badge 
                variant="default"
                className="text-xs gap-1"
              >
                <Shield className="h-3 w-3" />Level 5
              </Badge>
            )}
          </div>
          
          <div className="flex items-center gap-2 mt-1">
            <LevelBadge level={currentLevel} size="sm" />
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <LevelBadge level={proposedLevel} size="sm" />
          </div>
        </div>

        <Button
          size="icon"
          variant="ghost"
          onClick={() => setExpanded(!expanded)}
          data-testid={`button-expand-promotion-${id}`}
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </div>

      <div className="mt-3">
        <div className="flex justify-between text-xs text-muted-foreground mb-1">
          <span>{votesFor} of {requiredVotes} votes needed</span>
          <span>{votesAgainst} against</span>
        </div>
        <Progress value={progressPercent} className="h-2" />
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t space-y-3">
          <div>
            <p className="text-sm text-muted-foreground mb-1">Proposed by {createdByName} on {format(createdAt, "MMM d, yyyy")}</p>
            <p className="text-sm">{justification}</p>
          </div>

          {status === "open" && canVote && !hasVoted && (
            <div className="space-y-3">
              <Textarea
                placeholder="Add a comment (optional)"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="resize-none text-sm"
                rows={2}
                data-testid={`input-vote-comment-${id}`}
              />
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  onClick={() => handleVote("for")}
                  disabled={voting}
                  data-testid={`button-vote-for-${id}`}
                >
                  <ThumbsUp className="h-4 w-4 mr-2" />
                  Vote For
                </Button>
                <Button
                  className="flex-1"
                  variant="outline"
                  onClick={() => handleVote("against")}
                  disabled={voting}
                  data-testid={`button-vote-against-${id}`}
                >
                  <ThumbsDown className="h-4 w-4 mr-2" />
                  Vote Against
                </Button>
              </div>
            </div>
          )}

          {hasVoted && (
            <p className="text-sm text-muted-foreground text-center py-2">You have already voted on this promotion</p>
          )}
        </div>
      )}
    </Card>
  );
}
