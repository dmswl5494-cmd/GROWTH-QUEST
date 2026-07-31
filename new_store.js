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
