// Single Application bundle for Growth Quest
(function() {
  'use strict';

  // --- 1. UTILS & MODELS ---
  const COMPETENCY_CONFIG = [
    {
      key: "jobUnderstanding",
      label: "업무이해역량",
      description: "담당 업무의 목적과 절차를 이해하고, 업무 지시사항을 정확히 파악하여 수행할 수 있었는지를 기준으로 평가해 주세요."
    },
    {
      key: "communication",
      label: "의사소통역량",
      description: "업무 진행 상황과 의견을 명확하게 전달하고, 상대방의 설명과 피드백을 정확히 이해하여 반영했는지를 기준으로 평가해 주세요."
    },
    {
      key: "initiative",
      label: "주도성역량",
      description: "지시를 기다리기보다 필요한 업무를 스스로 찾아 실행하고, 맡은 업무를 책임감 있게 마무리했는지를 기준으로 평가해 주세요."
    },
    {
      key: "problemSolving",
      label: "문제해결역량",
      description: "업무 중 발생한 문제의 원인을 파악하고, 해결 방법을 고민하거나 적절한 도움을 요청하여 문제를 해결했는지를 기준으로 평가해 주세요."
    },
    {
      key: "accuracy",
      label: "정확성역량",
      description: "업무 결과물의 내용과 수치, 일정 등을 꼼꼼히 확인하여 실수나 누락 없이 정확하게 업무를 수행했는지를 기준으로 평가해 주세요."
    }
  ];

  // Helper Hashing Function
  function hashPassword(password) {
    let hash = 0;
    const str = password + "_growth_quest_salt_2026";
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return "HASH_" + Math.abs(hash).toString(16);
  }

  // Helper Default Route by Role (§12)
  function getDefaultRouteByRole(role) {
    if (role === "ADMIN") return "ADMIN_DASHBOARD";
    if (role === "MENTOR") return "MENTOR_DASHBOARD";
    return "HOME";
  }

  // Common Authority Verification Helpers (§13)
  function isMentorAssignedToJunior(mentorUserId, juniorUserId, assignments) {
    return assignments.some(a => a.mentorUserId === mentorUserId && a.juniorUserId === juniorUserId && a.isActive);
  }

  function canMentorViewJunior(currentUser, juniorUserId, assignments) {
    if (!currentUser || currentUser.role !== "MENTOR") return false;
    return isMentorAssignedToJunior(currentUser.id, juniorUserId, assignments);
  }

  // Helper Feedback Summarizer (§11)
  function summarizeFeedbackText(feedback) {
    if (!feedback) return "아직 작성된 내용이 없습니다.";
    // Priority order: 1. Good/Maintain action, 2. Improvement/Next action, 3. Overall comment
    const p1 = (feedback.strengths || feedback.maintainActions || "").trim();
    const p2 = (feedback.improvementActions || feedback.nextAction || "").trim();
    const p3 = (feedback.overallComment || "").trim();

    let combined = "";
    if (p1 && p2) combined = `${p1} ${p2}`;
    else if (p1) combined = p1;
    else if (p2) combined = p2;
    else combined = p3;

    if (!combined) return "등록된 피드백 총평이 있습니다. 상세보기를 확인해주세요.";
    if (combined.length > 100) return combined.substring(0, 97) + "...";
    return combined;
  }

  // --- 2. SINGLE SOURCE OF TRUTH REPOSITORY ENGINE ---
    const firebaseConfig = {
    apiKey: "AIzaSyAZV2o2fJbaRF2VJexHob7smQRqz5IZk74",
    authDomain: "growth-quest-f2154.firebaseapp.com",
    projectId: "growth-quest-f2154",
    storageBucket: "growth-quest-f2154.firebasestorage.app",
    messagingSenderId: "1088789095449",
    appId: "1:1088789095449:web:c087104177698647a07688",
    measurementId: "G-RVEET5E47E"
  };

  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
  const db = firebase.firestore();

  class GrowthQuestStore {
    constructor() {
      this.listeners = [];
      this.data = {
        users: [],
        assignments: [],
        journals: [],
        assessments: [],
        feedbacks: [],
        overrides: [],
        auditLogs: [],
        backups: [],
        programWeeks: []
      };
      this.session = JSON.parse(localStorage.getItem("gq_active_session") || "null");
      this.unsubscribes = [];
      this.init();
    }

    subscribe(listener) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter(l => l !== listener);
      };
    }

    notify() {
      this.listeners.forEach(fn => fn());
    }

    async init() {
      await this.runMigrationIfRequired();
      this.startRealtimeSync();
    }

    async runMigrationIfRequired() {
      const migrated = localStorage.getItem("gq_fb_migrated");
      if (migrated === "true") return;

      console.log("Running one-time Firebase migration...");
      // Migration logic from localStorage to Firestore
      const parseLS = (key) => JSON.parse(localStorage.getItem(key) || "[]");
      const oldUsers = parseLS("gq_user_accounts");
      
      if (oldUsers.length > 0) {
        const batch = db.batch();
        
        oldUsers.forEach(u => {
          batch.set(db.collection("users").doc(u.id), u);
        });

        parseLS("gq_mentor_assignments").forEach(a => {
          batch.set(db.collection("assignments").doc(a.id), a);
        });

        parseLS("gq_weekly_journals").forEach(j => {
          batch.set(db.collection("journals").doc(j.id), j);
        });

        parseLS("gq_self_assessments").forEach(a => {
          batch.set(db.collection("assessments").doc(a.id), a);
        });

        parseLS("gq_mentor_feedbacks").forEach(f => {
          // Format migration v1 -> v2
          const newF = { ...f };
          newF.internalEvaluation = {
            observedStrengths: f.strengths || "",
            improvementsNeeded: f.improvementActions || ""
          };
          newF.juniorVisibleFeedback = {
            overallEncouragement: f.overallComment || ""
          };
          // Remove old keys if desired, but retaining is fine
          batch.set(db.collection("feedbacks").doc(f.id), newF);
        });

        // Initialize 16 Program Weeks
        const pWeeks = [
          { weekNumber: 1, label: "1주차", startDate: "2026-09-01", endDate: "2026-09-04", isSubmissionWeek: true, isExcluded: false },
          { weekNumber: 2, label: "2주차", startDate: "2026-09-07", endDate: "2026-09-11", isSubmissionWeek: true, isExcluded: false },
          { weekNumber: 3, label: "3주차", startDate: "2026-09-14", endDate: "2026-09-18", isSubmissionWeek: true, isExcluded: false },
          { label: "제외기간", startDate: "2026-09-21", endDate: "2026-09-25", isSubmissionWeek: false, isExcluded: true },
          { weekNumber: 4, label: "4주차", startDate: "2026-09-28", endDate: "2026-10-02", isSubmissionWeek: true, isExcluded: false },
          { label: "제외기간", startDate: "2026-10-05", endDate: "2026-10-09", isSubmissionWeek: false, isExcluded: true },
          { weekNumber: 5, label: "5주차", startDate: "2026-10-12", endDate: "2026-10-16", isSubmissionWeek: true, isExcluded: false },
          { weekNumber: 6, label: "6주차", startDate: "2026-10-19", endDate: "2026-10-23", isSubmissionWeek: true, isExcluded: false },
          { weekNumber: 7, label: "7주차", startDate: "2026-10-26", endDate: "2026-10-30", isSubmissionWeek: true, isExcluded: false },
          { weekNumber: 8, label: "8주차", startDate: "2026-11-02", endDate: "2026-11-06", isSubmissionWeek: true, isExcluded: false },
          { weekNumber: 9, label: "9주차", startDate: "2026-11-09", endDate: "2026-11-13", isSubmissionWeek: true, isExcluded: false },
          { weekNumber: 10, label: "10주차", startDate: "2026-11-16", endDate: "2026-11-20", isSubmissionWeek: true, isExcluded: false },
          { weekNumber: 11, label: "11주차", startDate: "2026-11-23", endDate: "2026-11-27", isSubmissionWeek: true, isExcluded: false },
          { weekNumber: 12, label: "12주차", startDate: "2026-11-30", endDate: "2026-12-04", isSubmissionWeek: true, isExcluded: false },
          { weekNumber: 13, label: "13주차", startDate: "2026-12-07", endDate: "2026-12-11", isSubmissionWeek: true, isExcluded: false },
          { weekNumber: 14, label: "14주차", startDate: "2026-12-14", endDate: "2026-12-18", isSubmissionWeek: true, isExcluded: false },
          { weekNumber: 15, label: "15주차", startDate: "2026-12-21", endDate: "2026-12-24", isSubmissionWeek: true, isExcluded: false },
          { weekNumber: 16, label: "16주차", startDate: "2026-12-28", endDate: "2026-12-31", isSubmissionWeek: true, isExcluded: false }
        ];

        pWeeks.forEach((w, i) => {
          const id = "pw_" + i;
          batch.set(db.collection("programWeeks").doc(id), {
            id,
            ...w,
            timezone: "Asia/Seoul",
            isActive: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
        });

        await batch.commit();
      }

      localStorage.setItem("gq_fb_migrated", "true");
      console.log("Migration complete!");
    }

    startRealtimeSync() {
      const collections = ["users", "assignments", "journals", "assessments", "feedbacks", "overrides", "auditLogs", "backups", "programWeeks"];
      collections.forEach(col => {
        const unsub = db.collection(col).onSnapshot(snap => {
          const docs = [];
          snap.forEach(doc => docs.push(doc.data()));
          this.data[col] = docs;
          this.notify();
        });
        this.unsubscribes.push(unsub);
      });
    }

    // GETTERS
    getUsers() { return this.data.users; }
    getUserById(id) { return this.data.users.find(u => u.id === id); }
    getUserByUsername(username) { return this.data.users.find(u => u.username === username); }
    getAssignments() { return this.data.assignments; }
    getJournals() { return this.data.journals; }
    getJournal(juniorUserId, week) { return this.data.journals.find(j => j.juniorUserId === juniorUserId && j.week === week); }
    getAssessments() { return this.data.assessments; }
    getAssessment(juniorUserId, week) { return this.data.assessments.find(a => a.juniorUserId === juniorUserId && a.week === week); }
    getFeedbacks() { return this.data.feedbacks; }
    getFeedback(juniorUserId, mentorUserId, week) { return this.data.feedbacks.find(f => f.juniorUserId === juniorUserId && f.mentorUserId === mentorUserId && f.week === week); }
    getFeedbacksForJunior(juniorUserId) { return this.data.feedbacks.filter(f => f.juniorUserId === juniorUserId); }
    getOverrides() { return this.data.overrides; }
    getAuditLogs() { return this.data.auditLogs; }
    getBackups() { return this.data.backups; }
    getProgramWeeks() { return this.data.programWeeks.sort((a, b) => a.startDate.localeCompare(b.startDate)); }

    // SETTERS (Writing to Firestore)
    async _saveDoc(col, data) {
      if (!data.id) data.id = db.collection(col).doc().id;
      data.updatedAt = new Date().toISOString();
      await db.collection(col).doc(data.id).set(data);
    }

    saveUser(user) { this._saveDoc("users", user); }
    syncMentorAssignments(mentorUserId, juniorUserIds, actorUserId) {
      const existing = this.getAssignments().filter(a => a.mentorUserId === mentorUserId && a.isActive);
      const batch = db.batch();
      
      existing.forEach(a => {
        if (!juniorUserIds.includes(a.juniorUserId)) {
          const ref = db.collection("assignments").doc(a.id);
          batch.update(ref, { isActive: false, updatedAt: new Date().toISOString() });
        }
      });

      juniorUserIds.forEach(jid => {
        if (!existing.some(a => a.juniorUserId === jid)) {
          const ref = db.collection("assignments").doc();
          batch.set(ref, {
            id: ref.id, mentorUserId, juniorUserId: jid, isActive: true, createdByUserId: actorUserId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1
          });
        }
      });
      batch.commit();
    }
    saveJournal(journal) { if (!journal.id) journal.id = journal.juniorUserId + "_" + journal.week; this._saveDoc("journals", journal); }
    saveAssessment(assessment) { if (!assessment.id) assessment.id = assessment.juniorUserId + "_" + assessment.week; this._saveDoc("assessments", assessment); }
    
    saveFeedback(feedback) { 
      if (!feedback.id) feedback.id = feedback.juniorUserId + "_" + feedback.mentorUserId + "_" + feedback.week;
      this._saveDoc("feedbacks", feedback); 
      this.addAuditLog(feedback.mentorUserId, "SAVE_MENTOR_FEEDBACK", [feedback.juniorUserId], null, { week: feedback.week, status: feedback.status });
    }

    addAuditLog(actorUserId, actionType, targetUserIds, beforeData, afterData, reason) {
      this._saveDoc("auditLogs", { actorUserId, actionType, targetUserIds, beforeData, afterData, reason, createdAt: new Date().toISOString() });
    }

    // SESSION
    getCurrentSession() { return this.session; }
    setSession(user) {
      if (user) {
        user.lastLoginAt = new Date().toISOString();
        this.saveUser(user);
        this.session = { id: user.id, username: user.username, role: user.role };
      } else {
        this.session = null;
      }
      localStorage.setItem("gq_active_session", JSON.stringify(this.session));
      this.notify();
    }
    logout() { this.setSession(null); }
  }

  window.gqStore = new GrowthQuestStore();

  // --- 3. PRIVILEGE & SECURITY CHECKER ---
  window.gqAuth = {
    isMentorAssignedToJunior,
    canMentorViewJunior,

    canViewGrowthMap(currentUser, juniorUserId, assignments) {
      if (!currentUser) return false;
      if (currentUser.role === "ADMIN") return true;
      if (currentUser.role === "JUNIOR") return currentUser.id === juniorUserId;
      if (currentUser.role === "MENTOR") {
        return canMentorViewJunior(currentUser, juniorUserId, assignments);
      }
      return false;
    },

    canViewMentorDashboard(currentUser, juniorUserId, assignments) {
      if (!currentUser) return false;
      if (currentUser.role === "ADMIN") return true;
      if (currentUser.role === "MENTOR") {
        return canMentorViewJunior(currentUser, juniorUserId, assignments);
      }
      return false;
    },

    detectPIIOrConfidentialInfo(text) {
      if (!text) return false;
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
      const phoneRegex = /01[016789]-?\d{3,4}-?\d{4}/;
      const ssnRegex = /\d{6}-[1-4]\d{6}/;
      return emailRegex.test(text) || phoneRegex.test(text) || ssnRegex.test(text);
    }
  };

  // --- 4. SIMULATED SERVER Gemini AI COACH ---
  window.gqAICoach = {
    async analyzeJournal(journal, selfAssessment) {
      // Input Security Check
      const fullText = Object.values(journal).join(' ');
      if (window.gqAuth.detectPIIOrConfidentialInfo(fullText)) {
        return {
          error: "개인정보, 고객정보, 구체적인 설비정보, 공정조건, 회사의 기밀정보가 포함된 것으로 보입니다. 익명화 후 다시 작성해 주세요."
        };
      }

      // Generate Rule-based Structured AI Response conforming to required schema
      const jobScore = selfAssessment ? selfAssessment.jobUnderstanding : 3;
      const commScore = selfAssessment ? selfAssessment.communication : 3;
      const initScore = selfAssessment ? selfAssessment.initiative : 3;
      const probScore = selfAssessment ? selfAssessment.problemSolving : 3;
      const accScore = selfAssessment ? selfAssessment.accuracy : 3;

      return {
        weeklySummary: `주니어사원은 금주 ${journal.step1_newThings || '새로운 업무'}에 정면으로 도전하며 ${journal.step2_difficultThing || '도전 과제'}를 주도적으로 해결했습니다.`,
        growthKeywords: ["역량도전", "피드백수용", "목표달성"],
        strengths: [
          {
            title: "주도적 역할 수행",
            description: "어려운 상황에서도 피하지 않고 능동적으로 시도함",
            evidence: journal.step1_role || "팀 과제 담당 및 적극적 협업"
          },
          {
            title: "피드백 반영 노력",
            description: "동료와 멘토의 조언을 바르게 수용하여 개선함",
            evidence: journal.step4_goodAction || "스스로 바꾼 행동 실천"
          }
        ],
        difficulties: [
          {
            title: journal.step2_difficultThing || "업무 적응 및 해결",
            description: journal.step2_reason || "경험 부족으로 인한 어려움",
            evidence: journal.step2_actionTaken || "자가 해결 시도",
            actionSuggestion: "비슷한 난관 발생 시 10분 내 멘토 조언 구하기"
          }
        ],
        behaviorChanges: [
          {
            before: "혼자 고민하며 소모하는 시간 존재",
            feedback: journal.step3_adviceReceived || "중간 공유 활성화 피드백",
            after: journal.step4_changedActionDetail || "주기적 중간 경과 보고 실천",
            result: journal.step4_changedResultDetail || "소통 오류 감소 및 신속한 결론 도출"
          }
        ],
        competencyScores: {
          jobUnderstanding: { score: jobScore, evidence: "주간 업무 진행 내역 작성 검토", confidence: "high" },
          communication: { score: commScore, evidence: "피드백 수용 및 팀 내 소통 기록", confidence: "high" },
          initiative: { score: initScore, evidence: "스스로 시도한 행동 내역", confidence: "medium" },
          problemSolving: { score: probScore, evidence: "어려움 대처 및 해결 절차", confidence: "high" },
          accuracy: { score: accScore, evidence: "목표 및 결과물 검증 방식", confidence: "medium" }
        },
        insufficientEvidence: [],
        coachingMessage: "이번 주 보여주신 도전 자세가 매우 훌륭합니다. 다음 주 목표로 설정한 구체적 액션 플랜을 멘토와 사전에 공유해보세요!",
        nextQuest: {
          title: "주간 피드백 1:1 디브리핑",
          action: journal.step5_nextWeekGoal || "주요 업무목표 멘토와 15분 미팅 진행",
          successCriteria: "목표 체크리스트 멘토 서명 받기"
        }
      };
    }
  };

  // --- 5. RENDER ENGINE & UI ROUTER ---
  class GrowthQuestUI {
    constructor() {
      this.appEl = document.getElementById('app');
      this.currentRoute = null; // Dynamically set per role upon login
      this.selectedJuniorId = null;
      this.selectedWeek = 1;
      this.activeJournalStep = 1;
      this.pwToggle = false;
      this.overridesDraft = {};
      this.selectedMentorForAssign = null; // Admin mentor assignment selected mentor ID
      this.autoSaveStatus = 'IDLE'; // 'SAVING' | 'SUCCESS' | 'ERROR'
      this.lastAutoSaveTime = null;
      this.activeFeedbackModal = null; // Open detail feedback modal
      
      // Auto re-render on data store change
      window.gqStore.subscribe(() => {
        const session = window.gqStore.getCurrentSession();
        if (session) {
          // Re-fetch user in case displayName/role changed
          const fresh = window.gqStore.getUserById(session.id);
          if (fresh && (!fresh.isActive)) {
            this.handleLogout("현재 비활성화된 계정입니다. 운영자에게 문의해주세요.");
            return;
          }
        }
        this.render();
      });

      this.render();
    }

    handleLogout(msg) {
      window.gqStore.logout();
      this.currentRoute = null;
      this.selectedJuniorId = null;
      this.selectedWeek = 1;
      this.activeJournalStep = 1;
      this.renderLogin(msg || '');
    }

    render() {
      const session = window.gqStore.getCurrentSession();

      if (!session) {
        this.renderLogin();
        return;
      }

      const currentUser = window.gqStore.getUserById(session.id);
      if (!currentUser || !currentUser.isActive) {
        this.handleLogout("현재 비활성화된 계정입니다. 운영자에게 문의해주세요.");
        return;
      }

      // Force Password Change Check for JUNIOR
      if (currentUser.mustChangePassword) {
        this.renderPasswordChange(currentUser);
        return;
      }

      // §12 Set Default Route by Role if not set or invalid
      if (!this.currentRoute) {
        this.currentRoute = getDefaultRouteByRole(currentUser.role);
      }

      // §14 Mentor target auto selection logic
      const assignments = window.gqStore.getAssignments();
      if (currentUser.role === "MENTOR") {
        const activeAsgs = window.gqStore.getActiveAssignmentsForMentor(currentUser.id);
        const validJuniorIds = activeAsgs.map(a => a.juniorUserId);

        if (!this.selectedJuniorId || !validJuniorIds.includes(this.selectedJuniorId)) {
          this.selectedJuniorId = validJuniorIds.length > 0 ? validJuniorIds[0] : null;
        }
      } else if (currentUser.role === "JUNIOR") {
        this.selectedJuniorId = currentUser.id;
      } else if (currentUser.role === "ADMIN") {
        if (!this.selectedJuniorId) {
          const juniors = window.gqStore.getUsers().filter(u => u.role === "JUNIOR" && u.isActive);
          if (juniors.length > 0) this.selectedJuniorId = juniors[0].id;
        }
      }

      this.renderShell(currentUser);
    }

    // LOGIN VIEW
    renderLogin(errorMsg = '') {
      this.appEl.innerHTML = `
        <div class="auth-wrapper">
          <div class="auth-card">
            <div class="auth-header">
              <div class="auth-logo">🚀 GROWTH QUEST</div>
              <div class="auth-slogan">GROWTH QUEST와 함께하는 나의 성장 공식</div>
            </div>

            ${errorMsg ? `<div class="alert alert-danger" id="login-error-alert">${errorMsg}</div>` : '<div id="login-error-alert"></div>'}

            <form id="login-form">
              <div class="form-group">
                <label class="form-label" for="username">아이디</label>
                <input type="text" id="username" class="form-input" placeholder="아이디를 입력하세요" required autocomplete="username">
              </div>

              <div class="form-group">
                <label class="form-label" for="password">비밀번호</label>
                <div class="input-wrapper">
                  <input type="${this.pwToggle ? 'text' : 'password'}" id="password" class="form-input" placeholder="비밀번호를 입력하세요" required autocomplete="current-password">
                  <button type="button" class="pw-toggle-btn" id="btn-toggle-pw">${this.pwToggle ? '숨김' : '표시'}</button>
                </div>
              </div>

              <button type="submit" class="btn btn-primary btn-full" id="btn-login-submit">로그인</button>
            </form>

            <div class="security-notice">
              🔒 본 시스템은 SSL 암호화 통신 및 역할별 접근제어를 적용하고 있습니다.<br>
              계정 관련 문의는 인사팀 총괄운영자에게 연결해 주세요.
            </div>
          </div>
        </div>
      `;

      document.getElementById('btn-toggle-pw').onclick = () => {
        this.pwToggle = !this.pwToggle;
        this.renderLogin(errorMsg);
      };

      document.getElementById('login-form').onsubmit = async (e) => {
        e.preventDefault();
        const uVal = document.getElementById('username').value.trim();
        const pVal = document.getElementById('password').value.trim();
        const alertBox = document.getElementById('login-error-alert');

        const targetUser = window.gqStore.getUserByUsername(uVal);
        if (!targetUser || targetUser.passwordHash !== hashPassword(pVal)) {
          alertBox.className = "alert alert-danger";
          alertBox.innerText = "아이디 또는 비밀번호를 확인해주세요.";
          return;
        }

        if (!targetUser.isActive) {
          alertBox.className = "alert alert-danger";
          alertBox.innerText = "현재 비활성화된 계정입니다. 운영자에게 문의해주세요.";
          return;
        }

        window.gqStore.setSession(targetUser);
        this.currentRoute = getDefaultRouteByRole(targetUser.role);
        this.render();
      };
    }

    // MANDATORY FIRST PASSWORD CHANGE VIEW (§1 RELAXED PASSWORD CONDITIONS)
    renderPasswordChange(user) {
      this.appEl.innerHTML = `
        <div class="auth-wrapper">
          <div class="auth-card">
            <div class="auth-header">
              <div class="auth-logo">🔒 비밀번호 변경</div>
              <div class="auth-slogan">최초 접속에 따른 새 비밀번호 설정이 필요합니다.</div>
            </div>

            <div id="pw-change-alert"></div>

            <form id="pw-change-form">
              <div class="form-group">
                <label class="form-label">현재 비밀번호</label>
                <input type="password" id="current-password" class="form-input" placeholder="현재 비밀번호 입력" required>
              </div>

              <div class="form-group">
                <label class="form-label">새 비밀번호</label>
                <input type="password" id="new-password" class="form-input" placeholder="새 비밀번호 입력" required>
              </div>

              <div class="form-group">
                <label class="form-label">새 비밀번호 확인</label>
                <input type="password" id="confirm-password" class="form-input" placeholder="새 비밀번호 재입력" required>
              </div>

              <button type="submit" class="btn btn-primary btn-full">비밀번호 변경 완료</button>
            </form>
          </div>
        </div>
      `;

      document.getElementById('pw-change-form').onsubmit = async (e) => {
        e.preventDefault();
        const curPw = document.getElementById('current-password').value;
        const newPw = document.getElementById('new-password').value;
        const confirmPw = document.getElementById('confirm-password').value;
        const alertBox = document.getElementById('pw-change-alert');

        if (user.passwordHash !== hashPassword(curPw)) {
          alertBox.className = "alert alert-danger";
          alertBox.innerText = "현재 비밀번호가 일치하지 않습니다.";
          return;
        }

        if (!newPw) {
          alertBox.className = "alert alert-danger";
          alertBox.innerText = "새 비밀번호가 빈 값이 아닙니다.";
          return;
        }

        if (newPw !== confirmPw) {
          alertBox.className = "alert alert-danger";
          alertBox.innerText = "새 비밀번호와 비밀번호 확인이 일치하지 않습니다.";
          return;
        }

        user.passwordHash = hashPassword(newPw);
        user.mustChangePassword = false;
        window.gqStore.saveUser(user);
        window.gqStore.setSession(user);
        
        alert("비밀번호가 변경되었습니다.");
        this.currentRoute = getDefaultRouteByRole(user.role);
        this.render();
      };
    }

    // MAIN SHELL LAYOUT (§2 LOGOUT FIXED BUTTON & §3 QUEST BOARD LINK)
    renderShell(user) {
      const roleLabels = { JUNIOR: "주니어사원", MENTOR: "멘토", ADMIN: "인사팀 총괄운영자" };
      const displayName = user.displayName || user.username;

      // Nav Links per role
      let navHtml = '';
      if (user.role === "JUNIOR") {
        navHtml = `
          <a class="nav-item ${this.currentRoute === 'HOME' ? 'active' : ''}" data-route="HOME"><span class="nav-icon">🏠</span> 홈</a>
          <a class="nav-item ${this.currentRoute === 'JOURNAL' ? 'active' : ''}" data-route="JOURNAL"><span class="nav-icon">📝</span> 주니어사원 성장일지</a>
          <a class="nav-item ${this.currentRoute === 'AI_COACH' ? 'active' : ''}" data-route="AI_COACH"><span class="nav-icon">🤖</span> AI 코치</a>
          <a class="nav-item ${this.currentRoute === 'GROWTH_MAP' ? 'active' : ''}" data-route="GROWTH_MAP"><span class="nav-icon">🗺️</span> 성장지도</a>
          <a class="nav-item ${this.currentRoute === 'MENTOR_FEEDBACK_VIEW' ? 'active' : ''}" data-route="MENTOR_FEEDBACK_VIEW"><span class="nav-icon">💬</span> 멘토 피드백</a>
          <a class="nav-item ${this.currentRoute === 'MY_INFO' ? 'active' : ''}" data-route="MY_INFO"><span class="nav-icon">👤</span> 내 정보</a>
        `;
      } else if (user.role === "MENTOR") {
        navHtml = `
          <a class="nav-item ${this.currentRoute === 'MENTOR_DASHBOARD' ? 'active' : ''}" data-route="MENTOR_DASHBOARD"><span class="nav-icon">📊</span> 멘토 대시보드</a>
          <a class="nav-item ${this.currentRoute === 'JOURNAL' ? 'active' : ''}" data-route="JOURNAL"><span class="nav-icon">📝</span> 담당 성장일지 확인</a>
          <a class="nav-item ${this.currentRoute === 'GROWTH_MAP' ? 'active' : ''}" data-route="GROWTH_MAP"><span class="nav-icon">🗺️</span> 주니어 성장지도</a>
          <a class="nav-item ${this.currentRoute === 'MENTOR_FEEDBACK_EDIT' ? 'active' : ''}" data-route="MENTOR_FEEDBACK_EDIT"><span class="nav-icon">✏️</span> 피드백 작성 및 관리</a>
          <a class="nav-item ${this.currentRoute === 'MY_INFO' ? 'active' : ''}" data-route="MY_INFO"><span class="nav-icon">👤</span> 내 정보</a>
        `;
      } else if (user.role === "ADMIN") {
        navHtml = `
          <a class="nav-item ${this.currentRoute === 'ADMIN_DASHBOARD' ? 'active' : ''}" data-route="ADMIN_DASHBOARD"><span class="nav-icon">🏛️</span> 전체 대시보드</a>
          <a class="nav-item ${this.currentRoute === 'USER_MANAGEMENT' ? 'active' : ''}" data-route="USER_MANAGEMENT"><span class="nav-icon">👥</span> 계정 및 권한 관리</a>
          <a class="nav-item ${this.currentRoute === 'ASSIGNMENT_MANAGEMENT' ? 'active' : ''}" data-route="ASSIGNMENT_MANAGEMENT"><span class="nav-icon">🔗</span> 멘토 다중 배정 관리</a>
          <a class="nav-item ${this.currentRoute === 'JOURNAL' ? 'active' : ''}" data-route="JOURNAL"><span class="nav-icon">📝</span> 전체 성장일지</a>
          <a class="nav-item ${this.currentRoute === 'GROWTH_MAP' ? 'active' : ''}" data-route="GROWTH_MAP"><span class="nav-icon">🗺️</span> 전체 성장지도</a>
          <a class="nav-item ${this.currentRoute === 'ADMIN_FEEDBACK_HISTORY' ? 'active' : ''}" data-route="ADMIN_FEEDBACK_HISTORY"><span class="nav-icon">💬</span> 전체 멘토 피드백 이력</a>
          <a class="nav-item ${this.currentRoute === 'ADMIN_WEEKS_SETTINGS' ? 'active' : ''}" data-route="ADMIN_WEEKS_SETTINGS"><span class="nav-icon">📅</span> 운영주차 설정</a>
          <a class="nav-item ${this.currentRoute === 'GROWTH_DATA_MGMT' ? 'active' : ''}" data-route="GROWTH_DATA_MGMT"><span class="nav-icon">⚙️</span> 성장 데이터 관리</a>
          <a class="nav-item ${this.currentRoute === 'AUDIT_LOGS' ? 'active' : ''}" data-route="AUDIT_LOGS"><span class="nav-icon">📜</span> 감사 로그 & 이력</a>
        `;
      }

      this.appEl.innerHTML = `
        <div class="app-layout">
          <aside class="app-sidebar">
            <div class="sidebar-header">
              <div class="sidebar-brand" id="brand-home-link" style="cursor: pointer;">🚀 <span>GROWTH QUEST</span></div>
            </div>

            <div class="user-profile-badge">
              <div class="user-name">${displayName} 님</div>
              <span class="user-role-chip">${roleLabels[user.role]}</span>
            </div>

            <nav class="sidebar-nav">
              ${navHtml}
            </nav>

            <!-- §2 & §3 Sidebar Footer: Quest Board + Fixed Logout Button -->
            <div class="sidebar-footer">
              <a href="https://app.notion.com/p/3ac95a6fed1d8042bc43fabbec458262?v=b2495a6fed1d832e9afb8873c1b4b383&source=copy_link" target="_blank" rel="noopener noreferrer" class="quest-board-btn">
                <span>📌</span> Quest Board <span>↗</span>
              </a>
              <button type="button" class="logout-btn-fixed" id="btn-logout">
                <span>🚪</span> 로그아웃
              </button>
            </div>
          </aside>

          <main class="app-main">
            <header class="app-header">
              <div class="page-title">${this.getRouteTitle()}</div>
              <div class="header-actions">
              </div>
            </header>

            <div class="app-content" id="main-content">
              <!-- Route Content render -->
            </div>
          </main>
        </div>

        ${user.role === 'JUNIOR' ? `
          <nav class="mobile-bottom-nav">
            <a class="nav-item ${this.currentRoute === 'HOME' ? 'active' : ''}" data-route="HOME"><span>🏠</span>홈</a>
            <a class="nav-item ${this.currentRoute === 'JOURNAL' ? 'active' : ''}" data-route="JOURNAL"><span>📝</span>일지</a>
            <a class="nav-item ${this.currentRoute === 'AI_COACH' ? 'active' : ''}" data-route="AI_COACH"><span>🤖</span>AI코치</a>
            <a class="nav-item ${this.currentRoute === 'GROWTH_MAP' ? 'active' : ''}" data-route="GROWTH_MAP"><span>🗺️</span>지도</a>
            <a class="nav-item ${this.currentRoute === 'MENTOR_FEEDBACK_VIEW' ? 'active' : ''}" data-route="MENTOR_FEEDBACK_VIEW"><span>💬</span>피드백</a>
          </nav>
        ` : ''}
      `;

      // §12 Mentor Brand Home Link Click handler
      document.getElementById('brand-home-link').onclick = () => {
        this.currentRoute = getDefaultRouteByRole(user.role);
        this.render();
      };

      // Event Listeners for Nav
      document.querySelectorAll('[data-route]').forEach(el => {
        el.onclick = (e) => {
          e.preventDefault();
          const r = el.getAttribute('data-route');
          this.currentRoute = r;
          this.render();
        };
      });

      document.getElementById('btn-logout').onclick = () => {
        this.handleLogout();
      };

      const selJunior = document.getElementById('target-junior-select');
      if (selJunior) {
        selJunior.onchange = (e) => {
          this.selectedJuniorId = e.target.value;
          this.render();
        };
      }

      this.renderRouteContent(user);
    }

    getRouteTitle() {
      const titles = {
        HOME: "주니어사원 성장 홈",
        JOURNAL: "주니어사원 성장일지 작성 및 확인",
        AI_COACH: "AI 성장 코치 분석",
        GROWTH_MAP: "12주 성장지도 시각화",
        MENTOR_FEEDBACK_VIEW: "담당 멘토 피드백 목록",
        MENTOR_FEEDBACK_EDIT: "멘토 피드백 작성 및 통합 관리",
        ADMIN_FEEDBACK_HISTORY: "전체 멘토 피드백 이력 조회",
        MENTOR_DASHBOARD: "멘토 대시보드",
        ADMIN_DASHBOARD: "인사팀 전체 관리 대시보드",
        USER_MANAGEMENT: "계정 및 권한 관리",
        ASSIGNMENT_MANAGEMENT: "멘토-주니어 다중 배정 관리",
        GROWTH_DATA_MGMT: "성장 데이터 관리 및 초기화",
        AUDIT_LOGS: "감사 로그 & 백업 복구 이력",
        MY_INFO: "내 계정 정보"
      };
      return titles[this.currentRoute] || "GROWTH QUEST";
    }

    renderTargetJuniorSelector(user) {
      if (user.role === "JUNIOR") return '';

      let availableJuniors = [];
      if (user.role === "MENTOR") {
        const asgs = window.gqStore.getActiveAssignmentsForMentor(user.id);
        const juniorIds = asgs.map(a => a.juniorUserId);
        availableJuniors = window.gqStore.getUsers().filter(u => juniorIds.includes(u.id) && u.isActive);
      } else if (user.role === "ADMIN") {
        availableJuniors = window.gqStore.getUsers().filter(u => u.role === "JUNIOR" && u.isActive);
      }

      if (availableJuniors.length === 0) {
        return `<span class="badge badge-warning">현재 배정된 주니어사원이 없습니다.</span>`;
      }

      return `
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <span style="font-size: 0.85rem; font-weight: 600; color: var(--text-muted);">조회 대상 주니어사원:</span>
          <select id="target-junior-select" class="form-select" style="padding: 0.4rem 0.8rem; font-size: 0.85rem; width: auto;">
            ${availableJuniors.map(j => `
              <option value="${j.id}" ${this.selectedJuniorId === j.id ? 'selected' : ''}>${j.displayName} (${j.username})</option>
            `).join('')}
          </select>
        </div>
      `;
    }

    getCurrentKoreanDate() {
      const d = new Date();
      const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
      return new Date(utc + (3600000 * 9));
    }

    getCurrentProgramWeek() {
      const kst = this.getCurrentKoreanDate();
      const kstStr = kst.toISOString().split('T')[0];
      const pWeeks = window.gqStore.getProgramWeeks();
      const current = pWeeks.find(pw => kstStr >= pw.startDate && kstStr <= pw.endDate);
      return current || null;
    }

    // §16 Common Week Selector UI Helper
    renderWeekSelector(selectedWeek, onSelectCallback, availableWeeks = null) {
      const container = document.createElement('div');
      container.className = 'week-selector-container';

      const pWeeks = window.gqStore.getProgramWeeks();
      
      pWeeks.forEach(pw => {
        if (pw.isExcluded) {
          const sep = document.createElement('span');
          sep.className = 'week-separator';
          sep.innerText = pw.label;
          sep.style.fontSize = '0.75rem';
          sep.style.color = 'var(--text-muted)';
          sep.style.padding = '0.5rem';
          container.appendChild(sep);
          return;
        }

        const w = pw.weekNumber;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `week-btn ${w === selectedWeek ? 'active' : ''}`;
        btn.setAttribute('aria-selected', w === selectedWeek ? 'true' : 'false');
        btn.innerText = pw.label;

        if (availableWeeks && !availableWeeks.includes(w)) {
          btn.classList.add('disabled');
        }

        btn.onclick = (e) => {
          e.preventDefault();
          onSelectCallback(w);
        };

        container.appendChild(btn);
      });

      return container;
    }

    renderRouteContent(currentUser) {
      const container = document.getElementById('main-content');
      
      switch (this.currentRoute) {
        case 'HOME':
          this.renderJuniorHome(container, currentUser);
          break;
        case 'JOURNAL':
          this.renderJournalView(container, currentUser);
          break;
        case 'AI_COACH':
          this.renderAICoachView(container, currentUser);
          break;
        case 'GROWTH_MAP':
          this.renderGrowthMapView(container, currentUser);
          break;
        case 'MENTOR_FEEDBACK_VIEW':
          this.renderMentorFeedbackView(container, currentUser);
          break;
        case 'MENTOR_FEEDBACK_EDIT':
          this.renderMentorFeedbackEditView(container, currentUser);
          break;
        case 'ADMIN_FEEDBACK_HISTORY':
          this.renderAdminFeedbackHistoryView(container, currentUser);
          break;
        case 'MENTOR_DASHBOARD':
          this.renderMentorDashboard(container, currentUser);
          break;
        case 'ADMIN_DASHBOARD':
          this.renderAdminDashboard(container, currentUser);
          break;
        case 'USER_MANAGEMENT':
          this.renderUserManagement(container, currentUser);
          break;
        case 'ASSIGNMENT_MANAGEMENT':
          this.renderAssignmentManagement(container, currentUser);
          break;
        case 'GROWTH_DATA_MGMT':
          this.renderGrowthDataMgmt(container, currentUser);
          break;
        case 'ADMIN_WEEKS_SETTINGS':
          this.renderAdminWeeksSettings(container, currentUser);
          break;
        case 'AUDIT_LOGS':
          this.renderAuditLogs(container, currentUser);
          break;
        case 'MY_INFO':
          this.renderMyInfo(container, currentUser);
          break;
        default:
          container.innerHTML = `<div class="card">페이지를 찾을 수 없습니다.</div>`;
      }
    }

    // --- 6. ROUTE VIEWS IMPLEMENTATION ---

    // 8. JUNIOR HOME
    renderJuniorHome(container, user) {
      const targetUserId = user.role === "JUNIOR" ? user.id : this.selectedJuniorId;
      const targetUser = window.gqStore.getUserById(targetUserId);
      const journals = window.gqStore.getJournals().filter(j => j.juniorUserId === targetUserId);
      const pWeeks = window.gqStore.getProgramWeeks();
      const validWeeksCount = pWeeks.filter(w => !w.isExcluded).length;
      
      const submittedCount = journals.filter(j => j.status === 'SUBMITTED').length;
      const rate = validWeeksCount > 0 ? Math.round((submittedCount / validWeeksCount) * 100) : 0;

      const latestJournal = window.gqStore.getJournal(targetUserId, this.selectedWeek);
      const latestFeedbacks = window.gqStore.getFeedbacksForJunior(targetUserId).filter(f => f.status === 'SUBMITTED');

      container.innerHTML = `
        <div class="card" style="background: linear-gradient(135deg, #eef2ff 0%, #f5f3ff 100%); border-color: #c7d2fe;">
          <h2 style="font-size: 1.5rem; font-weight: 800; color: var(--primary); margin-bottom: 0.5rem;">
            ${targetUser ? targetUser.displayName : user.username} 님
          </h2>
          <p style="color: var(--text-muted); font-size: 0.95rem;">
            GROWTH QUEST와 함께하는 나의 성장 공식 | 현재 <strong>${this.selectedWeek}주차</strong> 여정 진행 중입니다.
          </p>
        </div>

        <div class="grid grid-cols-3" style="margin-bottom: 1.5rem;">
          <div class="card" style="text-align: center;">
            <div style="font-size: 0.85rem; color: var(--text-muted); font-weight: 600;">현재 주차</div>
            <div style="font-size: 2rem; font-weight: 800; color: var(--primary); margin-top: 0.25rem;">${this.selectedWeek}주차</div>
          </div>

          <div class="card" style="text-align: center;">
            <div style="font-size: 0.85rem; color: var(--text-muted); font-weight: 600;">성장일지 작성률</div>
            <div style="font-size: 2rem; font-weight: 800; color: var(--secondary); margin-top: 0.25rem;">${rate}%</div>
            <div style="font-size: 0.75rem; color: var(--text-light);">${submittedCount} / ${validWeeksCount} 주차 제출 완료</div>
          </div>

          <div class="card" style="text-align: center;">
            <div style="font-size: 0.85rem; color: var(--text-muted); font-weight: 600;">이번 주 작성 상태</div>
            <div style="margin-top: 0.5rem;">
              ${latestJournal ? (latestJournal.status === 'SUBMITTED' ? '<span class="badge badge-success" style="font-size: 1rem; padding: 0.4rem 0.8rem;">제출 완료</span>' : '<span class="badge badge-warning" style="font-size: 1rem; padding: 0.4rem 0.8rem;">임시 저장 중</span>') : '<span class="badge badge-danger" style="font-size: 1rem; padding: 0.4rem 0.8rem;">미작성</span>'}
            </div>
          </div>
        </div>

        <!-- 6단계: 주니어사원 성장지도 UI 개편 -->
        <div class="card" style="margin-bottom: 1.5rem;">
          <div class="card-header">
            <div class="card-title">🗺️ 나의 전체 성장지도</div>
          </div>
          <div style="display: grid; grid-template-columns: repeat(8, 1fr); gap: 0.5rem; margin-top: 1rem;">
            ${pWeeks.map(w => {
              const jnl = journals.find(j => j.week === w.weekNumber);
              const isCurrent = w.weekNumber === this.selectedWeek;
              
              let bgColor = '#f1f5f9';
              let textColor = '#64748b';
              let pulseClass = '';
              let statusText = '대기';
              
              if (w.isExcluded) {
                bgColor = '#f3f4f6';
                textColor = '#9ca3af';
                statusText = '제외';
              } else if (jnl && jnl.status === 'SUBMITTED') {
                bgColor = '#dcfce7';
                textColor = '#16a34a';
                statusText = '완료';
              } else if (jnl && jnl.status === 'DRAFT') {
                bgColor = '#fef3c7';
                textColor = '#d97706';
                statusText = '작성중';
              } else if (w.weekNumber < this.selectedWeek) {
                bgColor = '#fee2e2';
                textColor = '#ef4444';
                statusText = '미제출';
              }

              if (isCurrent) {
                pulseClass = 'pulse-animation';
                if (!jnl || jnl.status !== 'SUBMITTED') {
                  bgColor = '#dbeafe';
                  textColor = '#2563eb';
                  statusText = '진행중';
                }
              }

              return `
                <div class="${pulseClass}" style="background-color: ${bgColor}; color: ${textColor}; padding: 0.75rem 0.5rem; border-radius: var(--radius-sm); text-align: center; border: ${isCurrent ? '2px solid #3b82f6' : '1px solid transparent'}; box-shadow: ${isCurrent ? '0 0 10px rgba(59, 130, 246, 0.5)' : 'none'};">
                  <div style="font-size: 0.8rem; font-weight: bold;">${w.weekNumber}주차</div>
                  <div style="font-size: 0.7rem; margin-top: 0.2rem;">${statusText}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div class="grid grid-cols-2">
          <div class="card">
            <div class="card-header">
              <div class="card-title">🎯 다음 주 성장 목표</div>
            </div>
            <p style="font-size: 0.95rem; line-height: 1.6; color: var(--text-main);">
              ${latestJournal && latestJournal.step5_nextWeekGoal ? latestJournal.step5_nextWeekGoal : '아직 작성된 다음 주 목표가 없습니다. 성장일지를 작성해 보세요.'}
            </p>
          </div>

          <div class="card">
            <div class="card-header">
              <div class="card-title">💬 최근 멘토 피드백 알림</div>
            </div>
            ${latestFeedbacks.length > 0 ? `
              <div style="font-size: 0.9rem; color: var(--text-main);">
                <strong>${latestFeedbacks[0].mentorName || window.gqStore.getUserById(latestFeedbacks[0].mentorUserId)?.displayName || '담당 멘토'}</strong> 님의 피드백:<br>
                <span style="color: var(--text-muted); display: block; margin-top: 0.4rem; white-space: pre-wrap;">"${latestFeedbacks[0].juniorVisibleFeedback?.overallEncouragement || latestFeedbacks[0].overallComment || '격려의 메시지가 도착했습니다.'}"</span>
              </div>
            ` : `<p style="font-size: 0.9rem; color: var(--text-muted);">제출된 멘토 피드백이 아직 없습니다.</p>`}
          </div>
        </div>
      `;
    }

    renderJournalView(container, user) {
      const targetUserId = user.role === "JUNIOR" ? user.id : this.selectedJuniorId;
      const targetUser = window.gqStore.getUserById(targetUserId);

      // §13 Common Authority Verification
      const assignments = window.gqStore.getAssignments();
      if (user.role === "MENTOR" && !window.gqAuth.canMentorViewJunior(user, targetUserId, assignments)) {
        container.innerHTML = `<div class="alert alert-danger">해당 주니어사원의 성장일지를 조회할 권한이 없습니다.</div>`;
        return;
      }

      if (!targetUserId) {
        container.innerHTML = `<div class="card" style="text-align: center; padding: 2rem; color: var(--text-muted);">현재 배정된 주니어사원이 없습니다.</div>`;
        return;
      }

      const journal = window.gqStore.getJournal(targetUserId, this.selectedWeek) || {
        juniorUserId: targetUserId,
        week: this.selectedWeek,
        status: "DRAFT",
        step1_newThings: "", step1_memorableThing: "", step1_role: "",
        step2_difficultThing: "", step2_reason: "", step2_actionTaken: "", step2_helpRequested: "NO_SOLVED_ALONE", step2_noHelpReason: "",
        step3_hasFeedback: true, step3_helperAndHelp: "", step3_adviceReceived: "", step3_memorableFeedback: "", step3_feelingAfterFeedback: "",
        step4_goodAction: "", step4_goodReason: "", step4_wantToImprove: "", step4_feedbackActionStatus: "NO_FEEDBACK", step4_changedActionDetail: "", step4_changedResultDetail: "",
        step5_nextWeekGoal: "", step5_verificationMethod: "", step5_helperNeeded: "", step5_possibleDifficulty: "", step5_overcomePlan: "", step5_helpPreference: "CAN_DO_ALONE"
      };

      const assessment = window.gqStore.getAssessment(targetUserId, this.selectedWeek) || {
        juniorUserId: targetUserId,
        week: this.selectedWeek,
        jobUnderstanding: 3, communication: 3, initiative: 3, problemSolving: 3, accuracy: 3
      };

      const readOnly = user.role !== "JUNIOR";

      container.innerHTML = `
        <div class="card">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
            <div>
              <h3 style="font-size: 1.2rem; font-weight: 700;">${targetUser ? targetUser.displayName : ''} 주니어사원 성장일지</h3>
              <p style="font-size: 0.85rem; color: var(--text-muted);">12주 주차별 성장 경험 기록 및 자가진단</p>
            </div>

            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <!-- §8 Auto-save Indicator Status -->
              <span id="auto-save-indicator" style="font-size: 0.8rem; color: var(--text-muted); font-weight: 600;">
                ${this.lastAutoSaveTime ? `임시저장 완료 · ${this.lastAutoSaveTime}` : ''}
              </span>
              <span class="badge ${journal.status === 'SUBMITTED' ? 'badge-success' : 'badge-warning'}">
                ${journal.status === 'SUBMITTED' ? '제출 완료' : '임시 저장'}
              </span>
            </div>
          </div>

          <!-- §6 & §16 Button-type Week Selector for Admin / Selector for all -->
          <div id="journal-week-selector-placeholder"></div>

          <!-- Security Privacy Warning -->
          <div class="alert alert-warning" style="font-size: 0.85rem; margin-bottom: 1.5rem;">
            ⚠️ <strong>개인정보 및 보안 안내:</strong><br>
            개인정보, 고객정보, 구체적인 설비정보, 공정조건, 회사의 기밀정보는 입력하지 마세요. 사람 이름은 직책이나 익명 표현으로 작성해주세요.
          </div>

          <!-- Stepper navigation -->
          <div class="stepper-container">
            <div class="step-item ${this.activeJournalStep === 1 ? 'active' : ''}" data-step="1">
              <div class="step-circle">1</div>
              <div class="step-label">이번 주 한 일</div>
            </div>
            <div class="step-item ${this.activeJournalStep === 2 ? 'active' : ''}" data-step="2">
              <div class="step-circle">2</div>
              <div class="step-label">어려웠던 일</div>
            </div>
            <div class="step-item ${this.activeJournalStep === 3 ? 'active' : ''}" data-step="3">
              <div class="step-circle">3</div>
              <div class="step-label">도움과 피드백</div>
            </div>
            <div class="step-item ${this.activeJournalStep === 4 ? 'active' : ''}" data-step="4">
              <div class="step-circle">4</div>
              <div class="step-label">행동 돌아보기</div>
            </div>
            <div class="step-item ${this.activeJournalStep === 5 ? 'active' : ''}" data-step="5">
              <div class="step-circle">5</div>
              <div class="step-label">목표 & 자가진단</div>
            </div>
          </div>

          <form id="journal-form">
            <!-- STEP 1 -->
            <div class="journal-step-content" id="step-1-form" style="display: ${this.activeJournalStep === 1 ? 'block' : 'none'};">
              <h4 style="margin-bottom: 1rem; color: var(--primary);">STEP 1. 이번 주에 한 일</h4>
              <div class="form-group">
                <label class="form-label">1. 이번 주에 새롭게 해본 일은 무엇인가요?</label>
                <textarea id="step1_newThings" class="form-textarea" rows="3" placeholder="처음으로 팀 회의에 참석해 회의 내용을 정리했습니다." ${readOnly ? 'disabled' : ''}>${journal.step1_newThings || ''}</textarea>
              </div>
              <div class="form-group">
                <label class="form-label">2. 이번 주에 가장 기억에 남는 일은 무엇인가요?</label>
                <textarea id="step1_memorableThing" class="form-textarea" rows="3" placeholder="직접 작성한 자료를 팀원들 앞에서 설명한 일이 기억에 남습니다." ${readOnly ? 'disabled' : ''}>${journal.step1_memorableThing || ''}</textarea>
              </div>
              <div class="form-group">
                <label class="form-label">3. 그 일에서 내가 맡은 역할은 무엇이었나요?</label>
                <textarea id="step1_role" class="form-textarea" rows="3" placeholder="회의 내용을 정리하고 필요한 자료를 찾는 역할을 맡았습니다." ${readOnly ? 'disabled' : ''}>${journal.step1_role || ''}</textarea>
              </div>
            </div>

            <!-- STEP 2 -->
            <div class="journal-step-content" id="step-2-form" style="display: ${this.activeJournalStep === 2 ? 'block' : 'none'};">
              <h4 style="margin-bottom: 1rem; color: var(--primary);">STEP 2. 어려웠던 일</h4>
              <div class="form-group">
                <label class="form-label">1. 이번 주에 가장 어려웠던 일은 무엇인가요?</label>
                <textarea id="step2_difficultThing" class="form-textarea" rows="3" ${readOnly ? 'disabled' : ''}>${journal.step2_difficultThing || ''}</textarea>
              </div>
              <div class="form-group">
                <label class="form-label">2. 어떠한 이유 때문에 어렵다고 생각했나요?</label>
                <textarea id="step2_reason" class="form-textarea" rows="3" ${readOnly ? 'disabled' : ''}>${journal.step2_reason || ''}</textarea>
              </div>
              <div class="form-group">
                <label class="form-label">3. 어려웠을 때 나는 어떻게 행동했나요?</label>
                <textarea id="step2_actionTaken" class="form-textarea" rows="3" ${readOnly ? 'disabled' : ''}>${journal.step2_actionTaken || ''}</textarea>
              </div>
              <div class="form-group">
                <label class="form-label">4. 다른 사람에게 도움을 요청했나요?</label>
                <select id="step2_helpRequested" class="form-select" ${readOnly ? 'disabled' : ''}>
                  <option value="YES" ${journal.step2_helpRequested === 'YES' ? 'selected' : ''}>네, 도움을 요청했어요.</option>
                  <option value="NO_SOLVED_ALONE" ${journal.step2_helpRequested === 'NO_SOLVED_ALONE' ? 'selected' : ''}>아니요, 혼자 해결했어요.</option>
                  <option value="NOT_SOLVED" ${journal.step2_helpRequested === 'NOT_SOLVED' ? 'selected' : ''}>아직 해결하지 못했어요.</option>
                </select>
              </div>
              <div class="form-group" id="group-no-help-reason" style="display: ${journal.step2_helpRequested === 'NO_SOLVED_ALONE' ? 'block' : 'none'};">
                <label class="form-label">도움을 요청하지 않은 이유는 무엇인가요?</label>
                <textarea id="step2_noHelpReason" class="form-textarea" rows="2" ${readOnly ? 'disabled' : ''}>${journal.step2_noHelpReason || ''}</textarea>
              </div>
            </div>

            <!-- STEP 3 -->
            <div class="journal-step-content" id="step-3-form" style="display: ${this.activeJournalStep === 3 ? 'block' : 'none'};">
              <h4 style="margin-bottom: 1rem; color: var(--primary);">STEP 3. 도움과 피드백</h4>
              <div class="form-group">
                <label class="form-label" style="display: flex; align-items: center; gap: 0.5rem;">
                  <input type="checkbox" id="step3_noFeedbackCheck" ${!journal.step3_hasFeedback ? 'checked' : ''} ${readOnly ? 'disabled' : ''}>
                  이번 주에는 받은 피드백이 없어요.
                </label>
              </div>
              <div id="step-3-details" style="display: ${journal.step3_hasFeedback ? 'block' : 'none'};">
                <div class="form-group">
                  <label class="form-label">1. 누구에게 어떤 도움을 받았나요?</label>
                  <textarea id="step3_helperAndHelp" class="form-textarea" rows="2" ${readOnly ? 'disabled' : ''}>${journal.step3_helperAndHelp || ''}</textarea>
                </div>
                <div class="form-group">
                  <label class="form-label">2. 어떤 조언이나 피드백을 받았나요?</label>
                  <textarea id="step3_adviceReceived" class="form-textarea" rows="2" ${readOnly ? 'disabled' : ''}>${journal.step3_adviceReceived || ''}</textarea>
                </div>
                <div class="form-group">
                  <label class="form-label">3. 가장 기억에 남는 피드백은 무엇인가요?</label>
                  <textarea id="step3_memorableFeedback" class="form-textarea" rows="2" ${readOnly ? 'disabled' : ''}>${journal.step3_memorableFeedback || ''}</textarea>
                </div>
                <div class="form-group">
                  <label class="form-label">4. 피드백을 들은 뒤 어떤 생각이 들었나요?</label>
                  <textarea id="step3_feelingAfterFeedback" class="form-textarea" rows="2" ${readOnly ? 'disabled' : ''}>${journal.step3_feelingAfterFeedback || ''}</textarea>
                </div>
              </div>
            </div>

            <!-- STEP 4 -->
            <div class="journal-step-content" id="step-4-form" style="display: ${this.activeJournalStep === 4 ? 'block' : 'none'};">
              <h4 style="margin-bottom: 1rem; color: var(--primary);">STEP 4. 나의 행동 돌아보기</h4>
              <div class="form-group">
                <label class="form-label">1. 이번 주에 내가 잘한 행동은 무엇인가요?</label>
                <textarea id="step4_goodAction" class="form-textarea" rows="2" ${readOnly ? 'disabled' : ''}>${journal.step4_goodAction || ''}</textarea>
              </div>
              <div class="form-group">
                <label class="form-label">2. 왜 잘한 행동이라고 생각하나요?</label>
                <textarea id="step4_goodReason" class="form-textarea" rows="2" ${readOnly ? 'disabled' : ''}>${journal.step4_goodReason || ''}</textarea>
              </div>
              <div class="form-group">
                <label class="form-label">3. 다음에는 어떤 행동을 더 잘하고 싶나요?</label>
                <textarea id="step4_wantToImprove" class="form-textarea" rows="2" ${readOnly ? 'disabled' : ''}>${journal.step4_wantToImprove || ''}</textarea>
              </div>
              <div class="form-group">
                <label class="form-label">4. 피드백을 받은 뒤 바꾼 행동이 있나요?</label>
                <select id="step4_feedbackActionStatus" class="form-select" ${readOnly ? 'disabled' : ''}>
                  <option value="YES_CHANGED" ${journal.step4_feedbackActionStatus === 'YES_CHANGED' ? 'selected' : ''}>네, 바꾼 행동이 있어요.</option>
                  <option value="NOT_CHANGED" ${journal.step4_feedbackActionStatus === 'NOT_CHANGED' ? 'selected' : ''}>아직 바꾸지 못했어요.</option>
                  <option value="NO_FEEDBACK" ${journal.step4_feedbackActionStatus === 'NO_FEEDBACK' ? 'selected' : ''}>이번 주에는 받은 피드백이 없어요.</option>
                </select>
              </div>
              <div id="step-4-changed-details" style="display: ${journal.step4_feedbackActionStatus === 'YES_CHANGED' ? 'block' : 'none'};">
                <div class="form-group">
                  <label class="form-label">어떤 행동을 바꿨나요?</label>
                  <textarea id="step4_changedActionDetail" class="form-textarea" rows="2" ${readOnly ? 'disabled' : ''}>${journal.step4_changedActionDetail || ''}</textarea>
                </div>
                <div class="form-group">
                  <label class="form-label">행동을 바꾼 뒤 무엇이 달라졌나요?</label>
                  <textarea id="step4_changedResultDetail" class="form-textarea" rows="2" ${readOnly ? 'disabled' : ''}>${journal.step4_changedResultDetail || ''}</textarea>
                </div>
              </div>
            </div>

            <!-- STEP 5 & COMPETENCY ASSESSMENTS -->
            <div class="journal-step-content" id="step-5-form" style="display: ${this.activeJournalStep === 5 ? 'block' : 'none'};">
              <h4 style="margin-bottom: 1rem; color: var(--primary);">STEP 5. 다음 주 목표</h4>
              <div class="form-group">
                <label class="form-label">1. 다음 주에 꼭 해보고 싶은 행동은 무엇인가요?</label>
                <textarea id="step5_nextWeekGoal" class="form-textarea" rows="2" ${readOnly ? 'disabled' : ''}>${journal.step5_nextWeekGoal || ''}</textarea>
              </div>
              <div class="form-group">
                <label class="form-label">2. 목표를 이루었는지 어떻게 확인할 수 있나요?</label>
                <textarea id="step5_verificationMethod" class="form-textarea" rows="2" ${readOnly ? 'disabled' : ''}>${journal.step5_verificationMethod || ''}</textarea>
              </div>
              <div class="form-group">
                <label class="form-label">3. 목표를 위해 누구의 도움이 필요한가요?</label>
                <textarea id="step5_helperNeeded" class="form-textarea" rows="2" ${readOnly ? 'disabled' : ''}>${journal.step5_helperNeeded || ''}</textarea>
              </div>
              <div class="form-group">
                <label class="form-label">4. 어떤 어려움이 생길 수 있나요?</label>
                <textarea id="step5_possibleDifficulty" class="form-textarea" rows="2" ${readOnly ? 'disabled' : ''}>${journal.step5_possibleDifficulty || ''}</textarea>
              </div>
              <div class="form-group">
                <label class="form-label">5. 그 어려움이 생기면 어떻게 해볼까요?</label>
                <textarea id="step5_overcomePlan" class="form-textarea" rows="2" ${readOnly ? 'disabled' : ''}>${journal.step5_overcomePlan || ''}</textarea>
              </div>
              <div class="form-group">
                <label class="form-label">도움 필요 여부 선택</label>
                <select id="step5_helpPreference" class="form-select" ${readOnly ? 'disabled' : ''}>
                  <option value="NEED_HELP" ${journal.step5_helpPreference === 'NEED_HELP' ? 'selected' : ''}>도움이 필요해요.</option>
                  <option value="CAN_DO_ALONE" ${journal.step5_helpPreference === 'CAN_DO_ALONE' ? 'selected' : ''}>혼자 해볼 수 있어요.</option>
                </select>
              </div>

              <!-- 11. WEEKLY COMPETENCY SELF ASSESSMENT -->
              <div style="margin-top: 2rem; padding-top: 1.5rem; border-top: 2px dashed var(--border);">
                <h4 style="margin-bottom: 0.5rem; color: var(--secondary);">📊 주간 역량 자가진단 (1점 ~ 5점)</h4>
                <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1.5rem;">각 역량별 표준 설명에 기반하여 금주 본인의 성장 기준을 진단해 주세요.</p>

                ${COMPETENCY_CONFIG.map(cfg => `
                  <div style="background: #f8fafc; border-radius: var(--radius-md); padding: 1rem; margin-bottom: 1rem; border: 1px solid var(--border);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                      <span style="font-weight: 700; color: var(--text-main); font-size: 0.95rem;">${cfg.label}</span>
                      <span style="font-weight: 800; color: var(--primary); font-size: 1.1rem;" id="val-${cfg.key}">${assessment[cfg.key] || 3}점</span>
                    </div>
                    <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.75rem; line-height: 1.4;">${cfg.description}</p>
                    <input type="range" id="score-${cfg.key}" min="1" max="5" step="1" value="${assessment[cfg.key] || 3}" style="width: 100%; accent-color: var(--primary);" ${readOnly ? 'disabled' : ''}>
                  </div>
                `).join('')}
              </div>
            </div>

            <!-- Footer Action Buttons -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--border);">
              <div>
                <button type="button" class="btn btn-outline" id="btn-prev-step" ${this.activeJournalStep === 1 ? 'disabled' : ''}>이전 단계</button>
              </div>
              <div style="display: flex; gap: 0.5rem;">
                ${!readOnly ? `
                  <button type="button" class="btn btn-secondary" id="btn-draft-save">임시저장</button>
                  ${this.activeJournalStep === 5 ? '<button type="submit" class="btn btn-primary" id="btn-submit-final">최종 제출</button>' : ''}
                ` : ''}
                ${this.activeJournalStep < 5 ? '<button type="button" class="btn btn-primary" id="btn-next-step">다음 단계</button>' : ''}
              </div>
            </div>
          </form>
        </div>
      `;

      // Render Common Week Selector
      const weekSelectorContainer = this.renderWeekSelector(this.selectedWeek, (w) => {
        if (!readOnly && !this.executeAutoSave()) return;
        this.selectedWeek = w;
        this.render();
      });
      document.getElementById('journal-week-selector-placeholder').replaceWith(weekSelectorContainer);

      // §8 Form Data Collection & Auto Save Implementation
      const collectFormData = (status) => {
        const jData = {
          id: targetUserId + "_" + this.selectedWeek,
          juniorUserId: targetUserId,
          week: this.selectedWeek,
          status,
          step1_newThings: document.getElementById('step1_newThings')?.value || '',
          step1_memorableThing: document.getElementById('step1_memorableThing')?.value || '',
          step1_role: document.getElementById('step1_role')?.value || '',
          step2_difficultThing: document.getElementById('step2_difficultThing')?.value || '',
          step2_reason: document.getElementById('step2_reason')?.value || '',
          step2_actionTaken: document.getElementById('step2_actionTaken')?.value || '',
          step2_helpRequested: document.getElementById('step2_helpRequested')?.value || 'NO_SOLVED_ALONE',
          step2_noHelpReason: document.getElementById('step2_noHelpReason')?.value || '',
          step3_hasFeedback: !document.getElementById('step3_noFeedbackCheck')?.checked,
          step3_helperAndHelp: document.getElementById('step3_helperAndHelp')?.value || '',
          step3_adviceReceived: document.getElementById('step3_adviceReceived')?.value || '',
          step3_memorableFeedback: document.getElementById('step3_memorableFeedback')?.value || '',
          step3_feelingAfterFeedback: document.getElementById('step3_feelingAfterFeedback')?.value || '',
          step4_goodAction: document.getElementById('step4_goodAction')?.value || '',
          step4_goodReason: document.getElementById('step4_goodReason')?.value || '',
          step4_wantToImprove: document.getElementById('step4_wantToImprove')?.value || '',
          step4_feedbackActionStatus: document.getElementById('step4_feedbackActionStatus')?.value || 'NO_FEEDBACK',
          step4_changedActionDetail: document.getElementById('step4_changedActionDetail')?.value || '',
          step4_changedResultDetail: document.getElementById('step4_changedResultDetail')?.value || '',
          step5_nextWeekGoal: document.getElementById('step5_nextWeekGoal')?.value || '',
          step5_verificationMethod: document.getElementById('step5_verificationMethod')?.value || '',
          step5_helperNeeded: document.getElementById('step5_helperNeeded')?.value || '',
          step5_possibleDifficulty: document.getElementById('step5_possibleDifficulty')?.value || '',
          step5_overcomePlan: document.getElementById('step5_overcomePlan')?.value || '',
          step5_helpPreference: document.getElementById('step5_helpPreference')?.value || 'CAN_DO_ALONE'
        };

        const aData = {
          id: targetUserId + "_" + this.selectedWeek,
          juniorUserId: targetUserId,
          week: this.selectedWeek,
          jobUnderstanding: parseInt(document.getElementById('score-jobUnderstanding')?.value || 3, 10),
          communication: parseInt(document.getElementById('score-communication')?.value || 3, 10),
          initiative: parseInt(document.getElementById('score-initiative')?.value || 3, 10),
          problemSolving: parseInt(document.getElementById('score-problemSolving')?.value || 3, 10),
          accuracy: parseInt(document.getElementById('score-accuracy')?.value || 3, 10)
        };

        return { jData, aData };
      };

      this.executeAutoSave = () => {
        if (readOnly) return true;
        try {
          const { jData, aData } = collectFormData('DRAFT');
          window.gqStore.saveJournal(jData);
          window.gqStore.saveAssessment(aData);

          const now = new Date();
          const timeStr = `${now.getHours() > 12 ? '오후' : '오전'} ${now.getHours() % 12 || 12}:${String(now.getMinutes()).padStart(2, '0')}`;
          this.lastAutoSaveTime = timeStr;
          
          const ind = document.getElementById('auto-save-indicator');
          if (ind) ind.innerText = `임시저장 완료 · ${timeStr}`;
          return true;
        } catch (e) {
          console.error("Auto save failed:", e);
          alert("작성한 내용을 임시저장하지 못했습니다. 다시 시도해주세요.");
          return false;
        }
      };

      // Real-time Event Listeners for UX (Step 2 conditional and Sliders)
      const helpSelect = document.getElementById('step2_helpRequested');
      const noHelpGroup = document.getElementById('group-no-help-reason');
      const noHelpReasonInput = document.getElementById('step2_noHelpReason');
      if (helpSelect && noHelpGroup) {
        helpSelect.onchange = () => {
          if (helpSelect.value === 'NO_SOLVED_ALONE') {
            noHelpGroup.style.display = 'block';
          } else {
            noHelpGroup.style.display = 'none';
            if (noHelpReasonInput) noHelpReasonInput.value = '';
          }
        };
      }

      COMPETENCY_CONFIG.forEach(cfg => {
        const slider = document.getElementById(`score-${cfg.key}`);
        const valDisplay = document.getElementById(`val-${cfg.key}`);
        if (slider && valDisplay) {
          slider.oninput = (e) => {
            valDisplay.innerText = `${e.target.value}점`;
            slider.setAttribute('aria-valuenow', e.target.value);
          };
        }
      });

      // Event Handlers for Stepper
      document.querySelectorAll('.step-item').forEach(item => {
        item.onclick = () => {
          const nextStep = parseInt(item.getAttribute('data-step'), 10);
          if (!readOnly && !this.executeAutoSave()) return;
          this.activeJournalStep = nextStep;
          this.render();
        };
      });

      document.getElementById('btn-prev-step').onclick = () => {
        if (this.activeJournalStep > 1) {
          if (!readOnly && !this.executeAutoSave()) return;
          this.activeJournalStep--;
          this.render();
        }
      };

      const btnNext = document.getElementById('btn-next-step');
      if (btnNext) {
        btnNext.onclick = () => {
          if (this.activeJournalStep < 5) {
            if (!readOnly && !this.executeAutoSave()) return;
            this.activeJournalStep++;
            this.render();
          }
        };
      }

      if (!readOnly) {
        document.getElementById('btn-draft-save').onclick = () => {
          if (this.executeAutoSave()) {
            alert('변경사항이 저장되었습니다.');
          }
        };

        document.getElementById('journal-form').onsubmit = (e) => {
          e.preventDefault();
          const { jData, aData } = collectFormData('SUBMITTED');
          window.gqStore.saveJournal(jData);
          window.gqStore.saveAssessment(aData);
          alert('성장일지가 최종 제출되었습니다.');
          this.currentRoute = 'AI_COACH';
          this.render();
        };
      }
    }

    // §9. JUNIOR AI COACH VIEW WITH BUTTON-TYPE WEEK SELECTOR
    async renderAICoachView(container, user) {
      const targetUserId = user.role === "JUNIOR" ? user.id : this.selectedJuniorId;
      const journal = window.gqStore.getJournal(targetUserId, this.selectedWeek);
      const assessment = window.gqStore.getAssessment(targetUserId, this.selectedWeek);

      // Get available weeks with submitted journals for button status
      const userJournals = window.gqStore.getJournals().filter(j => j.juniorUserId === targetUserId && j.status === 'SUBMITTED');
      const availableWeeks = userJournals.map(j => j.week);

      container.innerHTML = `
        <div class="card">
          <div class="card-header"><div class="card-title">🤖 AI 주간 성장 코치 분석</div></div>
          <div id="ai-week-selector-placeholder"></div>

          ${(!journal || journal.status !== 'SUBMITTED') ? `
            <div style="text-align: center; padding: 3rem;">
              <div style="font-size: 3rem; margin-bottom: 1rem;">🤖</div>
              <h3 style="font-size: 1.2rem; font-weight: 700; margin-bottom: 0.5rem;">해당 주차의 AI 코치 결과가 없습니다.</h3>
              <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 1.5rem;">
                ${this.selectedWeek}주차 성장일지가 아직 제출되지 않았습니다.
              </p>
              ${user.role === 'JUNIOR' ? '<button class="btn btn-primary" id="btn-go-journal">성장일지 작성하러 가기</button>' : ''}
            </div>
          ` : `
            <div id="ai-analysis-result-container">
              <div style="text-align: center; padding: 2rem;">⚡ Gemini AI 성장 코치가 분석 중입니다...</div>
            </div>
          `}
        </div>
      `;

      // Render Common Week Selector
      const weekSelectorContainer = this.renderWeekSelector(this.selectedWeek, (w) => {
        this.selectedWeek = w;
        this.render();
      }, availableWeeks);
      document.getElementById('ai-week-selector-placeholder').replaceWith(weekSelectorContainer);

      const btnGo = document.getElementById('btn-go-journal');
      if (btnGo) {
        btnGo.onclick = () => {
          this.currentRoute = 'JOURNAL';
          this.render();
        };
      }

      if (journal && journal.status === 'SUBMITTED') {
        const aiRes = await window.gqAICoach.analyzeJournal(journal, assessment);
        const resultEl = document.getElementById('ai-analysis-result-container');
        if (!resultEl) return;

        if (aiRes.error) {
          resultEl.innerHTML = `<div class="alert alert-danger">${aiRes.error}</div>`;
          return;
        }

        resultEl.innerHTML = `
          <div class="card" style="background: linear-gradient(135deg, #1e1b4b 0%, #31104b 100%); color: white; margin-bottom: 1.5rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
              <div style="font-size: 1.25rem; font-weight: 800;">🤖 Gemini 주간 성장 분석 (${this.selectedWeek}주차)</div>
              <div style="display: flex; gap: 0.4rem;">
                ${aiRes.growthKeywords.map(k => `<span class="badge" style="background: rgba(255,255,255,0.2); color: white;">#${k}</span>`).join('')}
              </div>
            </div>
            <p style="font-size: 1rem; line-height: 1.6; opacity: 0.95;">${aiRes.weeklySummary}</p>
          </div>

          <div class="grid grid-cols-2">
            <div class="card">
              <div class="card-header"><div class="card-title">🌟 기여 강점 (행동 근거)</div></div>
              ${aiRes.strengths.map(s => `
                <div style="margin-bottom: 1rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border);">
                  <div style="font-weight: 700; color: var(--primary); font-size: 0.95rem;">${s.title}</div>
                  <div style="font-size: 0.85rem; color: var(--text-main); margin: 0.25rem 0;">${s.description}</div>
                  <div style="font-size: 0.75rem; color: var(--text-muted); background: #f8fafc; padding: 0.4rem 0.6rem; border-radius: 4px;">근거: ${s.evidence}</div>
                </div>
              `).join('')}
            </div>

            <div class="card">
              <div class="card-header"><div class="card-title">💡 행동 변화 파악 (Before → After)</div></div>
              ${aiRes.behaviorChanges.map(b => `
                <div style="font-size: 0.85rem; line-height: 1.5;">
                  <div style="color: var(--danger);"><strong>이전 (Before):</strong> ${b.before}</div>
                  <div style="color: var(--info); margin: 0.2rem 0;"><strong>수용 피드백:</strong> ${b.feedback}</div>
                  <div style="color: var(--success);"><strong>변화 (After):</strong> ${b.after}</div>
                  <div style="color: var(--primary); margin-top: 0.2rem;"><strong>결과:</strong> ${b.result}</div>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="card" style="border-left: 4px solid var(--secondary);">
            <div class="card-header"><div class="card-title">🎯 AI 추천 다음 주 퀘스트</div></div>
            <h4 style="font-size: 1.05rem; font-weight: 700; color: var(--secondary); margin-bottom: 0.25rem;">${aiRes.nextQuest.title}</h4>
            <p style="font-size: 0.9rem; color: var(--text-main); margin-bottom: 0.5rem;">${aiRes.nextQuest.action}</p>
            <div style="font-size: 0.8rem; color: var(--text-muted);">달성 검증 기준: ${aiRes.nextQuest.successCriteria}</div>
          </div>
        `;
      }
    }

    // GROWTH MAP VIEW
    renderGrowthMapView(container, user) {
      const targetUserId = user.role === "JUNIOR" ? user.id : this.selectedJuniorId;
      const targetUser = window.gqStore.getUserById(targetUserId);

      const assignments = window.gqStore.getAssignments();
      if (user.role === "MENTOR" && !window.gqAuth.canMentorViewJunior(user, targetUserId, assignments)) {
        container.innerHTML = `<div class="alert alert-danger">해당 주니어사원의 성장지도를 조회할 권한이 없습니다.</div>`;
        return;
      }

      if (!targetUserId) {
        container.innerHTML = `<div class="card" style="text-align: center; padding: 2rem; color: var(--text-muted);">현재 배정된 주니어사원이 없습니다.</div>`;
        return;
      }

      const assessments = window.gqStore.getAssessments().filter(a => a.juniorUserId === targetUserId);
      const overrides = window.gqStore.getOverrides().filter(o => o.juniorUserId === targetUserId);

      const validWeeksCount = window.gqStore.getProgramWeeks().filter(pw => !pw.isExcluded).length;
      const weekScores = Array.from({length: validWeeksCount}, (_, i) => {
        const w = i + 1;
        const raw = assessments.find(a => a.week === w);
        const ovr = overrides.find(o => o.week === w);

        const job = ovr?.competencyOverrides?.jobUnderstanding ?? raw?.jobUnderstanding ?? 0;
        const comm = ovr?.competencyOverrides?.communication ?? raw?.communication ?? 0;
        const init = ovr?.competencyOverrides?.initiative ?? raw?.initiative ?? 0;
        const prob = ovr?.competencyOverrides?.problemSolving ?? raw?.problemSolving ?? 0;
        const acc = ovr?.competencyOverrides?.accuracy ?? raw?.accuracy ?? 0;

        const avg = (job + comm + init + prob + acc) / (raw || ovr ? 5 : 1);
        return { week: w, job, comm, init, prob, acc, avg: Math.round(avg * 10) / 10, hasData: !!(raw || ovr) };
      });

      container.innerHTML = `
        <div class="alert alert-info" style="font-size: 0.85rem; margin-bottom: 1.5rem;">
          📊 <strong>성장지도 데이터 출처:</strong> 자가진단 원본 기반 자동 계산<br>
          자가진단 원본: ${assessments.length}건 | 성장지도 계산 가능 주차: ${weekScores.filter(w => w.hasData).length}건 | 저장된 파생 캐시: 0건 | 관리자 보정값: ${overrides.length}건
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">📈 주 종합 성장점수 변화 (${targetUser ? targetUser.displayName : ''} 님)</div>
          </div>
          <div style="height: 300px; position: relative;">
            <canvas id="growthChart"></canvas>
          </div>
        </div>

        <div class="grid grid-cols-5">
          ${COMPETENCY_CONFIG.map(cfg => {
            const keyMap = { jobUnderstanding: 'job', communication: 'comm', initiative: 'init', problemSolving: 'prob', accuracy: 'acc' };
            const scores = weekScores.map(w => w[keyMap[cfg.key]]).filter(s => s > 0);
            const latest = scores.length > 0 ? scores[scores.length - 1] : 0;
            const first = scores.length > 0 ? scores[0] : 0;
            const diff = Math.round((latest - first) * 10) / 10;

            return `
              <div class="card" style="padding: 1.2rem; text-align: center;">
                <div style="font-size: 0.85rem; font-weight: 700; color: var(--text-muted);">${cfg.label}</div>
                <div style="font-size: 1.75rem; font-weight: 800; color: var(--primary); margin: 0.3rem 0;">${latest || '-'} 점</div>
                <div style="font-size: 0.75rem; color: ${diff >= 0 ? 'var(--success)' : 'var(--danger)'};">
                  ${diff >= 0 ? '▲ +' + diff : '▼ ' + diff} (1주 대비)
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;

      setTimeout(() => {
        const ctx = document.getElementById('growthChart')?.getContext('2d');
        if (ctx && window.Chart) {
          new window.Chart(ctx, {
            type: 'line',
            data: {
              labels: weekScores.map(w => w.week + '주차'),
              datasets: [{
                label: '종합 평균 성장점수 (5점 만점)',
                data: weekScores.map(w => w.hasData ? w.avg : null),
                borderColor: '#4f46e5',
                backgroundColor: 'rgba(79, 70, 229, 0.1)',
                fill: true,
                tension: 0.3,
                pointRadius: 6
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              scales: {
                y: { min: 1, max: 5 }
              }
            }
          });
        }
      }, 50);
    }

    // §20. MENTOR DASHBOARD REVAMP (§20-1 Headliner + §20-2 4-Metrics Row)
    renderMentorDashboard(container, user) {
      const assignments = window.gqStore.getActiveAssignmentsForMentor(user.id);
      const assignedJuniorUserIds = [...new Set(assignments.map(a => a.juniorUserId))];
      const juniors = window.gqStore.getUsers().filter(u => assignedJuniorUserIds.includes(u.id) && u.isActive);

      const submittedJournalsCount = juniors.filter(j => {
        const jl = window.gqStore.getJournal(j.id, this.selectedWeek);
        return jl && jl.status === 'SUBMITTED';
      }).length;

      const unsubmittedJournalsCount = juniors.length - submittedJournalsCount;

      const submittedFeedbacksCount = juniors.filter(j => {
        const fb = window.gqStore.getFeedback(j.id, user.id, this.selectedWeek);
        return fb && fb.status === 'SUBMITTED';
      }).length;

      const unsubmittedFeedbacksCount = juniors.length - submittedFeedbacksCount;

      const juniorNamesList = juniors.map(j => j.displayName).join(' · ');

      container.innerHTML = `
        <!-- §20-1 Headliner Card -->
        <div class="card" style="background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%); color: white; padding: 2rem;">
          <div style="font-size: 1rem; font-weight: 600; opacity: 0.9; margin-bottom: 0.5rem; text-transform: uppercase; letter-spacing: 0.5px;">
            담당 주니어사원 현황
          </div>
          <div style="display: flex; align-items: baseline; gap: 1.5rem; flex-wrap: wrap; margin-bottom: 1rem;">
            <div style="font-size: 3rem; font-weight: 900; color: #818cf8; line-height: 1;">
              총 ${juniors.length}명
            </div>
            <div style="font-size: 1.25rem; font-weight: 700; color: #f8fafc;">
              ${juniors.length > 0 ? juniorNamesList : '현재 배정된 주니어사원이 없습니다.'}
            </div>
          </div>
          <div style="font-size: 0.85rem; opacity: 0.8;">
            로그인 멘토: <strong>${user.displayName}</strong> | 선택 주차: <strong>${this.selectedWeek}주차</strong>
          </div>
        </div>

        <!-- §20-2 4 Metrics 1 Row Layout (PC: 4 cols) -->
        <div class="grid grid-cols-4" style="margin-bottom: 1.5rem;">
          <div class="card" style="text-align: center; border-left: 4px solid var(--success);">
            <div style="font-size: 0.85rem; font-weight: 700; color: var(--text-muted);">이번 주 성장일지 제출</div>
            <div style="font-size: 2.2rem; font-weight: 800; color: var(--success); margin: 0.3rem 0;">${submittedJournalsCount}명</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">담당 인원 중 (${juniors.length > 0 ? Math.round((submittedJournalsCount/juniors.length)*100) : 0}%)</div>
          </div>

          <div class="card" style="text-align: center; border-left: 4px solid var(--danger);">
            <div style="font-size: 0.85rem; font-weight: 700; color: var(--text-muted);">이번 주 성장일지 미제출</div>
            <div style="font-size: 2.2rem; font-weight: 800; color: var(--danger); margin: 0.3rem 0;">${unsubmittedJournalsCount}명</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">담당 인원 중 (${juniors.length > 0 ? Math.round((unsubmittedJournalsCount/juniors.length)*100) : 0}%)</div>
          </div>

          <div class="card" style="text-align: center; border-left: 4px solid var(--secondary);">
            <div style="font-size: 0.85rem; font-weight: 700; color: var(--text-muted);">멘토 피드백 작성 완료</div>
            <div style="font-size: 2.2rem; font-weight: 800; color: var(--secondary); margin: 0.3rem 0;">${submittedFeedbacksCount}명</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">담당 인원 중 (${juniors.length > 0 ? Math.round((submittedFeedbacksCount/juniors.length)*100) : 0}%)</div>
          </div>

          <div class="card" style="text-align: center; border-left: 4px solid var(--warning);">
            <div style="font-size: 0.85rem; font-weight: 700; color: var(--text-muted);">멘토 피드백 미작성</div>
            <div style="font-size: 2.2rem; font-weight: 800; color: var(--warning); margin: 0.3rem 0;">${unsubmittedFeedbacksCount}명</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">담당 인원 중 (${juniors.length > 0 ? Math.round((unsubmittedFeedbacksCount/juniors.length)*100) : 0}%)</div>
          </div>
        </div>

        <!-- Junior Details Cards Grid -->
        <div class="grid grid-cols-2">
          ${juniors.map(j => {
            const journals = window.gqStore.getJournals().filter(jl => jl.juniorUserId === j.id && jl.status === 'SUBMITTED');
            const validWeeksCount = window.gqStore.getProgramWeeks().filter(pw => !pw.isExcluded).length;
            const latestJournal = window.gqStore.getJournal(j.id, this.selectedWeek);
            const feedback = window.gqStore.getFeedback(j.id, user.id, this.selectedWeek);

            return `
              <div class="card">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
                  <div>
                    <h3 style="font-size: 1.2rem; font-weight: 800; color: var(--text-main);">${j.displayName}</h3>
                    <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.2rem;">현재 ${this.selectedWeek}주차</div>
                  </div>
                  <span class="badge ${latestJournal?.status === 'SUBMITTED' ? 'badge-success' : 'badge-warning'}">
                    ${latestJournal?.status === 'SUBMITTED' ? '이번주 제출 완료' : '미제출'}
                  </span>
                </div>

                <div style="background: #f8fafc; padding: 0.85rem; border-radius: var(--radius-md); margin-bottom: 1rem; font-size: 0.85rem;">
                  <div>성장일지 작성률: <strong>${validWeeksCount > 0 ? Math.round((journals.length / validWeeksCount) * 100) : 0}%</strong> (${journals.length}/${validWeeksCount} 주)</div>
                  <div style="margin-top: 0.25rem;">피드백 작성 상태: <strong>${feedback ? (feedback.status === 'SUBMITTED' ? '피드백 제출됨' : '임시 저장 중') : '미작성'}</strong></div>
                </div>

                <div style="display: flex; gap: 0.5rem;">
                  <button class="btn btn-secondary btn-full btn-select-junior-journal" data-id="${j.id}">성장일지 확인</button>
                  <button class="btn btn-outline btn-full btn-select-junior-map" data-id="${j.id}">성장지도</button>
                  <button class="btn btn-primary btn-full btn-select-junior-fb" data-id="${j.id}">피드백 작성</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;

      document.querySelectorAll('.btn-select-junior-journal').forEach(b => {
        b.onclick = () => {
          this.selectedJuniorId = b.getAttribute('data-id');
          this.currentRoute = 'JOURNAL';
          this.render();
        };
      });

      document.querySelectorAll('.btn-select-junior-map').forEach(b => {
        b.onclick = () => {
          this.selectedJuniorId = b.getAttribute('data-id');
          this.currentRoute = 'GROWTH_MAP';
          this.render();
        };
      });

      document.querySelectorAll('.btn-select-junior-fb').forEach(b => {
        b.onclick = () => {
          this.selectedJuniorId = b.getAttribute('data-id');
          this.currentRoute = 'MENTOR_FEEDBACK_EDIT';
          this.render();
        };
      });
    }

    // §13 & §7 & §17. MENTOR FEEDBACK EDIT VIEW WITH BUTTON-TYPE WEEK SELECTOR
    renderMentorFeedbackEditView(container, user) {
      const targetJuniorId = this.selectedJuniorId;
      const targetJunior = window.gqStore.getUserById(targetJuniorId);

      // Mentor Junior Selection UI (Tabs)
      let juniorTabsHtml = '';
      let targetList = [];
      if (user.role === 'MENTOR') {
        const assignments = window.gqStore.getAssignments().filter(a => a.mentorUserId === user.id && a.isActive);
        const myJuniorIds = assignments.map(a => a.juniorUserId);
        targetList = window.gqStore.getUsers().filter(u => myJuniorIds.includes(u.id) && u.isActive);
      } else if (user.role === 'ADMIN') {
        targetList = window.gqStore.getUsers().filter(u => u.role === 'JUNIOR' && u.isActive);
      }

      if (targetList.length > 0) {
        if (!this.selectedJuniorId || !targetList.find(j => j.id === this.selectedJuniorId)) {
          this.selectedJuniorId = targetList[0].id;
        }
        juniorTabsHtml = `
          <div style="display:flex; gap:0.5rem; margin-bottom: 1.5rem; flex-wrap: wrap;">
            ${targetList.map(j => `
              <button class="btn ${j.id === this.selectedJuniorId ? 'btn-primary' : 'btn-outline'} btn-sm fb-junior-tab" data-id="${j.id}">${j.displayName}</button>
            `).join('')}
          </div>
        `;
      } else {
        container.innerHTML = `<div class="card" style="text-align: center; padding: 2rem; color: var(--text-muted);">현재 배정된 주니어사원이 없습니다.</div>`;
        return;
      }

      // Ensure we have a valid targetJunior for rendering
      const currentJunior = window.gqStore.getUserById(this.selectedJuniorId);

      const existing = window.gqStore.getFeedback(this.selectedJuniorId, user.id, this.selectedWeek) || {
        juniorUserId: this.selectedJuniorId,
        mentorUserId: user.id,
        week: this.selectedWeek,
        status: "DRAFT",
        mentorTeam: "",
        mentorName: user.displayName,
        internalEvaluation: {
          observedStrengths: "",
          improvementsNeeded: ""
        },
        juniorVisibleFeedback: {
          overallEncouragement: ""
        }
      };

      container.innerHTML = `
        ${juniorTabsHtml}
        <div class="card">
          <div class="card-header">
            <div class="card-title">📝 멘토 피드백 작성 (${currentJunior ? currentJunior.displayName : ''} 주니어사원)</div>
          </div>

          <div id="fb-edit-week-selector-placeholder"></div>

          <form id="mentor-feedback-form">
            <div class="grid grid-cols-2" style="gap: 1rem; margin-bottom: 1rem;">
              <div class="form-group">
                <label class="form-label">소속 팀/본부</label>
                <input type="text" id="fb-mentor-team" class="form-input" value="${existing.mentorTeam || ''}" placeholder="예) 개발1팀">
              </div>
              <div class="form-group">
                <label class="form-label">멘토 성명</label>
                <input type="text" id="fb-mentor-name" class="form-input" value="${existing.mentorName || user.displayName}">
              </div>
            </div>

            <div style="background: #fffbeb; padding: 1rem; border-radius: var(--radius-md); border-left: 4px solid #f59e0b; margin-bottom: 1.5rem;">
              <h3 style="font-size: 1.1rem; font-weight: bold; color: #b45309; margin-bottom: 0.5rem;">🔒 내부 평가 작성란 (주니어사원 미노출)</h3>
              <p style="font-size: 0.85rem; color: #92400e; margin-bottom: 1rem;">이 항목들은 관리자와 멘토만 볼 수 있으며, 주니어사원에게는 공개되지 않습니다.</p>
              
              <div class="form-group">
                <label class="form-label">관찰된 주니어사원의 강점</label>
                <textarea id="fb-internal-strengths" class="form-textarea" rows="3" placeholder="예) 주도적으로 과제를 진행함">${existing.internalEvaluation?.observedStrengths || existing.strengths || ''}</textarea>
              </div>

              <div class="form-group">
                <label class="form-label">보완 및 개선이 필요한 부분</label>
                <textarea id="fb-internal-improvements" class="form-textarea" rows="3">${existing.internalEvaluation?.improvementsNeeded || existing.improvementActions || ''}</textarea>
              </div>
            </div>

            <div style="background: #f0fdf4; padding: 1rem; border-radius: var(--radius-md); border-left: 4px solid #22c55e; margin-bottom: 1.5rem;">
              <h3 style="font-size: 1.1rem; font-weight: bold; color: #166534; margin-bottom: 0.5rem;">📢 주니어사원 전달 피드백 (노출됨)</h3>
              <p style="font-size: 0.85rem; color: #15803d; margin-bottom: 1rem;">이 내용은 주니어사원이 시스템에서 직접 확인할 수 있습니다.</p>

              <div class="form-group">
                <label class="form-label">종합 코멘트 및 격려사</label>
                <textarea id="fb-visible-encouragement" class="form-textarea" rows="4" placeholder="따뜻한 격려의 말을 남겨주세요.">${existing.juniorVisibleFeedback?.overallEncouragement || existing.overallComment || ''}</textarea>
              </div>
            </div>

            <div style="display: flex; gap: 1rem; justify-content: flex-end; margin-top: 1.5rem;">
              <button type="button" class="btn btn-outline" id="btn-fb-draft">임시저장</button>
              <button type="submit" class="btn btn-primary" id="btn-fb-submit">최종 제출 완료</button>
            </div>
          </form>
        </div>
      `;

      document.querySelectorAll('.fb-junior-tab').forEach(btn => {
        btn.onclick = (e) => {
          this.selectedJuniorId = e.currentTarget.getAttribute('data-id');
          this.render();
        };
      });

      const weekSelectorContainer = this.renderWeekSelector(this.selectedWeek, (w) => {
        this.selectedWeek = w;
        this.render();
      });
      document.getElementById('fb-edit-week-selector-placeholder').replaceWith(weekSelectorContainer);

      const saveFb = (status) => {
        const fbData = {
          id: this.selectedJuniorId + "_" + user.id + "_" + this.selectedWeek,
          juniorUserId: this.selectedJuniorId,
          mentorUserId: user.id,
          week: this.selectedWeek,
          status,
          mentorTeam: document.getElementById('fb-mentor-team').value,
          mentorName: document.getElementById('fb-mentor-name').value,
          internalEvaluation: {
            observedStrengths: document.getElementById('fb-internal-strengths').value,
            improvementsNeeded: document.getElementById('fb-internal-improvements').value
          },
          juniorVisibleFeedback: {
            overallEncouragement: document.getElementById('fb-visible-encouragement').value
          },
          updatedByUserId: user.id,
          updatedAt: new Date().toISOString()
        };
        window.gqStore.saveFeedback(fbData);
        alert('피드백이 저장되었습니다.');
      };

      document.getElementById('btn-fb-draft').onclick = () => saveFb('DRAFT');
      document.getElementById('mentor-feedback-form').onsubmit = (e) => {
        e.preventDefault();
        saveFb('SUBMITTED');
        this.render();
      };
    }
    renderMentorFeedbackView(container, user) {
      const targetJuniorId = user.role === "JUNIOR" ? user.id : this.selectedJuniorId;
      const feedbacks = window.gqStore.getFeedbacksForJunior(targetJuniorId).filter(f => f.week === this.selectedWeek && f.status === 'SUBMITTED');

      container.innerHTML = `
        <div class="card">
          <div class="card-header">
            <div class="card-title">💬 담당 멘토 피드백 목록 (${this.selectedWeek}주차)</div>
          </div>

          <!-- Button-type Week Selector -->
          <div id="fb-view-week-selector-placeholder"></div>

          ${feedbacks.length === 0 ? `
            <div style="text-align: center; padding: 2.5rem; color: var(--text-muted);">
              등록된 피드백 내용이 없습니다.
            </div>
          ` : `
            <div class="grid grid-cols-1">
              ${feedbacks.map(f => {
                const mentor = window.gqStore.getUserById(f.mentorUserId);
                const summary = summarizeFeedbackText(f);
                const dateStr = new Date(f.updatedAt).toLocaleDateString();

                return `
                  <div class="card" style="border-left: 4px solid var(--primary); margin-bottom: 1rem;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                      <div>
                        <span class="badge badge-primary" style="margin-bottom: 0.25rem;">${f.week}주차 피드백</span>
                        <h4 style="font-weight: 800; color: var(--text-main); font-size: 1.05rem;">
                          👤 ${mentor ? mentor.displayName : f.mentorUserId} 멘토
                        </h4>
                      </div>
                      <span style="font-size: 0.75rem; color: var(--text-muted);">${dateStr}</span>
                    </div>

                    <!-- §18-1 Summarized max 2 lines text -->
                    <p class="feedback-summary" style="font-size: 0.9rem; color: var(--text-muted); margin: 0.75rem 0; line-height: 1.5; background: #f8fafc; padding: 0.75rem; border-radius: var(--radius-md);">
                      "${summary}"
                    </p>
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>
      `;

      const weekSelectorContainer = this.renderWeekSelector(this.selectedWeek, (w) => {
        this.selectedWeek = w;
        this.render();
      });
      document.getElementById('fb-view-week-selector-placeholder').appendChild(weekSelectorContainer);
    }

    // §16. ADMIN ALL MENTOR FEEDBACK HISTORY (READ-ONLY FOR ALL JUNIORS & MENTORS)
    renderAdminFeedbackHistoryView(container, adminUser) {
      const allJuniors = window.gqStore.getUsers().filter(u => u.role === "JUNIOR" && u.isActive);
      if (!this.selectedJuniorId && allJuniors.length > 0) {
        this.selectedJuniorId = allJuniors[0].id;
      }
      const selectedJunior = allJuniors.find(u => u.id === this.selectedJuniorId) || allJuniors[0];

      // Search & Filter
      const searchTerm = (this.adminFbSearchTerm || "").trim().toLowerCase();
      const filteredJuniors = allJuniors.filter(j => 
        j.displayName.toLowerCase().includes(searchTerm) || j.username.toLowerCase().includes(searchTerm)
      );

      // Mentor Assignments for Selected Junior (Active & Historical)
      const allAssignments = window.gqStore.getAssignments().filter(a => a.juniorUserId === selectedJunior?.id);
      const mentorIds = [...new Set(allAssignments.map(a => a.mentorUserId))];
      const mentors = mentorIds.map(mid => window.gqStore.getUserById(mid)).filter(Boolean);

      container.innerHTML = `
        <div class="card">
          <div class="card-header">
            <div class="card-title">💬 전체 멘토 피드백 이력 (총괄운영자 전용 조회)</div>
          </div>

          <!-- §16-1 Junior Selection Dropdown & Search -->
          <div style="background: #f8fafc; padding: 1.25rem; border-radius: var(--radius-md); margin-bottom: 1.5rem; border: 1px solid var(--border); display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 250px;">
              <label class="form-label" style="margin-bottom: 0.3rem;">조회할 주니어사원 선택</label>
              <select id="admin-fb-junior-select" class="form-select">
                ${filteredJuniors.map(j => `
                  <option value="${j.id}" ${j.id === selectedJunior?.id ? 'selected' : ''}>
                    ${j.displayName} (${j.username})
                  </option>
                `).join('')}
              </select>
            </div>

            <div style="flex: 1; min-width: 200px;">
              <label class="form-label" style="margin-bottom: 0.3rem;">주니어사원 이름/아이디 검색</label>
              <input type="text" id="admin-fb-search-input" class="form-input" placeholder="이름 검색..." value="${this.adminFbSearchTerm || ''}">
            </div>
          </div>

          <!-- §16-2 Button-type Week Selector (1~12주차) -->
          <div id="admin-fb-week-selector-placeholder" style="margin-bottom: 1.5rem;"></div>

          <!-- §16-3 & §16-4 Feedback Status & Content per Mentor -->
          <h3 style="font-size: 1.1rem; font-weight: 800; color: var(--text-main); margin-bottom: 1rem;">
            ${selectedJunior ? selectedJunior.displayName : ''} 주니어사원 · ${this.selectedWeek}주차 멘토 피드백 이력
          </h3>

          ${mentors.length === 0 ? `
            <div style="text-align: center; padding: 2.5rem; color: var(--text-muted); background: #f8fafc; border-radius: var(--radius-md);">
              해당 주니어사원에게 배정되었거나 배정된 멘토가 없습니다.
            </div>
          ` : `
            <div class="grid grid-cols-1">
              ${mentors.map(m => {
                const asg = allAssignments.find(a => a.mentorUserId === m.id);
                const isCurrentlyAssigned = asg ? asg.isActive : false;
                const fb = window.gqStore.getFeedback(selectedJunior.id, m.id, this.selectedWeek);

                let statusBadge = '<span class="badge badge-danger">❌ 미작성</span>';
                let statusText = '미작성';
                if (fb) {
                  if (fb.status === 'SUBMITTED') {
                    statusBadge = '<span class="badge badge-success">✅ 작성 완료</span>';
                    statusText = '작성 완료';
                  } else {
                    statusBadge = '<span class="badge badge-warning">📝 임시저장</span>';
                    statusText = '임시저장';
                  }
                }

                return `
                  <div class="card" style="border: 1px solid var(--border); box-shadow: none; background: ${isCurrentlyAssigned ? '#ffffff' : '#f8fafc'};">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem; border-bottom: 1px solid var(--border); padding-bottom: 0.75rem;">
                      <div>
                        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
                          <h4 style="font-size: 1.1rem; font-weight: 800; color: var(--text-main);">
                            👤 ${m.displayName} (${m.username})
                          </h4>
                          <span class="badge ${isCurrentlyAssigned ? 'badge-info' : 'badge-warning'}">
                            ${isCurrentlyAssigned ? '현재 담당 멘토' : '과거 담당 멘토'}
                          </span>
                        </div>
                        <div style="font-size: 0.8rem; color: var(--text-muted);">
                          최초 작성일: ${fb ? new Date(fb.createdAt).toLocaleDateString() : '-'} | 최근 수정일: ${fb ? new Date(fb.updatedAt).toLocaleString() : '-'}
                        </div>
                      </div>

                      <div style="text-align: right;">
                        <div style="font-size: 0.85rem; font-weight: 700; margin-bottom: 0.2rem;">작성 상태: ${statusText}</div>
                        ${statusBadge}
                      </div>
                    </div>

                    ${fb ? `
                      <div style="font-size: 0.9rem; line-height: 1.6; display: flex; flex-direction: column; gap: 0.75rem;">
                        <div style="background: #f1f5f9; padding: 0.75rem; border-radius: var(--radius-sm);">
                          <strong style="color: var(--primary); display: block; margin-bottom: 0.2rem;">1. 잘한 행동 (강점)</strong>
                          <div>${fb.strengths || '-'}</div>
                        </div>

                        <div style="background: #f1f5f9; padding: 0.75rem; border-radius: var(--radius-sm);">
                          <strong style="color: var(--primary); display: block; margin-bottom: 0.2rem;">2. 지속 유지할 행동</strong>
                          <div>${fb.maintainActions || '-'}</div>
                        </div>

                        <div style="background: #f1f5f9; padding: 0.75rem; border-radius: var(--radius-sm);">
                          <strong style="color: var(--primary); display: block; margin-bottom: 0.2rem;">3. 개선이 필요한 행동</strong>
                          <div>${fb.improvementActions || '-'}</div>
                        </div>

                        <div style="background: #f1f5f9; padding: 0.75rem; border-radius: var(--radius-sm);">
                          <strong style="color: var(--primary); display: block; margin-bottom: 0.2rem;">4. 다음 주 추천 액션</strong>
                          <div>${fb.nextAction || '-'}</div>
                        </div>

                        <div style="background: #eef2ff; padding: 0.75rem; border-radius: var(--radius-sm); border-left: 3px solid var(--primary);">
                          <strong style="color: var(--primary); display: block; margin-bottom: 0.2rem;">5. 종합 의견</strong>
                          <div>${fb.overallComment || '-'}</div>
                        </div>
                      </div>
                    ` : `
                      <div style="text-align: center; padding: 1.5rem; color: var(--text-muted); font-size: 0.9rem;">
                        선택한 ${this.selectedWeek}주차에 해당 멘토가 작성한 피드백이 없습니다.
                      </div>
                    `}
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>
      `;

      // Render Common Week Selector
      const weekSelectorContainer = this.renderWeekSelector(this.selectedWeek, (w) => {
        this.selectedWeek = w;
        this.render();
      });
      document.getElementById('admin-fb-week-selector-placeholder').replaceWith(weekSelectorContainer);

      // Dropdown & Search Handlers
      const dropdown = document.getElementById('admin-fb-junior-select');
      if (dropdown) {
        dropdown.onchange = (e) => {
          this.selectedJuniorId = e.target.value;
          this.render();
        };
      }

      const searchInput = document.getElementById('admin-fb-search-input');
      if (searchInput) {
        searchInput.oninput = (e) => {
          this.adminFbSearchTerm = e.target.value;
          const filtered = allJuniors.filter(j => 
            j.displayName.toLowerCase().includes(e.target.value.trim().toLowerCase()) ||
            j.username.toLowerCase().includes(e.target.value.trim().toLowerCase())
          );
          if (filtered.length > 0 && !filtered.some(j => j.id === this.selectedJuniorId)) {
            this.selectedJuniorId = filtered[0].id;
          }
          this.render();
        };
      }
    }

    // §4-1 & §4-2. ADMIN USER MANAGEMENT & RECORD-LEVEL UPDATE FIX
    renderUserManagement(container, adminUser) {
      const users = window.gqStore.getUsers();

      container.innerHTML = `
        <div class="card">
          <div class="card-header">
            <div class="card-title">👥 계정 및 권한 관리</div>
            <button class="btn btn-primary" id="btn-create-user-modal">+ 신규 계정 생성</button>
          </div>

          <div class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>아이디</th>
                  <th>표시 이름</th>
                  <th>역할</th>
                  <th>상태</th>
                  <th>비밀번호 초기화</th>
                  <th>계정 정보 수정</th>
                </tr>
              </thead>
              <tbody>
                ${users.map(u => `
                  <tr>
                    <td><strong>${u.username}</strong></td>
                    <td>${u.displayName}</td>
                    <td><span class="badge badge-info">${u.role}</span></td>
                    <td>
                      <span class="badge ${u.isActive ? 'badge-success' : 'badge-danger'}">
                        ${u.isActive ? '활성' : '비활성'}
                      </span>
                    </td>
                    <td>
                      <button class="btn btn-outline btn-reset-pw" data-id="${u.id}" style="padding: 0.2rem 0.5rem; font-size: 0.8rem;">초기화</button>
                    </td>
                    <td>
                      <button class="btn btn-secondary btn-edit-user" data-id="${u.id}" style="padding: 0.2rem 0.5rem; font-size: 0.8rem;">수정</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div id="user-edit-modal-container"></div>
      `;

      document.querySelectorAll('.btn-reset-pw').forEach(b => {
        b.onclick = () => {
          const uid = b.getAttribute('data-id');
          const target = window.gqStore.getUserById(uid);
          if (target) {
            target.passwordHash = hashPassword("initpw1!");
            target.mustChangePassword = true;
            window.gqStore.saveUser(target);
            alert(`${target.displayName} 계정의 비밀번호가 'initpw1!'로 초기화되었습니다.`);
          }
        };
      });

      // §4-1 Record-level Update Modal Implementation
      document.querySelectorAll('.btn-edit-user').forEach(b => {
        b.onclick = () => {
          const uid = b.getAttribute('data-id');
          const targetUser = window.gqStore.getUserById(uid);
          if (!targetUser) return;

          const modalContainer = document.getElementById('user-edit-modal-container');
          modalContainer.innerHTML = `
            <div class="modal-backdrop">
              <div class="modal-content">
                <div class="modal-header">
                  <div class="modal-title">✏️ 계정정보 수정 (${targetUser.username})</div>
                  <button class="modal-close" id="btn-close-edit-modal">&times;</button>
                </div>

                <form id="edit-user-form">
                  <div class="form-group">
                    <label class="form-label">표시 이름</label>
                    <input type="text" id="edit-displayName" class="form-input" value="${targetUser.displayName}" required>
                  </div>

                  <div class="form-group">
                    <label class="form-label">사용자 역할</label>
                    <select id="edit-role" class="form-select">
                      <option value="JUNIOR" ${targetUser.role === 'JUNIOR' ? 'selected' : ''}>주니어사원 (JUNIOR)</option>
                      <option value="MENTOR" ${targetUser.role === 'MENTOR' ? 'selected' : ''}>멘토 (MENTOR)</option>
                      <option value="ADMIN" ${targetUser.role === 'ADMIN' ? 'selected' : ''}>인사팀 총괄운영자 (ADMIN)</option>
                    </select>
                  </div>

                  <div class="form-group">
                    <label class="form-label">계정 활성화 상태</label>
                    <select id="edit-isActive" class="form-select">
                      <option value="true" ${targetUser.isActive ? 'selected' : ''}>활성화 (Active)</option>
                      <option value="false" ${!targetUser.isActive ? 'selected' : ''}>비활성화 (Inactive)</option>
                    </select>
                  </div>

                  <div class="form-group">
                    <label class="form-label">최초 비밀번호 변경 필요 여부</label>
                    <select id="edit-mustChangePassword" class="form-select">
                      <option value="true" ${targetUser.mustChangePassword ? 'selected' : ''}>필요함 (True)</option>
                      <option value="false" ${!targetUser.mustChangePassword ? 'selected' : ''}>필요없음 (False)</option>
                    </select>
                  </div>

                  <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1.5rem;">
                    <button type="button" class="btn btn-outline" id="btn-cancel-edit">취소</button>
                    <button type="submit" class="btn btn-primary">저장하기</button>
                  </div>
                </form>
              </div>
            </div>
          `;

          document.getElementById('btn-close-edit-modal').onclick = () => modalContainer.innerHTML = '';
          document.getElementById('btn-cancel-edit').onclick = () => modalContainer.innerHTML = '';

          document.getElementById('edit-user-form').onsubmit = (e) => {
            e.preventDefault();
            try {
              window.gqStore.updateUserAccount(targetUser.id, {
                displayName: document.getElementById('edit-displayName').value.trim(),
                role: document.getElementById('edit-role').value,
                isActive: document.getElementById('edit-isActive').value === 'true',
                mustChangePassword: document.getElementById('edit-mustChangePassword').value === 'true'
              });
              alert("계정정보가 저장되었습니다.");
              modalContainer.innerHTML = '';
              this.render();
            } catch (err) {
              console.error(err);
              alert("계정정보를 저장하지 못했습니다. 다시 시도해주세요.");
            }
          };
        };
      });

      document.getElementById('btn-create-user-modal').onclick = () => {
        const username = prompt("신규 아이디 입력:");
        if (!username) return;
        const displayName = prompt("표시 이름 입력:");
        if (!displayName) return;
        const role = prompt("역할 (JUNIOR / MENTOR / ADMIN):", "JUNIOR");

        const newUser = {
          id: "u_" + Date.now(),
          username,
          displayName,
          role: role.toUpperCase(),
          isActive: true,
          mustChangePassword: true,
          passwordHash: hashPassword("initpw1!"),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: 1
        };
        window.gqStore.saveUser(newUser);
        alert('신규 계정이 생성되었습니다. (초기 비밀번호: initpw1!)');
      };
    }

    // §5. ADMIN MENTOR ASSIGNMENT SCREEN IMPROVEMENT (CHECKBOX SELECTION PER MENTOR)
    renderAssignmentManagement(container, adminUser) {
      const mentors = window.gqStore.getUsers().filter(u => u.role === "MENTOR" && u.isActive);
      const juniors = window.gqStore.getUsers().filter(u => u.role === "JUNIOR" && u.isActive);

      if (mentors.length > 0 && !this.selectedMentorForAssign) {
        this.selectedMentorForAssign = mentors[0].id;
      }

      const selectedMentor = mentors.find(m => m.id === this.selectedMentorForAssign);
      const currentActiveAsgs = selectedMentor ? window.gqStore.getActiveAssignmentsForMentor(selectedMentor.id) : [];
      const assignedJuniorIds = currentActiveAsgs.map(a => a.juniorUserId);

      container.innerHTML = `
        <div class="card">
          <div class="card-header">
            <div class="card-title">🔗 멘토 다중 배정 (N:M 관계) 관리</div>
          </div>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1.5rem;">
            멘토를 선택한 후 해당 멘토가 담당할 주니어사원을 체크박스로 지정합니다.
          </p>

          <!-- 1단계: 멘토 선택 드롭다운 -->
          <div style="background: #f8fafc; padding: 1.25rem; border-radius: var(--radius-md); margin-bottom: 1.5rem; border: 1px solid var(--border);">
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label">멘토 선택</label>
              <select id="asg-mentor-dropdown" class="form-select" style="max-width: 400px;">
                ${mentors.map(m => `
                  <option value="${m.id}" ${this.selectedMentorForAssign === m.id ? 'selected' : ''}>
                    ${m.displayName || m.username}
                  </option>
                `).join('')}
              </select>
            </div>
          </div>

          <!-- 2단계: 담당 주니어사원 선택 체크박스 목록 -->
          ${selectedMentor ? `
            <div class="card" style="box-shadow: none; border-color: var(--border);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                <h4 style="font-size: 1rem; font-weight: 700; color: var(--text-main);">
                  담당 주니어사원 선택 (멘토: ${selectedMentor.displayName})
                </h4>
                <div style="display: flex; gap: 0.5rem;">
                  <button type="button" class="btn btn-outline" id="btn-select-all-juniors" style="padding: 0.3rem 0.6rem; font-size: 0.8rem;">전체 선택</button>
                  <button type="button" class="btn btn-outline" id="btn-deselect-all-juniors" style="padding: 0.3rem 0.6rem; font-size: 0.8rem;">전체 해제</button>
                </div>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                <input type="text" id="asg-junior-search" class="form-input" placeholder="이름 검색" style="max-width: 250px; padding: 0.4rem 0.8rem; font-size: 0.85rem;">
                <span style="font-size: 0.85rem; font-weight: 600; color: var(--primary);" id="asg-selected-count-label">
                  선택 인원: ${assignedJuniorIds.length} / ${juniors.length} 명
                </span>
              </div>

              <form id="mentor-asg-checkbox-form">
                <div class="grid grid-cols-3" id="junior-checkbox-grid" style="margin-bottom: 1.5rem;">
                  ${juniors.map(j => {
                    const isChecked = assignedJuniorIds.includes(j.id);
                    return `
                      <label class="junior-checkbox-label" data-name="${j.displayName}" style="display: flex; align-items: center; gap: 0.5rem; padding: 0.6rem; background: #f8fafc; border-radius: var(--radius-sm); border: 1px solid var(--border); cursor: pointer;">
                        <input type="checkbox" class="junior-asg-cb" value="${j.id}" ${isChecked ? 'checked' : ''}>
                        <span style="font-weight: 600; font-size: 0.9rem;">${j.displayName}</span>
                        <span style="font-size: 0.75rem; color: var(--text-muted);">(${j.username})</span>
                      </label>
                    `;
                  }).join('')}
                </div>

                <div style="display: flex; justify-content: flex-end;">
                  <button type="submit" class="btn btn-primary" id="btn-save-asg-checkboxes">변경사항 저장</button>
                </div>
              </form>
            </div>
          ` : ''}
        </div>
      `;

      const mentorDropdown = document.getElementById('asg-mentor-dropdown');
      if (mentorDropdown) {
        mentorDropdown.onchange = (e) => {
          this.selectedMentorForAssign = e.target.value;
          this.render();
        };
      }

      const searchInput = document.getElementById('asg-junior-search');
      if (searchInput) {
        searchInput.oninput = (e) => {
          const q = e.target.value.trim().toLowerCase();
          document.querySelectorAll('.junior-checkbox-label').forEach(lbl => {
            const name = lbl.getAttribute('data-name').toLowerCase();
            lbl.style.display = name.includes(q) ? 'flex' : 'none';
          });
        };
      }

      const updateCountLabel = () => {
        const checkedCount = document.querySelectorAll('.junior-asg-cb:checked').length;
        const countLabel = document.getElementById('asg-selected-count-label');
        if (countLabel) countLabel.innerText = `선택 인원: ${checkedCount} / ${juniors.length} 명`;
      };

      document.querySelectorAll('.junior-asg-cb').forEach(cb => {
        cb.onchange = updateCountLabel;
      });

      const btnSelectAll = document.getElementById('btn-select-all-juniors');
      if (btnSelectAll) {
        btnSelectAll.onclick = () => {
          document.querySelectorAll('.junior-asg-cb').forEach(cb => cb.checked = true);
          updateCountLabel();
        };
      }

      const btnDeselectAll = document.getElementById('btn-deselect-all-juniors');
      if (btnDeselectAll) {
        btnDeselectAll.onclick = () => {
          document.querySelectorAll('.junior-asg-cb').forEach(cb => cb.checked = false);
          updateCountLabel();
        };
      }

      const asgForm = document.getElementById('mentor-asg-checkbox-form');
      if (asgForm) {
        asgForm.onsubmit = (e) => {
          e.preventDefault();
          const checkedIds = Array.from(document.querySelectorAll('.junior-asg-cb:checked')).map(cb => cb.value);
          window.gqStore.syncMentorAssignments(selectedMentor.id, checkedIds, adminUser.id);
          alert("멘토 배정정보가 저장되었습니다.");
          this.render();
        };
      }
    }

    // GROWTH DATA MANAGEMENT & PURGE / BACKUP / RESTORE
    renderGrowthDataMgmt(container, adminUser) {
      const assessments = window.gqStore.getAssessments();
      const overrides = window.gqStore.getOverrides();
      const feedbacks = window.gqStore.getFeedbacks();

      container.innerHTML = `
        <div class="card">
          <div class="card-header"><div class="card-title">⚙️ 성장 데이터 관리 및 초기화</div></div>

          <div class="alert alert-info" style="margin-bottom: 1.5rem;">
            🔍 <strong>데이터 상태 점검 (Repository와 조회 화면 건수 100% 일치):</strong><br>
            - 자가진단 원본: ${assessments.length}건<br>
            - 성장지도 파생 캐시 / 보정값: ${overrides.length}건<br>
            - 멘토 피드백: ${feedbacks.length}건 (제출: ${feedbacks.filter(f=>f.status==='SUBMITTED').length}건)<br>
            - Mock Fallback 여부: False (단일 저장소 연동 중)
          </div>

          <div class="grid grid-cols-2">
            <div class="card">
              <h4 style="color: var(--primary); margin-bottom: 0.5rem;">📈 성장지도 관리자 보정값 초기화</h4>
              <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1rem;">
                자가진단 원본과 성장일지는 절대 삭제하지 않고, 오직 성장지도 파생 캐시와 보정값만 초기화합니다.
              </p>
              <button class="btn btn-outline btn-danger" id="btn-purge-map">성장지도 보정값 초기화</button>
            </div>

            <div class="card">
              <h4 style="color: var(--secondary); margin-bottom: 0.5rem;">💬 멘토 피드백 선택 초기화</h4>
              <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1rem;">
                선택한 멘토 피드백 데이터만을 안전하게 백업 후 초기화합니다.
              </p>
              <button class="btn btn-outline btn-danger" id="btn-purge-fb">멘토 피드백 초기화</button>
            </div>
          </div>

          <div class="card" style="border: 2px solid var(--danger); background: #fff5f5; margin-top: 1.5rem;">
            <h4 style="color: var(--danger); margin-bottom: 0.5rem;">⚠️ 성장 데이터 전체 초기화 (안전장치 적용)</h4>
            <p style="font-size: 0.85rem; color: var(--text-main); margin-bottom: 1rem;">
              전체 초기화 실행 전 대상 데이터는 자동으로 백업되며, 정확히 <strong>"전체 초기화"</strong>를 입력해야만 진행됩니다.
            </p>
            <div style="display: flex; gap: 0.5rem;">
              <input type="text" id="purge-confirm-text" class="form-input" placeholder="'전체 초기화' 입력" style="max-width: 200px;">
              <button class="btn btn-danger" id="btn-full-purge">전체 데이터 안전 초기화 실행</button>
            </div>
          </div>
        </div>
      `;

      document.getElementById('btn-purge-map').onclick = () => {
        const jIds = window.gqStore.getUsers().filter(u=>u.role==='JUNIOR').map(u=>u.id);
        const wks = Array.from({length:16}, (_,i)=>i+1);
        window.gqStore.createBackup(adminUser.id, 'GROWTH_MAP', jIds, wks, '성장지도 초기화 전 자동 백업');
        const count = window.gqStore.clearOverrides(jIds, wks, adminUser.id);
        alert(`선택한 성장지도 보정값 ${count}건이 초기화되었습니다.`);
      };

      document.getElementById('btn-purge-fb').onclick = () => {
        const jIds = window.gqStore.getUsers().filter(u=>u.role==='JUNIOR').map(u=>u.id);
        const wks = Array.from({length:16}, (_,i)=>i+1);
        window.gqStore.createBackup(adminUser.id, 'MENTOR_FEEDBACK', jIds, wks, '피드백 초기화 전 자동 백업');
        const count = window.gqStore.clearFeedbacks(jIds, [], wks, adminUser.id);
        alert(`선택한 멘토 피드백 ${count}건이 초기화되었습니다.`);
      };

      document.getElementById('btn-full-purge').onclick = () => {
        const txt = document.getElementById('purge-confirm-text').value.trim();
        if (txt !== "전체 초기화") {
          alert('확인 문구 "전체 초기화"를 정확히 입력해 주세요.');
          return;
        }
        const jIds = window.gqStore.getUsers().filter(u=>u.role==='JUNIOR').map(u=>u.id);
        const wks = Array.from({length:16}, (_,i)=>i+1);
        window.gqStore.createBackup(adminUser.id, 'BOTH', jIds, wks, '전체 데이터 초기화 전 백업');
        window.gqStore.clearOverrides(jIds, wks, adminUser.id);
        window.gqStore.clearFeedbacks(jIds, [], wks, adminUser.id);
        alert('선택한 데이터가 성공적으로 초기화 및 백업되었습니다.');
      };
    }

    // AUDIT LOGS VIEW
    renderAuditLogs(container, user) {
      const logs = window.gqStore.getAuditLogs();
      const backups = window.gqStore.getBackups();

      container.innerHTML = `
        <div class="card">
          <div class="card-header"><div class="card-title">📜 시스템 감사 로그</div></div>
          <div class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>일시</th>
                  <th>작업자</th>
                  <th>작업 유형</th>
                  <th>대상 사용자</th>
                </tr>
              </thead>
              <tbody>
                ${logs.map(l => {
                  const actor = window.gqStore.getUserById(l.actorUserId);
                  return `
                    <tr>
                      <td>${new Date(l.createdAt).toLocaleString()}</td>
                      <td>${actor ? actor.displayName : l.actorUserId}</td>
                      <td><span class="badge badge-info">${l.actionType}</span></td>
                      <td>${l.targetUserIds.join(', ')}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><div class="card-title">📦 백업 및 복구 이력</div></div>
          <div class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>백업 일시</th>
                  <th>백업 사유</th>
                  <th>복구 상태</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                ${backups.map(b => `
                  <tr>
                    <td>${new Date(b.createdAt).toLocaleString()}</td>
                    <td>${b.reason}</td>
                    <td>${b.restoredAt ? `<span class="badge badge-success">복구 완료 (${new Date(b.restoredAt).toLocaleTimeString()})</span>` : '<span class="badge badge-warning">보관 중</span>'}</td>
                    <td>
                      <button class="btn btn-secondary btn-restore" data-id="${b.id}" style="padding: 0.2rem 0.5rem; font-size: 0.8rem;">데이터 복구</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;

      document.querySelectorAll('.btn-restore').forEach(b => {
        b.onclick = () => {
          const bid = b.getAttribute('data-id');
          if (confirm('해당 백업 데이터로 복구를 진행하시겠습니까?')) {
            window.gqStore.restoreBackup(bid, user.id);
            alert('데이터 복구가 완료되었습니다.');
          }
        };
      });
    }


    showExportModal() {
      let modal = document.getElementById('export-modal');
      if (modal) modal.remove();

      const allJuniors = window.gqStore.getUsers().filter(u => u.role === "JUNIOR" && u.isActive);
      const pWeeks = window.gqStore.getProgramWeeks().filter(w => !w.isExcluded);

      modal = document.createElement('div');
      modal.id = 'export-modal';
      modal.style.position = 'fixed';
      modal.style.top = '0';
      modal.style.left = '0';
      modal.style.width = '100vw';
      modal.style.height = '100vh';
      modal.style.backgroundColor = 'rgba(0,0,0,0.5)';
      modal.style.display = 'flex';
      modal.style.justifyContent = 'center';
      modal.style.alignItems = 'center';
      modal.style.zIndex = '9999';

      modal.innerHTML = `
        <div class="card" style="width: 500px; max-height: 80vh; overflow-y: auto; background: white; color: var(--text-main);">
          <div class="card-header">
            <div class="card-title">리포트 PDF 내보내기</div>
          </div>
          <div style="margin-bottom: 1rem;">
            <p style="font-size: 0.9rem; margin-bottom: 0.5rem; font-weight: bold;">1. 대상자 선택</p>
            <div style="max-height: 150px; overflow-y: auto; border: 1px solid var(--border-color); padding: 0.5rem; border-radius: var(--radius-sm);">
              ${allJuniors.map(j => `<label style="display:block; margin-bottom:0.3rem;"><input type="checkbox" class="export-user-cb" value="${j.id}" checked> ${j.displayName}</label>`).join('')}
            </div>
          </div>
          <div style="margin-bottom: 1.5rem;">
            <p style="font-size: 0.9rem; margin-bottom: 0.5rem; font-weight: bold;">2. 주차 선택</p>
            <div style="max-height: 150px; overflow-y: auto; border: 1px solid var(--border-color); padding: 0.5rem; border-radius: var(--radius-sm);">
              ${pWeeks.map(w => `<label style="display:block; margin-bottom:0.3rem;"><input type="checkbox" class="export-week-cb" value="${w.weekNumber}" checked> ${w.label}</label>`).join('')}
            </div>
          </div>
          <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
            <button class="btn btn-outline" id="btn-cancel-export">취소</button>
            <button class="btn btn-primary" id="btn-run-export">PDF 생성 시작</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      document.getElementById('btn-cancel-export').onclick = () => modal.remove();
      document.getElementById('btn-run-export').onclick = () => {
        const selectedUsers = Array.from(document.querySelectorAll('.export-user-cb:checked')).map(cb => cb.value);
        const selectedWeeks = Array.from(document.querySelectorAll('.export-week-cb:checked')).map(cb => parseInt(cb.value, 10));
        
        if (selectedUsers.length === 0 || selectedWeeks.length === 0) {
          alert('대상자와 주차를 최소 하나 이상 선택해주세요.');
          return;
        }

        modal.remove();
        this.generatePDFReport(selectedUsers, selectedWeeks);
      };
    }

    async generatePDFReport(userIds, weeks) {
      if (typeof html2pdf === 'undefined') {
        alert('html2pdf 라이브러리를 불러오지 못했습니다. 페이지를 새로고침 해주세요.');
        return;
      }
      
      const container = document.createElement('div');
      container.style.padding = '2rem';
      container.style.backgroundColor = 'white';
      container.style.color = 'black';
      container.style.width = '800px';
      
      let html = `<h1 style="text-align:center; font-size: 24px; margin-bottom: 30px;">GROWTH QUEST 주니어사원 성장일지 및 피드백 종합 리포트</h1>`;
      
      for (let uid of userIds) {
        const u = window.gqStore.getUserById(uid);
        html += `<h2 style="font-size: 20px; border-bottom: 2px solid #ccc; padding-bottom: 5px; margin-top: 40px; margin-bottom: 20px;">[ ${u.displayName} ] 성장일지 리포트</h2>`;
        
        for (let w of weeks) {
          const j = window.gqStore.getJournal(uid, w);
          if (j && j.status === 'SUBMITTED') {
            html += `<div style="margin-bottom: 20px; page-break-inside: avoid; border: 1px solid #ddd; padding: 15px; border-radius: 8px;">`;
            html += `<h3 style="font-size: 16px; margin-top: 0; color: #4f46e5;">[ ${w}주차 ] 제출일: ${new Date(j.updatedAt).toLocaleDateString()}</h3>`;
            html += `<p><strong>Q1. 업무 수행:</strong> ${j.step1_workDone}</p>`;
            html += `<p><strong>Q2. 도움 요청 여부:</strong> ${j.step2_helpRequested === 'NO_SOLVED_ALONE' ? '혼자 해결' : (j.step2_helpRequested === 'YES_MENTOR' ? '멘토에게 도움 받음' : (j.step2_helpRequested === 'YES_TEAM' ? '팀원에게 도움 받음' : '도움 안받음'))}</p>`;
            html += `<p><strong>Q3. 학습 및 성장:</strong> ${j.step3_learned}</p>`;
            html += `<p><strong>Q4. 다음 주 목표:</strong> ${j.step4_nextGoal}</p>`;
            
            // Append Mentor Feedback if exists
            const assignments = window.gqStore.getAssignments().filter(a => a.juniorUserId === uid);
            if (assignments.length > 0) {
              const fb = window.gqStore.getFeedback(uid, assignments[0].mentorUserId, w);
              if (fb && fb.status === 'SUBMITTED') {
                html += `<div style="background: #f1f5f9; padding: 10px; margin-top: 15px; border-radius: 5px;">`;
                html += `<h4 style="margin-top: 0; color: #0f172a;">멘토 피드백</h4>`;
                html += `<p style="margin-bottom: 0;">${fb.juniorVisibleFeedback?.overallEncouragement || fb.overallComment || '작성된 피드백이 없습니다.'}</p>`;
                html += `</div>`;
              }
            }
            html += `</div>`;
          }
        }
      }

      container.innerHTML = html;
      document.body.appendChild(container);

      const opt = {
        margin:       10,
        filename:     'growth_quest_report.pdf',
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2 },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };

      try {
        await html2pdf().from(container).set(opt).save();
      } catch (e) {
        console.error('PDF 생성 중 오류:', e);
        alert('PDF 생성 중 오류가 발생했습니다.');
      } finally {
        document.body.removeChild(container);
      }
    }

    renderAdminDashboard(container, user) {
      const allJuniors = window.gqStore.getUsers().filter(u => u.role === "JUNIOR" && u.isActive);
      
      container.innerHTML = `
        <div class="card" style="background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%); color: white;">
          <div style="display:flex; justify-content: space-between; align-items:center;">
            <div>
              <h2 style="font-size: 1.4rem; font-weight: 800; margin-bottom: 0.4rem;">신입사원 총괄운영자 대시보드</h2>
              <p style="font-size: 0.9rem; opacity: 0.9;">GROWTH QUEST 전체 주니어사원 및 멘토 현황 종합 관리</p>
            </div>
            <div>
              <button class="btn" id="btn-export-pdf" style="background: white; color: #0f172a; font-weight: 700;">전체 리포트 PDF 다운로드</button>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-4" style="margin-bottom: 1.5rem;">
          <div class="card" style="text-align: center;">
            <div style="font-size: 0.85rem; color: var(--text-muted);">전체 계정 수</div>
            <div style="font-size: 1.8rem; font-weight: 800; color: var(--primary); margin-top: 0.3rem;">${window.gqStore.getUsers().length} 명</div>
          </div>
          <div class="card" style="text-align: center;">
            <div style="font-size: 0.85rem; color: var(--text-muted);">주니어사원 수</div>
            <div style="font-size: 1.8rem; font-weight: 800; color: var(--secondary); margin-top: 0.3rem;">${window.gqStore.getUsers().filter(u=>u.role==='JUNIOR').length} 명</div>
          </div>
          <div class="card" style="text-align: center;">
            <div style="font-size: 0.85rem; color: var(--text-muted);">멘토 계정 수</div>
            <div style="font-size: 1.8rem; font-weight: 800; color: var(--success); margin-top: 0.3rem;">${window.gqStore.getUsers().filter(u=>u.role==='MENTOR').length} 명</div>
          </div>
          <div class="card" style="text-align: center;">
            <div style="font-size: 0.85rem; color: var(--text-muted);">제출된 성장일지 수</div>
            <div style="font-size: 1.8rem; font-weight: 800; color: var(--warning); margin-top: 0.3rem;">${window.gqStore.getJournals().filter(j=>j.status==='SUBMITTED').length} 건</div>
          </div>
        </div>

        <h3 style="margin-bottom: 1rem;">전체 주니어사원 현황</h3>
        <div class="grid grid-cols-2">
          ${allJuniors.map(j => {
            const journals = window.gqStore.getJournals().filter(jl => jl.juniorUserId === j.id && jl.status === 'SUBMITTED');
            const validWeeksCount = window.gqStore.getProgramWeeks().filter(pw => !pw.isExcluded).length;
            const submitRate = validWeeksCount > 0 ? Math.round((journals.length / validWeeksCount) * 100) : 0;
            const latestJournal = journals.sort((a,b) => b.week - a.week)[0];
            return `
              <div class="card">
                <div style="display:flex; justify-content:space-between; margin-bottom: 1rem;">
                  <div>
                    <div style="font-size: 1.2rem; font-weight: bold;">${j.displayName}</div>
                    <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.2rem;">제출률: ${submitRate}% (${journals.length}/${validWeeksCount})</div>
                    <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.2rem;">최근 제출: ${latestJournal ? latestJournal.week + '주차' : '없음'}</div>
                  </div>
                  <div style="text-align: right;">
                    <button class="btn btn-secondary btn-sm nav-to-journal" data-junior="${j.id}">성장일지 보기 ➡️</button>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;

      document.querySelectorAll('.nav-to-journal').forEach(btn => {
        btn.onclick = (e) => {
          this.selectedJuniorId = e.currentTarget.getAttribute('data-junior');
          this.currentRoute = 'JOURNAL';
          this.render();
        };
      });

      document.getElementById('btn-export-pdf').onclick = () => {
        this.showExportModal(); 
      };
    }

    renderMyInfo(container, user) {
      container.innerHTML = `
        <div class="card" style="max-width: 600px; margin: 0 auto;">
          <div class="card-header"><div class="card-title">👤 내 계정 정보</div></div>
          <div style="font-size: 0.95rem; line-height: 2;">
            <div><strong>아이디:</strong> ${user.username}</div>
            <div><strong>표시 이름:</strong> ${user.displayName}</div>
            <div><strong>사용자 역할:</strong> ${user.role}</div>
            <div><strong>계정 상태:</strong> ${user.isActive ? '활성' : '비활성'}</div>
            <div><strong>최근 로그인:</strong> ${user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '-'}</div>
          </div>
        </div>
      `;
    }
    renderAdminWeeksSettings(container, user) {
      const pWeeks = window.gqStore.getProgramWeeks();
      
      let tableRows = pWeeks.map(pw => `
        <tr>
          <td>${pw.label}</td>
          <td>${pw.isExcluded ? '<span class="badge badge-warning">제외기간</span>' : `<span class="badge badge-primary">${pw.weekNumber}주차</span>`}</td>
          <td><input type="date" class="form-input pw-start" data-id="${pw.id}" value="${pw.startDate}"></td>
          <td><input type="date" class="form-input pw-end" data-id="${pw.id}" value="${pw.endDate}"></td>
          <td>
            <label style="display:flex; align-items:center; gap:0.5rem; justify-content:center;">
              <input type="checkbox" class="pw-active" data-id="${pw.id}" ${pw.isActive ? 'checked' : ''}>
              활성
            </label>
          </td>
        </tr>
      `).join('');

      container.innerHTML = `
        <div class="card">
          <div class="card-header">
            <div class="card-title">📅 운영주차 관리 (현재 KST: ${this.getCurrentKoreanDate().toLocaleString()})</div>
          </div>
          <div style="margin-bottom: 1rem;">
            <p style="color: var(--text-muted); font-size: 0.9rem;">
              각 주차의 시작일과 종료일을 설정합니다. 제출 대상에서 제외할 기간은 '제외기간'으로 등록되며, 제외기간은 작성률 분모에서 빠집니다.
            </p>
          </div>
          <div class="table-responsive">
            <table class="table" style="text-align: center;">
              <thead>
                <tr>
                  <th>구분</th>
                  <th>유형</th>
                  <th>시작일</th>
                  <th>종료일</th>
                  <th>활성 상태</th>
                </tr>
              </thead>
              <tbody>
                ${tableRows}
              </tbody>
            </table>
          </div>
          <div style="margin-top: 1.5rem; text-align: right;">
            <button class="btn btn-primary" id="btn-save-pweeks">변경사항 저장</button>
          </div>
        </div>
      `;

      document.getElementById('btn-save-pweeks').onclick = async () => {
        const pStart = document.querySelectorAll('.pw-start');
        const pEnd = document.querySelectorAll('.pw-end');
        const pActive = document.querySelectorAll('.pw-active');
        
        for (let i = 0; i < pStart.length; i++) {
          const id = pStart[i].getAttribute('data-id');
          const pw = pWeeks.find(p => p.id === id);
          if (pw) {
            pw.startDate = pStart[i].value;
            pw.endDate = pEnd[i].value;
            pw.isActive = pActive[i].checked;
            pw.updatedAt = new Date().toISOString();
            await db.collection('programWeeks').doc(pw.id).set(pw);
          }
        }
        alert('운영주차 설정이 저장되었습니다.');
      };
    }
  }

  // --- 7. APPLICATION INITIALIZATION ---
  document.addEventListener('DOMContentLoaded', () => {
    window.gqUI = new GrowthQuestUI();
  });
})();
