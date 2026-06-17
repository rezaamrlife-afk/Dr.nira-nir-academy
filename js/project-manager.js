// ════════════════════════════════════════
// Dr. NIRA — Project Manager
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
    if (!id) {
      // Auto-create project if none exists
      var p = createProject();
      id = p.id;
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
      'nira_projects', 'nira_active_project',
      'nira_proposal', 'nira_thesis_v2', 'nira_questionnaire',
      'nira_citations', 'nira_selected_topic', 'nira_topics',
      'nira_upload_text', 'nira_upload_context', 'nira_upload_filename',
      'nira_build_from_upload', 'nira_authoring_mode'
    ];
    keysToRemove.forEach(function(k){ localStorage.removeItem(k); });
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
