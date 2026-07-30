// GROWTH QUEST - Core Database & Repository Pattern Architecture

// Key Interfaces & Data Models
export type UserRole = "JUNIOR" | "MENTOR" | "ADMIN";

export interface UserAccount {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  mustChangePassword: boolean;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  version: number;
}

export interface MentorAssignment {
  id: string;
  mentorUserId: string;
  juniorUserId: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string;
  version: number;
}

export interface WeeklyJournal {
  id: string; // juniorUserId + "_" + week
  juniorUserId: string;
  week: number; // 1 to 12
  status: "DRAFT" | "SUBMITTED";
  
  // STEP 1
  step1_newThings: string;
  step1_memorableThing: string;
  step1_role: string;

  // STEP 2
  step2_difficultThing: string;
  step2_reason: string;
  step2_actionTaken: string;
  step2_helpRequested: "YES" | "NO_SOLVED_ALONE" | "NOT_SOLVED";
  step2_noHelpReason?: string;

  // STEP 3
  step3_hasFeedback: boolean;
  step3_helperAndHelp?: string;
  step3_adviceReceived?: string;
  step3_memorableFeedback?: string;
  step3_feelingAfterFeedback?: string;

  // STEP 4
  step4_goodAction: string;
  step4_goodReason: string;
  step4_wantToImprove: string;
  step4_feedbackActionStatus: "YES_CHANGED" | "NOT_CHANGED" | "NO_FEEDBACK";
  step4_changedActionDetail?: string;
  step4_changedResultDetail?: string;

  // STEP 5
  step5_nextWeekGoal: string;
  step5_verificationMethod: string;
  step5_helperNeeded: string;
  step5_possibleDifficulty: string;
  step5_overcomePlan: string;
  step5_helpPreference: "NEED_HELP" | "CAN_DO_ALONE";

  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface SelfAssessment {
  id: string; // juniorUserId + "_" + week
  juniorUserId: string;
  week: number;
  jobUnderstanding: number; // 1 to 5
  communication: number;
  initiative: number;
  problemSolving: number;
  accuracy: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface MentorFeedback {
  id: string; // juniorUserId + "_" + mentorUserId + "_" + week
  juniorUserId: string;
  mentorUserId: string;
  week: number;
  status: "DRAFT" | "SUBMITTED";

  strengths: string;
  maintainActions: string;
  improvementActions: string;
  nextAction: string;
  overallComment: string;

  competencyScores?: {
    jobUnderstanding?: number;
    communication?: number;
    initiative?: number;
    problemSolving?: number;
    accuracy?: number;
  };

  createdAt: string;
  updatedAt: string;
  updatedByUserId: string;
  version: number;
}

export interface GrowthMapOverride {
  id: string; // juniorUserId + "_" + week
  juniorUserId: string;
  week: number;
  competencyOverrides?: {
    jobUnderstanding?: number;
    communication?: number;
    initiative?: number;
    problemSolving?: number;
    accuracy?: number;
  };
  adminNote?: string;
  createdAt: string;
  updatedAt: string;
  updatedByUserId: string;
  version: number;
}

export interface AuditLog {
  id: string;
  actorUserId: string;
  actionType: string;
  targetUserIds: string[];
  beforeData?: any;
  afterData?: any;
  reason?: string;
  createdAt: string;
}

export interface GrowthDataBackup {
  id: string;
  operationId: string;
  createdByUserId: string;
  dataType: "GROWTH_MAP" | "MENTOR_FEEDBACK" | "BOTH";
  targetJuniorUserIds: string[];
  targetMentorUserIds?: string[];
  targetWeeks: number[];
  backupData: any;
  reason: string;
  createdAt: string;
  restoredAt?: string;
  restoredByUserId?: string;
}

export interface WeeklyAIAnalysis {
  weeklySummary: string;
  growthKeywords: [string, string, string];
  strengths: Array<{ title: string; description: string; evidence: string }>;
  difficulties: Array<{ title: string; description: string; evidence: string; actionSuggestion: string }>;
  behaviorChanges: Array<{ before: string; feedback: string; after: string; result: string }>;
  competencyScores: {
    jobUnderstanding: { score: number; evidence: string; confidence: "low" | "medium" | "high" };
    communication: { score: number; evidence: string; confidence: "low" | "medium" | "high" };
    initiative: { score: number; evidence: string; confidence: "low" | "medium" | "high" };
    problemSolving: { score: number; evidence: string; confidence: "low" | "medium" | "high" };
    accuracy: { score: number; evidence: string; confidence: "low" | "medium" | "high" };
  };
  insufficientEvidence: string[];
  coachingMessage: string;
  nextQuest: { title: string; action: string; successCriteria: string };
}

// Competency Configuration
export const COMPETENCY_CONFIG = [
  {
    key: "jobUnderstanding" as const,
    label: "업무이해역량",
    description: "담당 업무의 목적과 절차를 이해하고, 업무 지시사항을 정확히 파악하여 수행할 수 있었는지를 기준으로 평가해 주세요."
  },
  {
    key: "communication" as const,
    label: "의사소통역량",
    description: "업무 진행 상황과 의견을 명확하게 전달하고, 상대방의 설명과 피드백을 정확히 이해하여 반영했는지를 기준으로 평가해 주세요."
  },
  {
    key: "initiative" as const,
    label: "주도성역량",
    description: "지시를 기다리기보다 필요한 업무를 스스로 찾아 실행하고, 맡은 업무를 책임감 있게 마무리했는지를 기준으로 평가해 주세요."
  },
  {
    key: "problemSolving" as const,
    label: "문제해결역량",
    description: "업무 중 발생한 문제의 원인을 파악하고, 해결 방법을 고민하거나 적절한 도움을 요청하여 문제를 해결했는지를 기준으로 평가해 주세요."
  },
  {
    key: "accuracy" as const,
    label: "정확성역량",
    description: "업무 결과물의 내용과 수치, 일정 등을 꼼꼼히 확인하여 실수나 누락 없이 정확하게 업무를 수행했는지를 기준으로 평가해 주세요."
  }
];

// Simple Secure Password Hashing Helper
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + "_growth_quest_salt_2026");
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
