// ════════════════════════════════════════
// Dr. NIRA — Knowledge Base v1
// Platform-level document intelligence layer
// ════════════════════════════════════════

var NiraKB = (function() {

  var KB_KEY    = 'nira_knowledge_base';
  var QUEUE_KEY = 'nira_kb_queue';
  var MAX_KB_SIZE = 4 * 1024 * 1024; // 4MB limit

  // ── SCHEMA v1 ──
  function createEmpty(fileName, documentId) {
    return {
      version:      1,
      documentId:   documentId || ('doc_' + Date.now()),
      fileName:     fileName || '',
      processedAt:  null,
      status:       'pending',
      masterSummary: '',
      sections: {
        abstract:     '',
        introduction: '',
        literature:   '',
        methodology:  '',
        results:      '',
        discussion:   '',
        conclusion:   ''
      },
      extracted: {
        variables:         [],
        keywords:          [],
        researchQuestions: [],
        hypotheses:        [],
        methodology:       [],
        findings:          []
      },
      chunkSummaries: [],
      stats: {
        totalChunks:     0,
        completedChunks: 0,
        totalTokens:     0,
        processingMs:    0
      }
    };
  }

  // ── SAVE — localStorage first, NiraProject second ──
  function save(kb) {
    try {
      var kbToSave = Object.assign({}, kb);

      // Limit chunkSummaries
      if (kbToSave.chunkSummaries && kbToSave.chunkSummaries.length > 50) {
        kbToSave.chunkSummaries = kbToSave.chunkSummaries.slice(-50);
      }

      // Size guard
      var serialized = JSON.stringify(kbToSave);
      if (serialized.length > MAX_KB_SIZE) {
        kbToSave.chunkSummaries = kbToSave.chunkSummaries.slice(-20);
        serialized = JSON.stringify(kbToSave);
      }

      // 1. localStorage (primary)
      localStorage.setItem(KB_KEY, serialized);

      // 2. NiraProject (secondary — project-scoped)
      if (typeof NiraProject !== 'undefined') {
        NiraProject.save('knowledgeBase', kbToSave);
      }
    } catch(e) { console.warn('[NiraKB] Save failed:', e); }
  }

  var CURRENT_VERSION = 1;

  function migrateKnowledgeBase(kb) {
    // v0 → v1: add version field and missing extracted fields
    if (!kb.version) {
      kb.version = 1;
      kb.extracted = kb.extracted || {};
      kb.extracted.variables         = kb.extracted.variables         || [];
      kb.extracted.keywords          = kb.extracted.keywords          || [];
      kb.extracted.researchQuestions = kb.extracted.researchQuestions || [];
      kb.extracted.hypotheses        = kb.extracted.hypotheses        || [];
      kb.extracted.methodology       = kb.extracted.methodology       || [];
      kb.extracted.findings          = kb.extracted.findings          || [];
      kb.sections = kb.sections || {};
      kb.chunkSummaries = kb.chunkSummaries || [];
    }
    // Future versions: add migration steps here
    // if (kb.version === 1) { ... kb.version = 2; }
    return kb;
  }

  // ── LOAD — NiraProject first, localStorage fallback ──
  function load() {
    try {
      var kb = null;

      // 1. Try NiraProject first (project-scoped)
      if (typeof NiraProject !== 'undefined') {
        var fromProject = NiraProject.load('knowledgeBase');
        if (fromProject && fromProject.documentId) kb = fromProject;
      }

      // 2. Fallback to localStorage
      if (!kb) {
        var raw = localStorage.getItem(KB_KEY);
        if (raw) kb = JSON.parse(raw);
      }

      if (!kb) return null;

      // Run migration if needed
      if (!kb.version || kb.version < CURRENT_VERSION) {
        kb = migrateKnowledgeBase(kb);
        save(kb); // persist migrated version
      }

      return kb;
    } catch(e) { return null; }
  }

  function clear() {
    localStorage.removeItem(KB_KEY);
    localStorage.removeItem(QUEUE_KEY);
    if (typeof NiraProject !== 'undefined') {
      NiraProject.resetModule('knowledgeBase');
    }
  }

  // ── QUEUE PERSISTENCE ──
  function saveQueue(queue) {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify({
        version:         1,
        fileName:        queue.fileName,
        currentChunk:    queue.currentChunk || 0,
        totalChunks:     queue.chunks ? queue.chunks.length : 0,
        completedChunks: queue.chunks ? queue.chunks.filter(function(c){ return c.status === 'done'; }).length : 0,
        pendingChunks:   queue.chunks ? queue.chunks.filter(function(c){ return c.status !== 'done'; }).map(function(c){ return c.id; }) : [],
        chunks:          queue.chunks,
        kb:              queue.kb
      }));
    } catch(e) {}
  }

  function loadQueue() {
    try {
      var raw = localStorage.getItem(QUEUE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch(e) { return null; }
  }

  function clearQueue() { localStorage.removeItem(QUEUE_KEY); }

  // ── SMART EXTRACTION ──
  // Priority: abstract > intro > lit review > methodology > results > discussion > conclusion
  // Remove: references, appendices, TOC, duplicates

  var SKIP_PATTERNS = [
    /^references?\s*$/im,
    /^bibliography\s*$/im,
    /^appendix\s/im,
    /^table of contents\s*$/im,
    /^list of (figures|tables|abbreviations)\s*$/im,
    /^acknowledgements?\s*$/im,
    /^dedication\s*$/im,
  ];

  var PRIORITY_PATTERNS = [
    { pattern: /abstract/i,      section: 'abstract',      weight: 10 },
    { pattern: /introduction/i,  section: 'introduction',  weight: 9  },
    { pattern: /literature/i,    section: 'literature',    weight: 8  },
    { pattern: /method/i,        section: 'methodology',   weight: 8  },
    { pattern: /result|finding/i,section: 'results',       weight: 7  },
    { pattern: /discussion/i,    section: 'discussion',    weight: 7  },
    { pattern: /conclusion/i,    section: 'conclusion',    weight: 9  },
  ];

  function extractSmartText(rawText) {
    // Normalize whitespace
    var text = rawText
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\t/g, ' ')
      .replace(/[ ]{3,}/g, '  ')
      .replace(/\n{4,}/g, '\n\n\n');

    // Split into paragraphs
    var paragraphs = text.split(/\n\n+/).filter(function(p) {
      return p.trim().length > 50; // skip very short fragments
    });

    // Remove duplicates
    var seen = {};
    var unique = paragraphs.filter(function(p) {
      var key = p.trim().slice(0, 80).toLowerCase();
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });

    // Check if we should skip this section
    var inSkipSection = false;
    var filtered = [];
    unique.forEach(function(p) {
      var firstLine = p.trim().split('\n')[0].toLowerCase();
      // Check if entering a skip section
      var shouldSkip = SKIP_PATTERNS.some(function(pat) {
        return pat.test(firstLine);
      });
      if (shouldSkip) { inSkipSection = true; return; }
      // Check if entering a priority section (exit skip mode)
      var isPriority = PRIORITY_PATTERNS.some(function(pp) {
        return pp.pattern.test(firstLine);
      });
      if (isPriority) inSkipSection = false;
      if (!inSkipSection) filtered.push(p);
    });

    return filtered.join('\n\n');
  }

  // ── TOKEN-AWARE CHUNKING ──
  // ~4 chars per token estimate
  function estimateTokens(text) {
    return Math.ceil(text.length / 4);
  }

  function splitIntoChunks(text, maxTokens) {
    maxTokens = maxTokens || 1500; // reduced from 2200 to stay within API limits
    var maxChars = maxTokens * 4;
    var paragraphs = text.split(/\n\n+/);
    var chunks = [];
    var current = '';

    paragraphs.forEach(function(para) {
      var candidate = current ? current + '\n\n' + para : para;
      if (candidate.length > maxChars && current) {
        chunks.push(current.trim());
        current = para;
      } else {
        current = candidate;
      }
    });
    if (current.trim()) chunks.push(current.trim());

    // Detect section for each chunk
    return chunks.map(function(chunk, i) {
      var section = 'body';
      PRIORITY_PATTERNS.forEach(function(pp) {
        if (pp.pattern.test(chunk.slice(0, 200))) section = pp.section;
      });
      return {
        id: i,
        text: chunk,
        section: section,
        tokens: estimateTokens(chunk),
        status: 'pending', // pending | done | error
        summary: '',
        retries: 0
      };
    });
  }

  // ── EXPONENTIAL BACKOFF ──
  function getBackoffMs(attempt) {
    var delays = [10000, 20000, 40000, 80000, 160000];
    return delays[Math.min(attempt, delays.length - 1)];
  }

  // ── CHUNK PROMPT ──
  function buildChunkPrompt(chunk) {
    return 'You are an academic document analyzer. Summarize the following section of a research document.\n\n' +
      'Section type: ' + chunk.section + '\n\n' +
      'Extract and summarize in 80-120 words. Focus on:\n' +
      '- Key concepts and findings\n' +
      '- Research variables or constructs mentioned\n' +
      '- Methodological details\n' +
      '- Research questions or hypotheses\n\n' +
      'Text:\n' + chunk.text + '\n\n' +
      'Output: Only the summary paragraph. No labels or headings.';
  }

  function buildExtractionPrompt(allSummaries, fileName) {
    return 'You are an academic document analyzer. Based on these chunk summaries from a research document, extract structured information.\n\n' +
      'Document: ' + fileName + '\n\n' +
      'Summaries:\n' + allSummaries + '\n\n' +
      'Extract and respond in this EXACT JSON format (no markdown):\n' +
      '{\n' +
      '  "masterSummary": "2-3 sentence overview of the entire document",\n' +
      '  "keywords": ["keyword1","keyword2","keyword3","keyword4","keyword5"],\n' +
      '  "researchQuestions": ["question1","question2"],\n' +
      '  "hypotheses": ["hypothesis1","hypothesis2"],\n' +
      '  "variables": ["variable1","variable2","variable3"],\n' +
      '  "methodology": ["method1","method2"],\n' +
      '  "findings": ["finding1","finding2","finding3"]\n' +
      '}\n\n' +
      'Output only valid JSON.';
  }

  return {
    createEmpty:         createEmpty,
    save:                save,
    load:                load,
    clear:               clear,
    saveQueue:           saveQueue,
    loadQueue:           loadQueue,
    clearQueue:          clearQueue,
    extractSmartText:    extractSmartText,
    splitIntoChunks:     splitIntoChunks,
    estimateTokens:      estimateTokens,
    getBackoffMs:        getBackoffMs,
    buildChunkPrompt:    buildChunkPrompt,
    buildExtractionPrompt: buildExtractionPrompt
  };

})();

// Export globally
window.NiraKB = NiraKB;
