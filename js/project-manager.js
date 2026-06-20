// ════════════════════════════════════════
// Shared API retry utility
// Used by: proposal.html, upload.html, thesis.html
// ════════════════════════════════════════

var NiraAPI = (function() {

  var RETRY_DELAYS = [5000, 10000, 20000, 40000, 80000];

  function showRateLimitBanner(seconds) {
    var banner = document.getElementById('nira-rate-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'nira-rate-banner';
      banner.style.cssText = 'position:fixed;top:64px;left:50%;transform:translateX(-50%);' +
        'background:#d97706;color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;' +
        'font-weight:500;font-family:Inter,sans-serif;z-index:9999;display:flex;align-items:center;' +
        'gap:10px;box-shadow:0 4px 16px rgba(0,0,0,0.2);white-space:nowrap;';
      document.body.appendChild(banner);
    }
    banner.innerHTML = '⏳ Rate limit — retrying in <strong style="font-size:15px;margin:0 4px">' + seconds + '</strong>s...';
    return banner;
  }

  function hideRateLimitBanner() {
    var banner = document.getElementById('nira-rate-banner');
    if (banner) banner.remove();
  }

  async function countdown(ms) {
    var remaining = Math.round(ms / 1000);
    showRateLimitBanner(remaining);
    return new Promise(function(resolve) {
      var iv = setInterval(function() {
        remaining--;
        if (remaining > 0) {
          showRateLimitBanner(remaining);
        } else {
          clearInterval(iv);
          hideRateLimitBanner();
          resolve();
        }
      }, 1000);
    });
  }

  async function callWithRetry(fn, maxRetries) {
    maxRetries = maxRetries || 5;
    for (var attempt = 0; attempt < maxRetries; attempt++) {
      try {
        var result = await fn();
        return result;
      } catch(err) {
        var is429 = err.message && (
          err.message.includes('429') ||
          err.message.toLowerCase().includes('rate limit') ||
          err.message.toLowerCase().includes('tpm')
        );
        if (!is429) throw err; // non-rate-limit → don't retry
        if (attempt === maxRetries - 1) throw new Error('Rate limit: max retries reached. Please wait a minute and try again.');
        await countdown(RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]);
      }
    }
  }

  return {
    callWithRetry:      callWithRetry,
    showRateLimitBanner: showRateLimitBanner,
    hideRateLimitBanner: hideRateLimitBanner,
    countdown:          countdown
  };

})();

window.NiraAPI = NiraAPI;
// Centralized project-based state management
// Replaces module-based localStorage keys
// ════════════════════════════════════════

var NiraProject = (function() {

  var PROJECTS_KEY    = 'nira_projects';
  var ACTIVE_KEY      = 'nira_active_project';
  var MODULES         = ['proposal', 'thesis', 'questionnaire', 'topic', 'citations'];

  // ── INTERNAL HELPERS ──

  function getAllProjects() {
    try { return JSON.parse(localStorage.getItem(PROJECTS_KEY) || '[]'); }
    catch(e) { return []; }
  }

  function saveAllProjects(projects) {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  }

  function getActiveId() {
    return localStorage.getItem(ACTIVE_KEY) || null;
  }

  function generateId() {
    return 'proj_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  }

  // ── PUBLIC API ──

  function createProject(title, topic) {
    var id = generateId();
    var project = {
      id: id,
      title: title || 'Untitled Research Project',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      topic: topic || {},
      modules: {
        proposal:      {},
        thesis:        {},
        questionnaire: {},
        citations:     [],
      }
    };
    var projects = getAllProjects();
    projects.unshift(project);
    saveAllProjects(projects);
    localStorage.setItem(ACTIVE_KEY, id);
    return project;
  }

  function getActiveProject() {
    var id = getActiveId();
    if (!id) return null;
    var projects = getAllProjects();
    return projects.find(function(p){ return p.id === id; }) || null;
  }

  function getOrCreateActive(title, topic) {
    var active = getActiveProject();
    if (active) return active;
    return createProject(title, topic);
  }

  function switchProject(id) {
    var projects = getAllProjects();
    var found = projects.find(function(p){ return p.id === id; });
    if (!found) return false;
    localStorage.setItem(ACTIVE_KEY, id);
    return true;
  }

  function saveModule(moduleName, data) {
    var projects = getAllProjects();
    var id = getActiveId();
    if (!id || !projects.find(function(p){ return p.id === id; })) {
      // Auto-create project if none exists
      var newP = createProject();
      id = newP.id;
      projects = getAllProjects();
    }
    var idx = projects.findIndex(function(p){ return p.id === id; });
    if (idx === -1) return false;
    if (!projects[idx].modules) projects[idx].modules = {};
    projects[idx].modules[moduleName] = data;
    projects[idx].updatedAt = new Date().toISOString();
    saveAllProjects(projects);
    return true;
  }

  function loadModule(moduleName) {
    var project = getActiveProject();
    if (!project) return null;
    if (!project.modules) return null;
    return project.modules[moduleName] || null;
  }

  function saveTopic(topic) {
    var projects = getAllProjects();
    var id = getActiveId();
    if (!id) return false;
    var idx = projects.findIndex(function(p){ return p.id === id; });
    if (idx === -1) return false;
    projects[idx].topic = topic;
    projects[idx].title = topic.title_en || projects[idx].title;
    projects[idx].updatedAt = new Date().toISOString();
    saveAllProjects(projects);
    return true;
  }

  function loadTopic() {
    var project = getActiveProject();
    if (!project) return null;
    return project.topic || null;
  }

  function resetCurrentProject() {
    var projects = getAllProjects();
    var id = getActiveId();
    if (!id) return false;
    var idx = projects.findIndex(function(p){ return p.id === id; });
    if (idx === -1) return false;
    projects[idx].modules = { proposal: {}, thesis: {}, questionnaire: {}, citations: [] };
    projects[idx].updatedAt = new Date().toISOString();
    saveAllProjects(projects);
    return true;
  }

  function resetModule(moduleName) {
    var defaultVal = moduleName === 'citations' ? [] : {};
    return saveModule(moduleName, defaultVal);
  }

  function deleteProject(id) {
    var projects = getAllProjects();
    var filtered = projects.filter(function(p){ return p.id !== id; });
    saveAllProjects(filtered);
    if (getActiveId() === id) {
      if (filtered.length > 0) {
        localStorage.setItem(ACTIVE_KEY, filtered[0].id);
      } else {
        localStorage.removeItem(ACTIVE_KEY);
      }
    }
    return true;
  }

  function listProjects() {
    return getAllProjects().map(function(p) {
      return {
        id: p.id,
        title: p.title,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        topic: p.topic,
        isActive: p.id === getActiveId(),
        completedModules: p.modules ? Object.keys(p.modules).filter(function(m){
          var mod = p.modules[m];
          if (Array.isArray(mod)) return mod.length > 0;
          return mod && Object.keys(mod).length > 0;
        }) : []
      };
    });
  }

  // ── MIGRATION: import old module-based keys ──
  function migrateFromLegacy() {
    var legacyKeys = {
      proposal:      'nira_proposal',
      thesis:        'nira_thesis_v2',
      questionnaire: 'nira_questionnaire',
      citations:     'nira_citations'
    };
    var legacyTopic = localStorage.getItem('nira_selected_topic');
    var hasLegacy = Object.values(legacyKeys).some(function(k){ return localStorage.getItem(k); });
    if (!hasLegacy && !legacyTopic) return false;

    // Already migrated?
    if (getAllProjects().length > 0) return false;

    var topic = {};
    try { topic = JSON.parse(legacyTopic || '{}'); } catch(e) {}

    var project = createProject(topic.title_en || 'Imported Project', topic);

    Object.keys(legacyKeys).forEach(function(moduleName) {
      var raw = localStorage.getItem(legacyKeys[moduleName]);
      if (raw) {
        try {
          var data = JSON.parse(raw);
          saveModule(moduleName, data);
        } catch(e) {}
      }
    });

    console.log('[NiraProject] Migrated legacy data to project: ' + project.id);
    return true;
  }

  function hardReset() {
    // Clear ALL Dr. NIRA data — but preserve auth session
    var keysToRemove = [
      // Project system
      'nira_projects', 'nira_active_project',
      // Proposal & thesis
      'nira_proposal', 'nira_thesis_v2', 'nira_questionnaire',
      'nira_proposals', 'nira_authoring_mode',
      // Citations & library
      'nira_citations', 'nira_reading_list', 'nira_research_gaps',
      // Topics
      'nira_selected_topic', 'nira_topics',
      // Upload & KB
      'nira_upload_text', 'nira_upload_context', 'nira_upload_filename',
      'nira_build_from_upload', 'nira_fetch_url', 'nira_prefetch_title',
      // Flags & context
      'nira_auto_generate', 'nira_return_context',
      'nira_selected_gap', 'nira_return_to',
      // Writer
      'nira_writer_docs'
    ];
    keysToRemove.forEach(function(k){ localStorage.removeItem(k); });

    // Also clear any remaining nira_ keys dynamically
    var allKeys = Object.keys(localStorage);
    allKeys.forEach(function(k){
      if (k.startsWith('nira_')) localStorage.removeItem(k);
    });

    return true;
  }

  // ── AUTO-INIT ──
  // Do NOT auto-migrate legacy data — start fresh with project system
  // Legacy keys (nira_proposal, nira_thesis_v2 etc.) are ignored
  // Users start a new clean project on first load

  return {
    create:       createProject,
    getActive:    getActiveProject,
    getOrCreate:  getOrCreateActive,
    switch:       switchProject,
    list:         listProjects,
    delete:       deleteProject,
    reset:        resetCurrentProject,
    resetModule:  resetModule,
    save:         saveModule,
    load:         loadModule,
    saveTopic:    saveTopic,
    loadTopic:    loadTopic,
    getActiveId:  getActiveId,
    hardReset:    hardReset
  };

})();
