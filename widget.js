/*!
 * Demski Group Chatbot Widget
 * Standalone, embeddable chat widget. Self-contained: injects its own
 * styles, DOM, and logic. Safe to load on any site via <script src>.
 */
(function () {
  'use strict';

  if (window.__demskiChatbotLoaded) return;
  window.__demskiChatbotLoaded = true;

  /* ── CONFIG ── */
  var SCRIPT_EL = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  function scriptAttr(name, fallback) {
    var v = SCRIPT_EL && SCRIPT_EL.getAttribute(name);
    return v !== null && v !== undefined && v !== '' ? v : fallback;
  }

  var BASE_URL = (function () {
    try {
      return new URL(SCRIPT_EL.src, location.href).href.replace(/\/[^/]*$/, '/');
    } catch (e) {
      return './';
    }
  })();

  /* Real OS detection (not screen-size media queries) — a Windows laptop
   * and a MacBook can share the exact same resolution, so width-only
   * breakpoints can't tell them apart and would size both identically.
   * userAgentData is the modern, spec-preferred source where available;
   * falls back to userAgent string sniffing on older/other browsers.
   * Sets a class on <html> once, at load time, so CSS rules can target
   * macOS specifically (html.cb-is-mac .cb-card {...}) without touching
   * any Windows/Linux/mobile rendering at all. */
  var IS_MAC = (function () {
    try {
      if (navigator.userAgentData && navigator.userAgentData.platform) {
        return navigator.userAgentData.platform.toLowerCase().indexOf('mac') !== -1;
      }
    } catch (e) {}
    return /Mac OS X|Macintosh/i.test(navigator.userAgent || '') && !/iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  })();
  if (IS_MAC) document.documentElement.classList.add('cb-is-mac');

  var AVATAR_URL    = scriptAttr('data-avatar', BASE_URL + 'avatar-alex.png');
  var AVATAR_FB     = scriptAttr('data-avatar-fallback', AVATAR_URL);
  var CALENDLY_URL  = scriptAttr('data-calendly', 'https://calendar.google.com/calendar/u/0/appointments/schedules/AcZssZ3loQplPyCXe28FPP0trIgOCmhJqwKCXka1x3uCkblaAFtklpetKpkyi6glNBGxVR8jpOQenySG');
  var BOT_NAME      = scriptAttr('data-bot-name', 'Erin');
  var BOT_TITLE     = scriptAttr('data-bot-title', 'The Demski Group');
  /* Optional cross-origin API host (e.g. an AWS Lambda Function URL) for
   * deployments where the API isn't served from the same origin as this
   * script (e.g. widget.js on Amplify Hosting, api/chat + api/send-lead as
   * separate Lambda Function URLs). Empty by default, which preserves the
   * original same-origin behavior below unchanged. */
  var API_BASE_OVERRIDE = scriptAttr('data-api-base', '').replace(/\/+$/, '');

  /* ── CONSTANTS ── */
  var IDLE_MSG_ID    = 'cb-idle-msg';
  var IDLE_BTNS_ID   = 'cb-idle-btns';
  var IDLE_BUBBLE_ID = 'cb-idle-bubble';

  var INTENT_OPTIONS = {
    'New startup or app idea':   ['Mobile App', 'Web App', 'SaaS Platform', 'eCommerce', 'Other'],
    'Software for my business':  ['Automate Workflows', 'Customer Management', 'Reporting & Analytics', 'Employee Tools', 'Other'],
    'Digital marketing help':    ['Increase Website Traffic', 'Generate More Leads', 'Social Media Growth', 'Paid Advertising', 'Other'],
    'Just exploring':            ['Planning a Future Project', 'Comparing Vendors', 'Learning About Tech', 'Just Curious']
  };
  var BUDGET_OPTIONS = ['Under $10k', '$10k - $25k', '$25k - $50k', '$50k+', 'Not sure yet'];
  var INTENT_DETAIL_FOLLOWUPS = {
    'New startup or app idea':  'Love it! Tell me more, what kind of app or product are you thinking about?',
    'Software for my business': 'Great! What problem are you trying to solve in your business?',
    'Digital marketing help':   'Nice! What are you hoping to improve: traffic, leads, or sales?',
    'Just exploring':           "That's totally fine! Can you tell me a bit about what you have in mind?"
  };

  var AV_STYLE =
    'width:34px!important;height:34px!important;min-width:34px!important;' +
    'max-width:34px!important;border-radius:50%!important;object-fit:cover!important;' +
    'flex-shrink:0!important;display:block!important;border:2px solid #fff!important;align-self:flex-end;';
  var WRAP_STYLE =
    'display:flex!important;align-items:flex-end!important;gap:8px!important;max-width:88%!important;';
  /* background/color are deliberately NOT inline here (unlike every other
   * property) — they're left to the .cb-bot-msg / .cb-user-msg CSS classes
   * (also applied on these same elements) specifically so the
   * prefers-color-scheme:dark media query in CSS can actually govern them.
   * An inline !important, even matched by an external !important rule,
   * always wins over the stylesheet regardless of media query state — so
   * keeping these two properties inline would make dark mode permanently
   * unreachable for message bubbles no matter what the CSS says. */
  var BOT_STYLE =
    'padding:10px 14px!important;' +
    'border-radius:4px 18px 18px 18px!important;font-size:13.5px!important;' +
    'line-height:1.65!important;' +
    'box-shadow:0 2px 8px rgba(0,0,0,0.06)!important;flex:1!important;' +
    'display:block!important;word-break:break-word!important;';
  var USER_STYLE =
    'padding:10px 16px!important;' +
    'border-radius:18px 18px 4px 18px!important;align-self:flex-end!important;' +
    'max-width:76%!important;font-size:13.5px!important;line-height:1.55!important;' +
    'box-shadow:0 4px 14px rgba(1,84,177,0.25)!important;display:block!important;word-break:break-word!important;';

  /* ── SMART TEASER MESSAGES ──
   * Message pools + selection logic for the small floating teaser/idle
   * bubble (.cb-teaser-bubble). Kept outside init() since none of this
   * needs live chat DOM/state (page type, localStorage-backed rotation
   * memory) — the one exception, pickIdleBubbleMessage (needs `lead`/
   * `step`), lives inside init() instead, right where those are in scope.
   * Everything here only changes WHICH string the existing bubble
   * mechanism displays and WHEN — the triggers/timing themselves
   * (card → bubble → badge → auto-open, the idle-reminder cadence) are
   * untouched; so is every backend/API/session/state-machine concern. */

  // Bot-message text is never trusted directly into innerHTML anywhere in
  // this file (see buildBotMsgBubble's own comment) — the same rule
  // applies here, since a "remembered topic" can trace back to free-typed
  // text a visitor once typed as their intent_detail (lead.intent_detail
  // falls back to raw user input when it doesn't match a canonical
  // option). A plain string like "Mobile App" round-trips through this
  // untouched; something like "<img src=x onerror=...>" comes out inert.
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function detectPageType() {
    var override = scriptAttr('data-page-type', '');
    if (override) return override;
    var path = (location.pathname || '').toLowerCase();
    if (/pricing|consult|contact/.test(path)) return 'pricing';
    if (/case-stud|portfolio|our-work|success-stor/.test(path)) return 'case-study';
    if (/service/.test(path)) return 'service';
    return 'home';
  }

  var TEASER_MESSAGES = {
    home: [
      'Hey! Do you have any questions?',
      'Have questions about your next software project?',
      'I can help you explore ideas.',
      'Need help choosing the right solution?',
      'Planning custom software?',
      'Looking for AI automation?'
    ],
    service: [
      'I can explain how this service works.',
      'Want a quick estimate?',
      "Not sure if this solution fits? Happy to help.",
      'I can answer technical questions.'
    ],
    'case-study': [
      'Want to see similar projects?',
      'I can recommend relevant case studies.',
      'Curious how this solution was built?'
    ],
    pricing: [
      'Need help estimating project cost?',
      'I can explain our process.'
    ]
  };

  var TEASER_MEMORY_KEY = 'cb_teaser_memory_v1';
  var TEASER_LAST_KEY = 'cb_teaser_last_v1';
  var TEASER_TOPIC_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — an older remembered topic is treated as stale rather than referenced as if it were current

  function loadTeaserMemory() {
    try { return JSON.parse(localStorage.getItem(TEASER_MEMORY_KEY) || 'null'); } catch (e) { return null; }
  }
  function saveTeaserMemory(patch) {
    try {
      var current = loadTeaserMemory() || {};
      localStorage.setItem(TEASER_MEMORY_KEY, JSON.stringify(Object.assign(current, patch)));
    } catch (e) { /* localStorage unavailable — teaser just falls back to page-type copy */ }
  }

  // Captured once, before this page load marks itself as a visit, so a
  // first-time visitor is never mistaken for a returning one within their
  // own first session (order matters: read, THEN write).
  var WAS_RETURNING_VISITOR = !!(loadTeaserMemory() && loadTeaserMemory().hasVisitedBefore);
  saveTeaserMemory({ hasVisitedBefore: true });

  /* Picks a random entry from `pool`, avoiding an exact repeat of whatever
   * was last shown under the same `categoryKey` (persisted across page
   * loads via TEASER_LAST_KEY) — "don't show the same teaser twice in a
   * short period" without needing time-based expiry to reason about. */
  function pickVaried(pool, categoryKey) {
    if (!pool || !pool.length) return '';
    if (pool.length === 1) return pool[0];
    var lastMap;
    try { lastMap = JSON.parse(localStorage.getItem(TEASER_LAST_KEY) || '{}'); } catch (e) { lastMap = {}; }
    var lastText = lastMap[categoryKey];
    var candidates = pool.filter(function (m) { return m !== lastText; });
    var chosen = candidates[Math.floor(Math.random() * candidates.length)];
    lastMap[categoryKey] = chosen;
    try { localStorage.setItem(TEASER_LAST_KEY, JSON.stringify(lastMap)); } catch (e) {}
    return chosen;
  }

  /* The pre-conversation teaser bubble's message: prefers a remembered
   * topic from a past visit ("still thinking about X?"), then a general
   * returning-visitor welcome, then falls back to a page-type-aware pool
   * matched against the current URL (or an explicit data-page-type
   * override on the loader/widget script tag). */
  function pickTeaserMessage() {
    var memory = loadTeaserMemory();
    if (memory && memory.lastTopic && memory.topicSavedAt && (Date.now() - memory.topicSavedAt) < TEASER_TOPIC_MAX_AGE_MS) {
      return pickVaried([
        'Ready to continue planning your ' + memory.lastTopic + '?',
        'Still thinking about ' + memory.lastTopic + '?',
        'Want to pick back up on your ' + memory.lastTopic + ' project?'
      ], 'topic');
    }
    if (WAS_RETURNING_VISITOR) {
      return pickVaried([
        'Welcome back! Want to continue where we left off?',
        "Welcome back, I'm here if you have more questions."
      ], 'returning');
    }
    var pageType = detectPageType();
    return pickVaried(TEASER_MESSAGES[pageType] || TEASER_MESSAGES.home, pageType);
  }

  /* ── STATE ── */
  var step = 0;
  /* Tracks an in-progress post-lead contact correction (step 8 only) — null
   * when no correction is active, otherwise 'name' | 'phone' | 'email'
   * naming the field the next typed message should be saved into. Lets the
   * widget recognize "I forgot to enter my actual email" as a structural
   * data-correction request rather than feeding it to the AI as ordinary
   * conversation, which would otherwise ignore it or restart qualification. */
  var correctingField = null;
  /* Set true the first time the user explicitly refuses to give their name
   * (step 4). The first refusal gets one gentle nudge offering a nickname/
   * business name as an easier alternative; a second refusal after that
   * stops asking and advances with a placeholder instead of looping forever
   * — mirrors the UX fix already applied to the phone/email steps, where a
   * refusal advances the flow rather than re-asking the same question. */
  var nameRefusalAcknowledged = false;
  /* 'default' | 'soft' — 'soft' whenever contact collection is entered via
   * a graceful-exit/deferral signal (see enterGracefulExitFlow), making
   * every name/phone/email prompt read as low-pressure and optional
   * rather than a required form field. Reset to 'default' by any caller
   * of goToContactStep that passes an explicit intro string (see there). */
  var contactFlowTone = 'default';
  var expanded = false;
  /* True from the moment the user takes any real conversational action
   * (MCQ pick, typed message, idle-reply click) — independent of `expanded`,
   * which only tracks a UI layout switch and stays false on some active
   * paths (e.g. the teaser's "No" branch). Used by the launcher to decide
   * whether reopening should resume the chat or show the welcome/teaser
   * flow; never reset except by an explicit conversation reset. */
  var conversationStarted = false;
  var cardTimer = null;
  var bubbleTimer = null;
  var badgeTimer = null;
  var teaserFlowDone = false;
  var gcTeardownActivityListeners = null;
  var idleTimer = null;
  var idleInterval = 60000;
  var awaitingIdleResponse = false;
  var idleBubbleTimer = null;
  /* The in-chat idle reminder is allowed to fire at most once per session —
   * once shown (answered or not), it never fires again for this visitor. */
  var idleReminderShown = false;

  /* ── SESSION PERSISTENCE ──
   * A plain page refresh would otherwise wipe chatHistory/lead/step since
   * they're only ever held in memory. Saved/restored as one JSON blob so a
   * visitor who refreshes (or closes and reopens the tab) picks up exactly
   * where they left off instead of starting over. */
  var SESSION_KEY = 'cb_session_v1';

  /* ── UTM CAPTURE ── */
  var urlP = {}, saved = {};
  try { saved = JSON.parse(localStorage.getItem('cb_utm') || '{}'); } catch (e) {}
  try { new URL(location.href).searchParams.forEach(function (v, k) { urlP[k] = v; }); } catch (e) {}
  var fp = Object.assign({}, saved, urlP);
  try { localStorage.setItem('cb_utm', JSON.stringify(fp)); } catch (e) {}

  var lead = {
    page: location.href, page_name: document.title,
    utm_source: fp.utm_source || '', utm_campaign: fp.utm_campaign || '',
    utm_medium: fp.utm_medium || '', utm_term: fp.utm_term || '',
    utm_content: fp.utm_content || '', gclid: fp.gclid || '',
    intent: '', intent_detail: '', budget: '', project_notes: '',
    name: '', phone: '', email: '', company: '', cta_choice: ''
  };

  /* Medium-confidence project-type/budget hints (see api/chat.js's
   * formatTurnSignalInstructions) — never locked into `lead`, never sent to
   * submitLead, only threaded back into the next relevant stepContext so
   * the AI can softly confirm rather than asking cold or silently dropping
   * what the visitor already half-said. Cleared once the real field lands. */
  var tentativeHints = { intent: '', budget: '' };

  /* ── SOUND ──
   * <audio> element with inline base64 WAV. Browsers allow .play() from
   * setTimeout once the page has received ANY user gesture (click, keydown,
   * scroll). We unlock the element on first interaction so later setTimeout
   * calls (badge, idle timer) can play it without a gesture at that moment.
   */
  var _snd = (function () {
    try {
      var a = document.createElement('audio');
      a.src = 'data:audio/wav;base64,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rf+y/7n/wP/J/9H/2v/j/+v/8//5//7/AgAFAAYABgAGAAQAAgAAAP7//P/6//r/+v/8//7/AgAIAA4AFgAeACcAMAA4AEEASABOAFMAVgBWAFUAUQBKAEEANgApABoACQD3/+X/0//B/6//oP+S/4f/fv94/3b/d/97/4P/jv+c/6z/v//T/+n///8VACsAPwBSAGMAcQB8AIQAiQCKAIgAggB6AG8AYQBSAEEALwAcAAoA+P/o/9n/y//A/7f/sP+s/6r/q/+t/7L/uP+//8f/0P/Z/+L/6v/x//j//f8BAAQABgAGAAYABAADAAAA/v/8//v/+v/6//v//v8BAAYADAAUABwAJAAtADYAPgBFAEwAUQBUAFUAVABRAEsAQwA4ACwAHQANAPz/6v/X/8b/tP+l/5b/i/+B/3v/eP94/3z/g/+N/5r/qf+7/8//5P/6/xAAJQA6AE0AXgBsAHgAgQCGAIgAhwCCAHoAcABjAFQARAAyACAADgD8/+z/3P/P/8P/uv+z/67/rP+s/67/sv+4/77/xv/P/9j/4P/o//D/9//8/wAABAAFAAYABgAFAAMAAQD///3/+//6//r/+//9/wAABQALABIAGQAiACoAMwA7AEMASQBPAFIAVABTAFEASwBEADoALgAgABAAAADu/9z/yv+5/6n/m/+P/4X/fv96/3r/fP+D/4z/mP+n/7j/y//g//X/CwAgADUASABZAGgAdAB9AIMAhgCFAIEAegBxAGUAVgBGADUAJAASAAAA8P/g/9L/xv+9/7X/sP+t/63/rv+y/7f/vv/F/87/1v/f/+f/7//1//v/AAADAAUABgAGAAUAAwABAP///f/7//r/+v/7//3/AAAEAAkAEAAXAB8AKAAwADkAQABHAE0AUABTAFMAUABMAEUAOwAwACMAFAADAPL/4f/P/77/rv+f/5P/if+B/33/fP99/4P/i/+X/6X/tf/I/9z/8f8GABsALwBDAFQAYwBwAHoAgACEAIQAgQB7AHIAZgBYAEkAOQAnABYABAD0/+T/1v/K/8D/uP+y/6//rv+v/7L/t/+9/8T/zP/V/93/5v/t//T/+v///wIABQAGAAYABQAEAAIAAAD+//z/+//6//v//P///wMACAAOABUAHQAlAC4ANgA+AEUASgBPAFEAUgBQAEwARgA9ADIAJQAXAAcA9v/l/9T/w/+z/6T/l/+N/4X/f/99/3//g/+L/5X/o/+y/8T/2P/s/wEAFgAqAD0ATwBfAGwAdgB9AIEAggCAAHoAcgBnAFoATAA7ACsAGQAIAPf/6P/a/83/w/+6/7T/sf+v/7D/sv+3/73/xP/L/9T/3P/k/+z/8//5//7/AQAEAAYABgAFAAQAAgAAAP7//P/7//r/+v/8//7/AgAGAAwAEwAbACMAKwAzADsAQgBIAE0AUABQAE8ATABGAD4ANAAoABoACwD6/+n/2P/H/7f/qP+b/5D/iP+C/4D/gP+E/4r/lP+h/7D/wf/U/+j//P8RACUAOABKAFoAZwByAHoAfwCAAH8AegBzAGgAXABOAD4ALgAdAAwA+//s/93/0f/G/73/t/+y/7D/sf+z/7f/vP/D/8r/0v/b/+P/6v/x//j//f8BAAQABQAGAAUABAADAAEA///9//v/+v/6//v//f8BAAUACwARABkAIAApADEAOQBAAEYASwBOAE8ATwBMAEcAPwA2ACoAHQAOAP7/7v/d/8z/vP+t/6D/lP+L/4X/gv+B/4T/iv+T/5//rf++/9D/4//4/wwAIAAzAEUAVQBjAG4AdwB8AH4AfgB6AHMAaQBeAFAAQQAxACAADwD//+//4f/U/8n/wP+5/7T/sv+y/7P/t/+8/8L/yf/R/9n/4f/p//D/9v/8/wAAAwAFAAYABgAFAAMAAQD///3//P/7//r/+//9/wAABAAJAA8AFwAeACYALgA2AD0ARABJAEwATgBOAEsARwBAADcALAAgABEAAgDy/+H/0P/A/7H/pP+Y/4//iP+E/4P/hf+K/5P/nv+r/7v/zP/f//P/BwAbAC4AQABRAF8AagBzAHkAfAB8AHkAcwBqAF8AUgBEADQAIwATAAMA8//k/9f/zP/D/7v/tv+z/7P/tP+3/7z/wv/I/9D/2P/g/+j/7//1//v///8CAAQABQAGAAUAAwACAP///v/8//v/+v/7//z///8DAAgADgAVABwAJAAsADQAOwBBAEcASgBNAE0ASwBHAEEAOQAuACIAFAAFAPX/5f/V/8X/tv+o/5z/kv+L/4b/hf+G/4v/kv+c/6n/uP/J/9z/7/8DABYAKgA8AEwAWgBnAHAAdwB6AHsAeABzAGsAYABUAEYANwAnABYABgD3/+j/2//P/8X/vv+4/7X/tP+0/7f/u//B/8j/z//X/9//5v/u//T/+v/+/wIABAAFAAYABQAEAAIAAAD+//z/+//6//v//P/+/wIABwAMABMAGgAiACkAMQA4AD8ARABJAEsATABLAEcAQgA6ADAAJAAXAAkA+f/p/9n/yf+6/6z/oP+W/47/if+H/4f/i/+S/5v/p/+2/8b/2P/r//7/EgAlADcARwBWAGMAbQB0AHgAeQB3AHMAawBiAFYASAA5ACoAGgAKAPr/6//e/9L/yP/A/7r/tv+1/7X/t/+7/8H/x//O/9b/3f/l/+z/8//5//3/AQAEAAUABQAFAAQAAgAAAP7//f/7//v/+//8//7/AQAFAAsAEQAYAB8AJwAvADYAPQBCAEcASgBLAEoARwBCADsAMgAnABoADAD9/+3/3f/N/77/sP+k/5n/kf+M/4n/if+M/5L/mv+m/7P/w//U/+f/+v8NACAAMgBDAFIAXwBpAHEAdQB3AHYAcgBsAGMAVwBKADwALQAdAA0A/v/v/+H/1f/L/8P/vP+4/7b/tv+4/7v/wP/G/83/1f/c/+T/6//y//f//P8AAAMABQAFAAUABAADAAEA///9//z/+//7//v//f8AAAQACQAPABYAHQAlACwANAA6AEAARQBIAEoASQBHAEIAPAAzACkAHQAPAAAA8f/h/9L/w/+1/6j/nf+U/47/i/+K/4z/kv+a/6T/sf/A/9H/4//2/wkAGwAtAD4ATQBbAGUAbgBzAHUAdQByAGwAYwBZAEwAPgAwACAAEAABAPL/5f/Z/87/xf+//7r/t/+3/7j/u//A/8b/zP/T/9v/4//q//D/9v/7////AgAEAAUABQAEAAMAAQD///7//P/7//v/+//9////AwAIAA4AFAAbACIAKgAxADgAPgBDAEYASABIAEcAQwA9ADUAKwAfABIABAD1/+X/1v/H/7n/rP+h/5j/kf+N/4z/jf+S/5n/o/+v/77/zv/f//L/BAAXACkAOgBJAFYAYgBqAHAAcwB0AHEAbABkAFoATgBBADIAIwAUAAQA9v/o/9z/0f/I/8H/vP+5/7j/uf+8/8D/xf/L/9L/2v/h/+j/7//1//r///8CAAQABQAFAAUAAwACAAAA/v/8//v/+//7//z///8CAAcADAASABkAIAAoAC8ANgA8AEEARQBHAEgARgBDAD0ANgAsACEAFQAHAPj/6f/a/8v/vf+w/6T/m/+U/4//jf+O/5L/mf+i/63/u//L/9z/7v8AABIAJAA1AEUAUgBeAGcAbgBxAHIAcABsAGUAWwBQAEMANQAmABcACAD5/+v/3//U/8v/w/++/7r/uf+6/7z/wP/F/8v/0v/Z/+D/5//u//T/+f/+/wEAAwAFAAUABQAEAAIAAAD+//3/+//7//v//P/+/wEABQALABEAFwAeACUALQA0ADoAPwBDAEYARwBGAEMAPgA3AC4AIwAXAAoA/P/t/97/z//B/7T/qP+e/5f/kv+P/5D/k/+Y/6H/rP+5/8j/2P/q//z/DgAgADEAQABOAFoAZABrAG8AcQBvAGsAZQBcAFEARQA3ACkAGgALAPz/7//i/9f/zf/G/8D/vP+6/7r/vP/A/8T/yv/R/9j/3//m/+3/8//4//3/AAADAAUABQAFAAQAAgABAP///f/8//v/+//8//7/AQAEAAkADwAVABwAIwAqADEAOAA9AEEARABGAEUAQwA+ADgAMAAlABoADQD///D/4v/T/8X/uP+s/6L/mv+U/5H/kf+T/5j/oP+q/7f/xf/V/+b/+P8KABsALAA8AEoAVgBgAGgAbQBvAG4AawBlAF0AUwBHADoALAAdAA4AAADy/+X/2v/Q/8j/wv++/7v/u/+9/8D/xP/J/9D/1//e/+X/7P/y//f//P8AAAIABAAFAAUABAADAAEA///+//z/+//7//z//f8AAAMACAANABMAGgAhACgALwA1ADsAQABDAEQARABCAD4AOQAxACcAHAAQAAIA9P/l/9f/yf+8/7D/pf+d/5f/k/+S/5T/mf+g/6n/tf/D/9L/4//0/wYAFwAoADgARgBTAF0AZQBqAG0AbQBqAGUAXgBUAEkAPAAuACAAEQADAPX/6P/d/9P/yv/E/7//vf+8/73/wP/E/8n/z//W/93/5P/q//H/9v/7////AgAEAAUABQAEAAMAAQAAAP7//P/7//v/+//9////AgAHAAwAEgAYAB8AJgAtADMAOQA+AEEAQwBDAEIAPwA5ADIAKQAeABIABQD3/+n/2//N/7//s/+p/6D/mv+V/5T/lf+Z/5//qP+z/8D/z//f//D/AgATACQANABCAE8AWgBiAGgAawBsAGoAZQBeAFUASgA+ADEAIwAUAAYA+P/r/+D/1f/N/8b/wf++/73/vv/A/8T/yP/O/9X/3P/i/+n/8P/1//r//v8BAAMABQAFAAQAAwACAAAA/v/9//z/+//7//z///8CAAYACgAQABYAHQAkACsAMQA3ADwAQABCAEMAQgA/ADoAMwArACEAFQAIAPv/7f/e/9D/w/+3/6z/o/+c/5j/lv+W/5n/n/+n/7L/vv/M/9z/7f/+/w8AHwAvAD4ASwBWAF8AZQBpAGoAaQBlAF8AVgBMAEAAMwAlABcACQD7/+//4//Y/8//yP/D/8D/vv++/8D/xP/I/87/1P/b/+H/6P/u//T/+f/9/wEAAwAEAAUABAAEAAIAAAD///3//P/7//v//P/+/wEABQAJAA8AFQAbACIAKQAvADUAOgA+AEEAQgBBAD8AOgA0ACwAIgAXAAsA/v/w/+L/1P/H/7v/sP+m/5//mv+X/5f/mv+f/6b/sP+8/8r/2f/p//r/CwAbACsAOgBHAFMAXABjAGcAaQBoAGQAXwBXAE0AQgA1ACgAGgAMAP7/8v/m/9v/0v/L/8X/wf+//7//wf/E/8j/zf/T/9r/4P/n/+3/8//4//3/AAADAAQABQAFAAQAAgABAP///v/8//v/+//8//7/AAAEAAgADQATABkAIAAnAC0AMwA4ADwAPwBBAEAAPgA6ADUALQAkABoADgABAPP/5v/Y/8v/vv+z/6r/ov+c/5n/mf+a/5//pv+v/7r/x//W/+b/9v8HABcAJwA2AEMATwBZAGAAZQBnAGcAZABfAFgATgBDADcAKgAdAA8AAgD1/+n/3v/V/83/x//D/8D/wP/B/8T/yP/N/9L/2f/f/+b/7P/y//f//P///wIABAAFAAUABAADAAEAAAD+//3//P/7//z//f///wMABwAMABEAFwAeACUAKwAxADYAOwA+AD8AQAA+ADsANQAvACYAHAAQAAQA9//p/9z/zv/C/7f/rf+l/5//m/+a/5v/n/+l/67/uf/F/9P/4//z/wMAEwAjADIAQABLAFUAXQBiAGUAZgBjAF8AWABPAEUAOQAtAB8AEgAEAPj/7P/h/9f/z//J/8T/wv/B/8L/xP/H/8z/0v/Y/97/5f/r//H/9v/7////AQADAAQABQAEAAMAAgAAAP7//f/8//v//P/9////AgAGAAoAEAAWABwAIwApAC8ANAA5ADwAPgA/AD4AOwA2ADAAJwAeABMABwD6/+z/3//S/8b/uv+w/6j/of+d/5z/nP+f/6X/rf+3/8P/0f/f/+////8PAB8ALgA8AEgAUgBaAGAAYwBkAGMAXwBZAFAARwA7AC8AIgAVAAcA+//u/+P/2v/R/8v/xv/D/8L/wv/E/8f/zP/R/9f/3f/k/+r/8P/1//r//v8BAAMABAAFAAQAAwACAAAA///9//z//P/8//3//v8BAAUACQAOABQAGgAhACcALQAyADcAOwA9AD4APQA7ADYAMAApACAAFQAJAP3/8P/j/9b/yf++/7P/q/+k/5//nf+d/6D/pf+s/7b/wf/O/93/7P/8/wwAGwAqADgARABPAFcAXQBhAGMAYgBeAFkAUQBIAD0AMQAkABcACgD9//H/5v/c/9T/zf/I/8T/w//D/8T/x//L/9D/1v/c/+P/6f/v//T/+f/9/wAAAwAEAAQABAADAAIAAQD///7//P/8//z//P/+/wAABAAIAA0AEgAYAB8AJQArADEANQA5ADwAPQA9ADsANwAxACoAIQAXAAwAAADz/+b/2f/N/8H/t/+u/6f/ov+f/5//oP+l/6z/tP+//8z/2v/p//j/CAAXACYANABBAEsAVABbAF8AYQBhAF4AWQBSAEkAPwAzACcAGgANAAAA9P/p/9//1v/P/8r/xv/E/8T/xf/H/8v/0P/V/9v/4v/o/+7/8//4//z/AAACAAQABAAEAAQAAgABAP///v/9//z//P/8//3/AAADAAcACwARABcAHQAjACkALwA0ADgAOgA8ADwAOgA3ADIAKwAjABkADgADAPb/6f/c/9D/xP+6/7H/qf+k/6H/oP+h/6X/q/+z/77/yv/X/+b/9f8EABQAIgAwAD0ASABRAFgAXQBgAGAAXQBZAFIASgBAADUAKQAcABAAAwD3/+z/4v/Z/9H/zP/H/8X/xP/F/8f/y//P/9X/2//h/+f/7f/y//f//P///wIAAwAEAAQABAADAAEAAAD+//3//P/8//z//f///wIABgAKAA8AFQAbACEAJwAtADIANgA5ADsAOwA6ADcAMgAsACQAGwARAAUA+f/s/+D/0//I/73/tP+s/6b/o/+h/6L/pf+r/7L/vP/I/9X/4//x/wEAEAAfAC0AOQBFAE4AVgBbAF4AXgBdAFkAUwBLAEIANwArAB8AEgAGAPr/7v/k/9v/0//N/8n/xv/F/8b/yP/L/8//1P/a/+D/5v/s//H/9v/7//7/AQADAAQABAAEAAMAAgAAAP///f/8//z//P/9////AQAFAAkADgATABkAHwAlACsAMAA0ADgAOgA6ADoANwAzAC0AJgAdABMACAD8//D/4//X/8v/wP+3/6//qf+l/6P/o/+m/6v/sv+7/8b/0v/g/+7//f8MABsAKQA2AEEASwBTAFkAXABdAFwAWQBTAEwAQwA5AC0AIQAVAAkA/f/x/+f/3v/W/8//y//I/8b/xv/I/8v/z//U/9n/3//l/+v/8P/1//r//v8BAAMABAAEAAQAAwACAAAA///+//z//P/8//3//v8BAAQACAANABIAGAAdACMAKQAuADMANgA5ADoAOQA3ADMALgAnAB8AFQAKAP//8//m/9r/zv/E/7r/sv+r/6f/pP+k/6b/q/+x/7r/xP/Q/93/6//6/wkAFwAlADIAPgBIAFAAVgBaAFwAWwBYAFMATQBEADoALwAjABcACwD///T/6f/g/9j/0f/M/8n/x//H/8j/y//O/9P/2P/e/+T/6v/v//X/+f/9/wAAAgAEAAQABAADAAIAAQD///7//f/8//z//P/+/wAAAwAHAAsAEAAWABwAIgAnACwAMQA1ADcAOQA4ADcAMwAvACgAIAAXAA0AAQD1/+n/3f/S/8f/vf+1/67/qf+m/6X/p/+r/7H/uf/C/87/2//o//f/BQAUACIALwA7AEUATQBUAFgAWgBaAFgAUwBNAEUAPAAxACYAGgAOAAIA9v/s/+L/2v/T/87/yv/I/8j/yf/L/87/0//Y/93/4//p/+7/9P/4//z///8CAAMABAAEAAMAAgABAAAA/v/9//z//P/8//3///8CAAYACgAPABQAGgAgACUAKwAvADMANgA4ADgANwA0AC8AKQAiABkADwAEAPj/7P/h/9X/yv/A/7f/sP+r/6j/p/+o/6v/sP+4/8H/zP/Y/+b/9P8CABAAHgArADcAQgBKAFEAVgBZAFkAVwBTAE4ARgA9ADMAKAAcABAABAD5/+//5f/c/9X/0P/M/8n/yf/J/8v/zv/S/9f/3P/i/+j/7f/z//f/+////wEAAwAEAAQABAADAAEAAAD///3//P/8//z//f///wEABQAJAA4AEwAYAB4AJAApAC4AMgA1ADcANwA2ADQAMAAqACMAGgARAAYA+//v/+T/2P/N/8P/uv+z/63/qv+o/6j/q/+w/7f/wP/K/9b/4//x////DQAbACgANAA/AEgATwBUAFcAWABXAFMATgBHAD4ANAAqAB4AEwAHAPz/8f/n/9//1//S/83/y//J/8r/y//O/9L/1//c/+H/5//s//L/9v/7//7/AQADAAQABAAEAAMAAgAAAP///v/9//z//P/9//7/AQAEAAgADAARABcAHAAiACcALAAwADMANgA2ADYANAAwACsAJAAcABMACQD+//L/5//b/9D/xv+9/7b/sP+r/6n/qf+s/7D/tv++/8j/1P/g/+7//P8KABcAJAAxADsARQBMAFIAVQBXAFYAUwBOAEgAPwA2ACwAIAAVAAkA/v/0/+r/4f/a/9P/z//M/8r/yv/M/87/0v/W/9v/4P/m/+z/8f/2//r//f8AAAIAAwAEAAQAAwACAAEA///+//3//P/8//3//v8AAAMABwALABAAFQAbACAAJQAqAC8AMgA0ADUANQAzADAAKwAlAB4AFQALAAAA9f/q/97/0//J/8D/uP+y/63/q/+q/6z/sP+2/73/x//S/97/6//4/wYAFAAhAC0AOABCAEoAUABTAFUAVQBTAE4ASABAADcALQAjABcADAABAPb/7P/j/9z/1f/R/83/y//L/8z/zv/R/9b/2v/g/+X/6//w//X/+f/9/wAAAgADAAQABAADAAIAAQAAAP7//f/8//z//f/+/wAAAgAGAAoADwAUABkAHgAkACkALQAxADMANQA1ADMAMAAsACYAHwAXAA0AAwD4/+3/4f/W/8z/w/+7/7T/r/+t/6z/rf+w/7X/vP/F/9D/3P/o//b/AwARAB4AKgA1AD8ARwBNAFIAVABUAFIATgBJAEEAOQAvACQAGQAOAAMA+f/v/+b/3v/X/9L/z//M/8z/zP/O/9H/1f/a/9//5P/q/+//9P/4//z///8BAAMABAAEAAMAAgABAAAA///9//3//P/8//3///8CAAUACQANABIAFwAdACIAJwAsAC8AMgA0ADQAMwAwACwAJwAgABgADwAFAPr/7//k/9n/z//G/77/t/+y/67/rf+u/7D/tf+8/8T/zv/Z/+b/8/8AAA0AGgAnADIAPABEAEsAUABSAFMAUgBOAEkAQgA6ADEAJgAcABEABgD7//H/6P/g/9n/1P/Q/83/zP/N/87/0f/V/9n/3v/j/+n/7v/z//f/+//+/wEAAwADAAQAAwADAAEAAAD///7//f/8//z//f///wEABAAIAAwAEQAWABsAIAAlACoALgAxADMAMwAzADAALQAoACEAGgARAAcA/f/y/+f/3P/S/8n/wP+5/7T/sP+u/67/sf+1/7v/w//M/9f/4//w//3/CgAXACMALwA5AEIASABOAFEAUgBRAE4ASQBDADsAMgAoAB4AEwAIAP3/8//q/+L/2//W/9H/z//N/83/z//R/9X/2f/e/+P/6P/t//L/9//6//7/AAACAAMABAADAAMAAgAAAP///v/9//z//P/9//7/AAADAAcACwAPABQAGgAfACQAKAAsAC8AMgAyADIAMAAtACkAIwAbABMACQD///X/6v/f/9X/y//D/7z/tv+y/7D/r/+x/7X/uv/C/8v/1f/h/+3/+v8HABQAIAAsADYAPwBGAEsATwBQAFAATgBJAEMAPAAzACoAIAAVAAoAAAD2/+3/5P/d/9f/0//Q/87/zv/P/9H/1P/Y/93/4v/n/+z/8f/2//r//f8AAAIAAwAEAAQAAwACAAEA///+//3//f/8//3//v8AAAIABgAKAA4AEwAYAB0AIgAnACsALgAwADIAMgAwAC0AKQAjAB0AFAALAAIA9//t/+L/2P/O/8b/vv+4/7T/sf+w/7L/tf+6/8H/yv/T/9//6//3/wQAEQAdACkAMwA8AEQASQBNAE8ATwBNAEkARAA9ADUAKwAiABcADQACAPj/7//m/9//2f/U/9H/z//P/8//0f/U/9j/3P/h/+b/6//w//X/+f/8////AQADAAMABAADAAIAAQAAAP7//f/9//z//f/+////AgAFAAkADQASABcAHAAhACUAKQAtAC8AMQAxADAALQAqACQAHgAWAA0ABAD6/+//5f/b/9H/yP/B/7r/tv+z/7L/sv+1/7r/wP/I/9L/3f/o//X/AQAOABoAJQAwADkAQQBHAEsATgBOAE0ASQBEAD4ANgAtACMAGQAPAAQA+v/x/+n/4f/b/9b/0v/Q/8//0P/R/9T/2P/c/+H/5v/r/+//9P/4//z///8BAAIAAwAEAAMAAgABAAAA///+//3//P/9//3///8BAAQACAAMABAAFQAaAB8AJAAoACsALgAwADAAMAAtACoAJQAfABgADwAGAPz/8v/o/93/1P/L/8P/vf+4/7T/s/+z/7X/uv+//8f/0P/b/+b/8v/+/wsAFwAiAC0ANgA+AEUASgBMAE0ATABJAEUAPgA3AC4AJQAbABEABwD9//P/6//j/93/2P/U/9H/0P/Q/9L/1P/X/9v/4P/l/+r/7//z//f/+//+/wEAAgADAAMAAwADAAIAAAD///7//f/9//3//f///wEAAwAHAAsADwAUABkAHgAiACYAKgAtAC8AMAAvAC0AKgAmACAAGQARAAgA/v/0/+r/4P/X/87/xv+//7r/tv+0/7T/tv+5/7//xv/P/9n/5P/v//z/CAAUAB8AKgA0ADwAQwBIAEsATABLAEkARQA/ADgAMAAnAB0AEwAJAP//9v/t/+X/3//Z/9X/0v/R/9H/0v/U/9f/2//f/+T/6f/u//L/9//6//7/AAACAAMAAwADAAMAAgABAP///v/9//3//f/9//7/AAADAAYACQAOABIAFwAcACEAJQApACwALgAvAC8ALQAqACYAIQAaABMACgABAPf/7f/j/9n/0P/I/8H/vP+4/7X/tf+2/7n/vv/F/83/1//i/+3/+f8FABEAHAAnADEAOQBAAEYASQBLAEsASQBFAEAAOQAxACgAHwAVAAsAAQD4/+//5//g/9v/1//U/9L/0f/S/9T/1//b/9//4//o/+3/8v/2//r//f8AAAEAAwADAAMAAwACAAEAAAD+//3//f/9//3//v8AAAIABQAIAA0AEQAWABsAHwAkACcAKwAtAC4ALgAtACsAJwAiABwAFAAMAAMA+f/v/+b/3P/T/8v/xP++/7r/t/+2/7f/uv++/8T/zP/V/+D/6//2/wIADgAZACQALgA3AD4ARABHAEkASgBIAEUAQAA6ADIAKgAgABcADQADAPr/8f/p/+L/3f/Y/9X/0//S/9P/1P/X/9r/3v/j/+f/7P/x//X/+f/8////AQACAAMAAwADAAIAAQAAAP///v/9//3//f/+////AQAEAAcACwAQABQAGQAeACIAJgApACwALQAuAC0AKwAnACMAHQAWAA4ABQD7//L/6P/f/9b/zf/G/8D/u/+4/7f/uP+6/77/xP/L/9T/3v/o//T///8LABcAIQArADQAPABBAEYASABJAEgARQBAADoAMwArACIAGQAPAAUA/P/z/+v/5P/e/9n/1v/U/9P/0//U/9f/2v/e/+L/5//r//D/9P/4//z//v8BAAIAAwADAAMAAgABAAAA///+//3//f/9//3///8BAAMABwAKAA8AEwAYABwAIQAlACgAKwAsAC0ALAArACgAIwAeABcADwAHAP7/9P/r/+H/2P/Q/8j/wv+9/7r/uP+4/7r/vv/D/8r/0v/c/+b/8f/9/wgAFAAfACkAMgA5AD8ARABHAEgARwBFAEAAOwA0ACwAJAAaABEABwD+//X/7f/m/+D/2//X/9X/1P/U/9X/1//a/93/4v/m/+v/7//0//j/+//+/wAAAgADAAMAAwACAAIAAAD///7//f/9//3//f/+/wAAAwAGAAkADQASABYAGwAfACMAJwAqACsALAAsACsAKAAkAB8AGAARAAkAAAD3/+3/5P/b/9L/y//E/7//vP+6/7n/u/++/8P/yf/R/9r/5P/v//r/BgARABwAJgAvADcAPQBCAEUARwBGAEQAQQA7ADUALgAlABwAEwAJAAAA9//v/+j/4v/d/9n/1v/U/9T/1f/X/9r/3f/h/+X/6v/u//P/9//6//3/AAACAAMAAwADAAMAAgABAAAA/v/+//3//f/9//7/AAACAAUACAAMABAAFQAZAB4AIgAlACgAKgAsACwAKgAoACQAHwAZABIACgACAPn/7//m/93/1f/N/8b/wf+9/7v/uv+7/77/wv/I/9D/2f/i/+3/+P8DAA4AGQAjACwANAA7AEAARABFAEUARABBADwANgAvACcAHgAVAAsAAgD5//H/6v/j/97/2v/X/9X/1f/V/9f/2f/d/+H/5f/p/+7/8v/2//r//f///wEAAgADAAMAAwACAAEAAAD///7//f/9//3//v///wEABAAHAAsADwAUABgAHAAhACQAJwApACsAKwAqACgAJQAgABoAFAAMAAQA+//y/+n/4P/X/8//yf/D/7//vP+7/7z/vv/C/8j/z//X/+D/6//1/wEADAAWACAAKgAyADkAPgBCAEQARQBDAEEAPAA3ADAAKAAfABYADQAEAPv/8//s/+X/4P/b/9j/1v/V/9b/1//Z/9z/4P/k/+n/7f/x//X/+f/8////AQACAAMAAwADAAIAAQAAAP///v/9//3//f/+////AQADAAcACgAOABIAFwAbAB8AIwAmACgAKgAqACoAKAAlACEAGwAVAA4ABgD9//T/6//i/9r/0v/L/8X/wf++/7z/vP++/8L/x//O/9b/3//p//P//v8JABQAHgAnAC8ANwA8AEAAQwBEAEMAQAA8ADcAMQApACEAGAAPAAYA/f/1/+7/5//h/93/2f/X/9b/1v/X/9n/3P/g/+T/6P/s//H/9f/4//z//v8AAAIAAwADAAMAAgABAAAA///+//3//f/9//7///8AAAMABgAJAA0AEQAVABoAHgAiACUAJwApACoAKQAoACUAIQAcABYADwAHAP//9v/t/+X/3P/U/83/x//C/7//vf+9/7//wv/H/83/1P/d/+f/8f/8/wYAEQAbACUALQA0ADoAPwBBAEMAQgBAAD0AOAAxACoAIgAaABEACAD///f/8P/p/+P/3v/a/9j/1//X/9j/2f/c/9//4//n/+z/8P/0//j/+//+/wAAAgADAAMAAwACAAIAAQD///7//v/9//3//f/+/wAAAgAFAAgADAAQABQAGAAcACAAJAAmACgAKQApACgAJQAiAB0AFwARAAkAAQD4//D/5//e/9f/z//J/8T/wf+//77/v//C/8b/zP/T/9z/5f/v//n/BAAOABgAIgArADIAOAA9AEAAQgBBAEAAPQA4ADIAKwAkABsAEwAKAAEA+f/x/+v/5f/g/9z/2f/Y/9f/2P/Z/9z/3//j/+f/6//v//P/9//6//3/AAABAAIAAwADAAMAAgABAAAA///+//3//f/9//7/AAACAAQABwALAA8AEwAXABsAHwAiACUAJwAoACkAKAAlACIAHgAYABIACwADAPr/8v/p/+H/2f/S/8v/xv/C/8D/v//A/8L/xv/L/9L/2v/j/+3/9/8BAAwAFgAfACgAMAA2ADsAPwBAAEEAPwA9ADgAMwAsACUAHQAUAAwAAwD7//P/7P/m/+H/3f/a/9j/2P/Y/9r/3P/f/+L/5v/q/+7/8v/2//r//f///wEAAgADAAMAAwACAAEAAAD///7//f/9//3//v///wEAAwAGAAoADgASABYAGgAeACEAJAAmACgAKAAnACYAIwAfABkAEwAMAAUA/P/0/+v/4//b/9T/zf/I/8T/wf/A/8D/wv/G/8v/0f/Z/+H/6//1////CQATAB0AJgAtADQAOQA9AD8AQAA/ADwAOQAzAC0AJgAeABYADgAFAP3/9f/u/+j/4//e/9v/2f/Y/9n/2v/c/9//4v/m/+r/7v/y//b/+f/8////AQACAAMAAwADAAIAAQAAAP///v/+//3//f/+////AQADAAYACQANABEAFQAZABwAIAAjACUAJwAnACcAJQAjAB8AGgAUAA4ABgD+//b/7v/l/93/1v/P/8r/xv/D/8H/wf/D/8b/yv/Q/9j/4P/p//P//f8HABEAGgAjACsAMgA3ADsAPgA/AD4APAA5ADQALgAnACAAGAAPAAcA///3//D/6v/k/+D/3P/a/9n/2f/a/9z/3v/i/+X/6f/t//H/9f/4//z//v8AAAIAAgADAAMAAgABAAAA///+//7//f/9//7///8AAAIABQAIAAwADwATABcAGwAfACIAJAAmACcAJwAlACMAIAAbABUADwAIAAAA+P/w/+j/4P/Y/9L/zP/H/8T/wv/C/8P/xv/K/9D/1v/e/+f/8f/7/wUADgAYACEAKQAwADUAOgA9AD4APgA8ADkANAAvACgAIQAZABEACQABAPn/8v/r/+b/4f/e/9v/2v/Z/9r/3P/e/+H/5f/p/+z/8P/0//j/+//+/wAAAQACAAMAAwACAAIAAQAAAP///v/9//3//v/+/wAAAgAEAAcACwAOABIAFgAaAB4AIQAjACUAJgAmACUAIwAgABwAFwAQAAkAAgD6//L/6v/i/9r/1P/O/8n/xv/D/8P/xP/G/8r/z//V/93/5v/v//j/AgAMABYAHgAnAC4ANAA4ADsAPQA9ADwAOQA1AC8AKQAiABsAEgAKAAIA+//z/+3/5//i/9//3P/b/9r/2//c/97/4f/k/+j/7P/w//T/9//6//3///8BAAIAAwADAAIAAgABAAAA///+//3//f/9//7///8BAAQABgAKAA0AEQAVABkAHAAgACIAJAAlACYAJQAjACAAHAAXABIACwAEAPz/9P/s/+T/3f/W/9D/y//H/8X/xP/E/8b/yv/O/9T/3P/k/+3/9v8=';
      a.volume = 0.35;
      a.load();
      return a;
    } catch (e) { return null; }
  })();

  /* iOS Safari only allows audio playback triggered synchronously inside a user
   * gesture — load() alone doesn't unlock later async play() calls (e.g. from the
   * badge/idle timers). Play+immediately-pause once inside the first tap/click so
   * the session is unlocked for every subsequent programmatic play(). */
  function unlockSnd() {
    document.removeEventListener('touchstart', unlockSnd);
    document.removeEventListener('click', unlockSnd);
    if (!_snd) return;
    _snd.play().then(function () { _snd.pause(); _snd.currentTime = 0; }).catch(function () {});
  }
  document.addEventListener('touchstart', unlockSnd, { passive: true });
  document.addEventListener('click', unlockSnd);

  function playChime() {
    if (!_snd) return;
    try { _snd.currentTime = 0; _snd.play().catch(function () {}); } catch (e) {}
  }

  function playNotification() {
    playChime();
  }

  /* ── STYLES ── */
  var CSS = ''
    + '#bot-launcher{position:fixed;bottom:52px;right:52px;width:98px;height:98px;border-radius:50%;cursor:pointer;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:transparent;opacity:0;transform:translateY(60px) scale(0.7);transition:opacity .45s ease,transform .45s cubic-bezier(.34,1.56,.64,1);font-family:"Outfit",sans-serif;}'
    + '#bot-launcher.cb-launcher-visible{opacity:1;transform:translateY(0) scale(1);}'
    + '#bot-launcher::before{content:"";position:absolute;inset:-3px;border-radius:50%;background:linear-gradient(135deg,#0154B1,#4facfe,#0154B1);z-index:-1;animation:cb-ring-spin 4s linear infinite;}'
    + '@keyframes cb-ring-spin{to{transform:rotate(360deg);}}'
    + '#bot-launcher img{width:92px;height:92px;box-sizing:border-box;border-radius:50%;object-fit:cover;object-position:50% 30%;transform:scale(1.1);border:3px solid #fff;box-shadow:0 6px 24px rgba(1,84,177,0.28);transition:transform .3s ease;}'
    + '#bot-launcher:hover img{transform:scale(1.16);}'
    + '.cb-online-dot{position:absolute;bottom:4px;right:4px;width:14px;height:14px;background:#22c55e;border-radius:50%;border:2.5px solid #fff;box-shadow:0 0 0 2px rgba(34,197,94,0.25);}'
    + '.cb-launcher-badge{position:absolute;top:2px;right:2px;width:22px;height:22px;background:#e53e3e;color:#fff;border-radius:50%;font-size:12px;font-weight:700;font-family:"Outfit",sans-serif;display:none;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(229,62,62,0.5);animation:cb-badge-pop .3s cubic-bezier(.34,1.56,.64,1) both;}'
    + '.cb-launcher-badge.cb-badge-on{display:flex!important;}'
    + '@keyframes cb-badge-pop{from{transform:scale(0);}to{transform:scale(1);}}'
    + '#bot-launcher.cb-shake{animation:cb-shake 2s ease-in-out 0s 1;}'
    + '@keyframes cb-shake{0%,100%{transform:translateY(0) scale(1) translateX(0) rotate(0);}5%{transform:translateY(0) scale(1) translateX(-6px) rotate(-4deg);}10%{transform:translateY(0) scale(1) translateX(6px) rotate(4deg);}15%{transform:translateY(0) scale(1) translateX(-6px) rotate(-4deg);}20%{transform:translateY(0) scale(1) translateX(6px) rotate(4deg);}25%{transform:translateY(0) scale(1) translateX(-6px) rotate(-4deg);}30%{transform:translateY(0) scale(1) translateX(6px) rotate(4deg);}35%{transform:translateY(0) scale(1) translateX(-5px) rotate(-3deg);}40%{transform:translateY(0) scale(1) translateX(5px) rotate(3deg);}45%{transform:translateY(0) scale(1) translateX(-4px) rotate(-2deg);}50%{transform:translateY(0) scale(1) translateX(4px) rotate(2deg);}55%{transform:translateY(0) scale(1) translateX(-3px) rotate(-2deg);}60%{transform:translateY(0) scale(1) translateX(3px) rotate(2deg);}65%{transform:translateY(0) scale(1) translateX(-2px) rotate(-1deg);}70%{transform:translateY(0) scale(1) translateX(2px) rotate(1deg);}75%,100%{transform:translateY(0) scale(1) translateX(0) rotate(0);}}'
    + '.cb-teaser-bubble{position:fixed;bottom:66px;right:162px;z-index:2147483646;background:#fff;border:2px solid #0154B1;border-radius:18px 18px 18px 4px;box-shadow:0 12px 40px rgba(0,0,0,0.16);padding:12px 16px;max-width:270px;font-family:"Outfit",sans-serif;opacity:0;transform:translateX(10px) scale(.94);transition:opacity .3s,transform .3s;pointer-events:none;display:flex;align-items:center;gap:10px;box-sizing:border-box;}'
    + '.cb-teaser-bubble.cb-bv{opacity:1;transform:none;pointer-events:all;}'
    + '.cb-teaser-bubble.cb-bh{opacity:0;transform:translateX(10px) scale(.94);pointer-events:none;}'
    + '.cb-teaser-bubble p{font-size:14px;color:#222;margin:0;line-height:1.4;font-weight:600;flex:1;cursor:pointer;}'
    + '.cb-teaser-bubble .cb-bubble-av{width:38px;height:38px;border-radius:50%;object-fit:cover;flex-shrink:0;border:2px solid #fff;box-shadow:0 0 0 2px #0154B1;}'
    + '.cb-bubble-close{position:absolute;top:6px;right:8px;font-size:15px;color:#ccc;cursor:pointer;line-height:1;}'
    + '.cb-bubble-close:hover{color:#666;}'
    + '#cb-greeting-card{position:fixed;bottom:40px;right:40px;z-index:2147483647;background:#fff;border:2px solid #0154B1;border-radius:23px;box-shadow:0 23px 69px rgba(0,0,0,0.18);padding:21px 23px 23px;width:414px;font-family:"Outfit",sans-serif;opacity:0;transform:translateY(16px) scale(.95);transition:opacity .32s,transform .32s;pointer-events:none;box-sizing:border-box;}'
    + '#cb-greeting-card.cb-gv{opacity:1;transform:none;pointer-events:all;}'
    + '#cb-greeting-card.cb-gh{opacity:0;transform:translateY(16px) scale(.95);pointer-events:none;}'
    + '.cb-gc-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:16px;}'
    + '.cb-gc-av-wrap{position:relative;flex-shrink:0;}'
    + '.cb-gc-av-wrap img{width:61px;height:61px;border-radius:50%;object-fit:cover;display:block;}'
    + '.cb-gc-av-wrap::before{content:"";position:absolute;inset:-2px;border-radius:50%;background:linear-gradient(135deg,#0154B1,#4facfe);z-index:-1;}'
    + '.cb-gc-online{position:absolute;bottom:-1px;right:-1px;width:13px;height:13px;background:#22c55e;border-radius:50%;border:2px solid #fff;}'
    + '.cb-gc-name{font-size:17px;font-weight:700;color:#111;}'
    + '.cb-gc-time{font-size:13px;color:#9aa1ad;margin-top:1px;}'
    + '.cb-gc-close{margin-left:auto;font-size:27px;color:#bbb;cursor:pointer;line-height:1;padding:2px;}'
    + '.cb-gc-close:hover{color:#666;}'
    + '.cb-gc-question{font-size:17px;font-weight:600;color:#1a1d23;line-height:1.4;margin:0 0 16px;}'
    + '.cb-gc-yn{display:flex;gap:12px;margin-bottom:16px;}'
    + '.cb-gc-yn button{flex:1;background:#eaf3fe;color:#0154B1;border:none;padding:12px 0;border-radius:14px;font-size:15.5px;font-weight:600;cursor:pointer;font-family:"Outfit",sans-serif;transition:background .18s;}'
    + '.cb-gc-yn button:hover{background:#0154B1;color:#fff;}'
    + '.cb-gc-input{display:flex;align-items:center;border:1.5px solid #e7eaf0;border-radius:28px;padding:7px 7px 7px 18px;}'
    + '.cb-gc-input input{flex:1;border:none;outline:none;font-size:15.5px;font-family:"Outfit",sans-serif;color:#111;background:transparent;}'
    + '.cb-gc-input input::placeholder{color:#6b7078;}'
    + '.cb-gc-input button{width:37px;height:37px;border-radius:50%;background:#f0f3f8;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#0154B1;transition:background .18s;}'
    + '.cb-gc-input button:hover{background:#0154B1;color:#fff;}'
    + '#lead-bot{position:fixed;bottom:24px;right:24px;z-index:2147483646;padding:3px;border-radius:25px;background:transparent;box-shadow:0 32px 80px rgba(0,0,0,0.16);animation:cb-pop-in .35s cubic-bezier(.34,1.56,.64,1) both;}'
    + '#lead-bot::before{content:"";position:absolute;inset:0;border-radius:25px;padding:3px;background:linear-gradient(135deg,#0154B1,#4facfe,#7b5cff,#0154B1);background-size:300% 300%;animation:cb-border-flow 6s ease infinite;-webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);mask-composite:exclude;pointer-events:none;z-index:1;}'
    + '@keyframes cb-pop-in{from{opacity:0;transform:translateY(20px) scale(.96);}to{opacity:1;transform:none;}}'
    + '@keyframes cb-border-flow{0%{background-position:0% 50%;}50%{background-position:100% 50%;}100%{background-position:0% 50%;}}'
    + '.cb-card{width:360px;border-radius:22px;overflow:hidden;background:rgba(255,255,255,0.62);backdrop-filter:blur(8px) saturate(1.4);-webkit-backdrop-filter:blur(8px) saturate(1.4);box-shadow:0 6px 20px rgba(1,84,177,0.10),inset 0 1px 0 rgba(255,255,255,0.9);display:flex;flex-direction:column;max-height:calc(100vh - 65px);height:635px;font-family:"Outfit",sans-serif;box-sizing:border-box;}'
    + '.cb-card *{box-sizing:border-box;}'
    + '.cb-header{background:linear-gradient(135deg,#0154B1 0%,#0e58a3 100%);padding:14px 16px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;}'
    + '.cb-user{display:flex;gap:11px;align-items:center;}'
    + '.cb-avatar-wrap{position:relative;flex-shrink:0;}'
    + '.cb-avatar-wrap img{width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,.5);display:block;}'
    + '.cb-hdr-dot{position:absolute;bottom:1px;right:1px;width:10px;height:10px;background:#22c55e;border-radius:50%;border:2px solid #0154B1;}'
    + '.cb-ch-name{font-weight:700;color:#fff;font-size:14px;letter-spacing:.1px;}'
    + '.cb-ch-status{font-size:11px;color:rgba(255,255,255,.75);margin-top:2px;font-weight:400;display:flex;align-items:center;gap:4px;}'
    + '.cb-ch-status::before{content:"";display:inline-block;width:6px;height:6px;background:#22c55e;border-radius:50%;}'
    + '.cb-close-btn{cursor:pointer;font-size:23px;color:#fff;line-height:1;width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:50%;transition:background .15s,color .15s;user-select:none;border:none;background:transparent;padding:0;flex-shrink:0;}'
    + '.cb-close-btn:hover{background:rgba(255,255,255,.15);color:#fff;}'
    + '.cb-restart-btn{cursor:pointer;line-height:1;width:30px;height:30px;display:flex!important;align-items:center;justify-content:center;border-radius:50%;transition:background .15s;user-select:none;border:none;background:transparent;padding:0;flex-shrink:0;margin-right:2px;}'
    + '.cb-restart-btn:hover{background:rgba(255,255,255,.15);}'
    + '.cb-restart-btn svg{width:16px!important;height:16px!important;display:block!important;pointer-events:none;}'
    + '#cb-top-section{display:none;background:linear-gradient(135deg,#0154B1 0%,#0e58a3 100%);flex-shrink:0;}'
    + '.cb-top-row{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;}'
    + '#cb-welcome{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 24px 28px;background:transparent;flex:1;text-align:center;}'
    + '.cb-welcome-av-wrap{position:relative;display:inline-block;margin-bottom:14px;}'
    + '.cb-welcome-av{width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid #fff;box-shadow:0 0 0 3px #0154B1,0 8px 28px rgba(1,84,177,.18);}'
    + '.cb-welcome-dot{position:absolute;bottom:4px;right:4px;width:14px;height:14px;background:#22c55e;border-radius:50%;border:2.5px solid #fff;}'
    + '.cb-welcome-name{font-size:18px;font-weight:700;color:#111;margin-bottom:4px;}'
    + '.cb-welcome-role{font-size:12px;color:#888;margin-bottom:20px;}'
    + '.cb-welcome-fine{font-size:10.5px;color:#bbb;text-align:center;margin-top:10px;line-height:1.5;}'
    + '.cb-body-hidden{display:none!important;}'
    + '.cb-body{flex:1;overflow-y:auto!important;overflow-x:hidden!important;display:flex!important;flex-direction:column!important;gap:8px!important;padding:16px 14px 16px!important;min-height:150px!important;background:rgba(255,255,255,0.68)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,0.6)!important;scrollbar-width:thin;scrollbar-color:#dde1e9 transparent;}'
    + '.cb-body::-webkit-scrollbar{width:4px;}'
    + '.cb-body::-webkit-scrollbar-thumb{background:#dde1e9;border-radius:4px;}'
    + '@keyframes cb-msg-in{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:none;}}'
    + '.cb-bot-msg-wrap{display:flex!important;align-items:flex-end!important;gap:8px!important;max-width:88%!important;animation:cb-msg-in .25s ease both;}'
    + '.cb-bot-msg-wrap img{width:28px!important;height:28px!important;min-width:28px!important;max-width:28px!important;border-radius:50%!important;object-fit:cover!important;flex-shrink:0!important;border:2px solid #fff!important;display:block!important;align-self:flex-end!important;}'
    + '.cb-bot-msg{background:rgba(255,255,255,.88)!important;padding:10px 14px!important;border-radius:4px 18px 18px 18px!important;font-size:13.5px!important;color:#1e2024!important;line-height:1.65!important;box-shadow:0 2px 8px rgba(0,0,0,.06)!important;word-break:break-word!important;animation:cb-msg-in .25s ease both;}'
    + '.cb-user-msg{background:linear-gradient(135deg,#0154B1,#0e58a3)!important;color:#fff!important;padding:10px 16px!important;border-radius:18px 18px 4px 18px!important;align-self:flex-end!important;max-width:76%!important;font-size:13.5px!important;line-height:1.55!important;box-shadow:0 4px 14px rgba(1,84,177,.25)!important;display:block!important;word-break:break-word!important;animation:cb-msg-in .25s ease both;}'
    + '.cb-typing-wrap{display:flex!important;align-items:flex-end!important;gap:8px!important;max-width:88%!important;animation:cb-msg-in .2s ease both;}'
    + '.cb-typing-wrap img{width:28px!important;height:28px!important;min-width:28px!important;border-radius:50%!important;object-fit:cover!important;flex-shrink:0!important;border:2px solid #fff!important;display:block!important;align-self:flex-end!important;}'
    + '.cb-typing{display:flex;gap:5px;padding:12px 16px;align-items:center;background:rgba(255,255,255,.88);border-radius:4px 18px 18px 18px;box-shadow:0 2px 8px rgba(0,0,0,.06);}'
    + '.cb-typing span{width:7px;height:7px;background:#b0b8c8;border-radius:50%;animation:cb-blink 1.3s ease-in-out infinite;}'
    + '.cb-typing span:nth-child(2){animation-delay:.18s;}'
    + '.cb-typing span:nth-child(3){animation-delay:.36s;}'
    + '@keyframes cb-blink{0%,80%,100%{opacity:.3;transform:scale(.75);}40%{opacity:1;transform:scale(1);}}'
    + '.cb-qbtns,.cb-bbtns{display:flex!important;flex-direction:column!important;flex-wrap:nowrap!important;gap:8px!important;align-items:stretch!important;width:90%!important;margin-left:auto!important;margin-right:0!important;animation:cb-msg-in .3s ease both;}'
    + '.cb-grid{display:grid!important;grid-template-columns:1fr 1fr!important;grid-auto-rows:minmax(44px,1fr)!important;align-items:stretch!important;}'
    + '.cb-qbtns button,.cb-bbtns button{background:rgba(255,255,255,.88)!important;color:#0154B1!important;border:1.5px solid #d4e4f7!important;padding:7px 12px!important;border-radius:16px!important;cursor:pointer!important;font-size:13px!important;font-family:"Outfit",sans-serif!important;font-weight:500!important;display:flex!important;align-items:center!important;justify-content:center!important;text-align:center!important;width:100%!important;height:100%!important;min-height:44px!important;transition:all .18s!important;line-height:1.3!important;box-sizing:border-box!important;box-shadow:0 1px 4px rgba(0,0,0,.05)!important;}'
    + '.cb-qbtns button:hover,.cb-bbtns button:hover{background:#0154B1!important;color:#fff!important;border-color:#0154B1!important;box-shadow:0 4px 14px rgba(1,84,177,.22)!important;transform:translateY(-1px)!important;}'
    + '.cb-back-btn{background:rgba(255,255,255,.88)!important;color:#0154B1!important;border:1.5px solid #d4e4f7!important;padding:7px 12px!important;border-radius:16px!important;cursor:pointer!important;font-size:13px!important;font-family:"Outfit",sans-serif!important;font-weight:500!important;display:flex!important;align-items:center!important;justify-content:center!important;gap:6px!important;width:100%!important;height:100%!important;min-height:44px!important;transition:all .18s!important;line-height:1.3!important;box-sizing:border-box!important;}'
    + '.cb-back-btn:hover{background:#0154B1!important;color:#fff!important;border-color:#0154B1!important;box-shadow:0 4px 14px rgba(1,84,177,.22)!important;transform:translateY(-1px)!important;}'
    + '.cb-cta-btns{display:flex;flex-direction:column;gap:8px;animation:cb-msg-in .3s ease both;}'
    + '.cb-cta-btns button{border:none;padding:12px 16px;border-radius:20px;cursor:pointer;font-size:13.5px;font-weight:600;font-family:"Outfit",sans-serif;transition:all .2s;width:100%;text-align:center;}'
    + '.cb-cta-primary{background:linear-gradient(135deg,#F09300,#f5a623);color:#3d1f00;box-shadow:0 4px 14px rgba(240,147,0,.35);}'
    + '.cb-cta-primary:hover{filter:brightness(.93);transform:translateY(-1px);}'
    + '.cb-cta-secondary{background:#f0f6ff;color:#0154B1;border:1.5px solid #cce0f5;}'
    + '.cb-cta-secondary:hover{background:#0154B1;color:#fff;border-color:#0154B1;}'
    + '.cb-input-bar{display:none;align-items:center;gap:8px;padding:18px 12px 20px;border-top:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.45);flex-shrink:0;}'
    + '.cb-input-bar input{flex:1;border:1.5px solid rgba(255,255,255,.5);outline:none;border-radius:18px;padding:10px 16px;font-family:"Outfit",sans-serif;font-size:13.5px;color:#111827;background:rgba(255,255,255,.82);transition:border-color .2s,box-shadow .2s;}'
    + '.cb-input-bar input:focus{border-color:#0154B1;background:rgba(255,255,255,.95);box-shadow:0 0 0 3px rgba(1,84,177,.1);}'
    + '.cb-input-bar input::placeholder{color:#6b7078;}'
    + '.cb-input-bar input:disabled{background:rgba(230,232,236,.75);color:#8a8f99;cursor:not-allowed;}'
    + '.cb-input-bar button{width:38px!important;height:38px!important;min-width:38px!important;min-height:38px!important;border-radius:50%!important;background:linear-gradient(135deg,#0154B1,#1a7fe8)!important;color:#fff!important;border:none!important;cursor:pointer!important;display:flex!important;align-items:center!important;justify-content:center!important;flex-shrink:0!important;transition:all .2s;box-shadow:0 3px 10px rgba(1,84,177,.32)!important;opacity:1!important;visibility:visible!important;overflow:visible!important;padding:0!important;}'
    + '.cb-input-bar button:hover{transform:scale(1.08);}'
    + '.cb-input-bar button:active{transform:scale(.95);}'
    + '.cb-input-bar button:disabled{background:#c7ccd4!important;box-shadow:none!important;cursor:not-allowed!important;opacity:.6!important;transform:none!important;}'
    + '.cb-input-bar button:disabled:hover{transform:none!important;}'
    + '#cb-send svg{display:block!important;width:16px!important;height:16px!important;min-width:16px!important;min-height:16px!important;flex-shrink:0!important;opacity:1!important;visibility:visible!important;overflow:visible!important;fill:none!important;stroke:#fff!important;stroke-width:2.5!important;pointer-events:none!important;}'
    + '#cb-send svg *{stroke:#fff!important;fill:none!important;opacity:1!important;visibility:visible!important;display:inline!important;}'
    + '#lead-bot #cb-input-bar#cb-input-bar button#cb-send{width:38px!important;height:38px!important;min-width:38px!important;min-height:38px!important;border-radius:50%!important;background:linear-gradient(135deg,#0154B1,#1a7fe8)!important;border:none!important;display:flex!important;align-items:center!important;justify-content:center!important;opacity:1!important;visibility:visible!important;overflow:visible!important;color:#fff!important;}'
    /* Matches the triple-ID specificity of the rule above so a disabled send
     * button is actually visually distinct instead of being forced back to
     * opacity:1/full brand gradient by it — a plain .cb-input-bar
     * button:disabled rule loses to #lead-bot #cb-input-bar#cb-input-bar
     * button#cb-send on specificity regardless of source order. */
    + '#lead-bot #cb-input-bar#cb-input-bar button#cb-send:disabled{background:#c7ccd4!important;box-shadow:none!important;cursor:not-allowed!important;opacity:.6!important;}'
    + '#lead-bot #cb-input-bar#cb-input-bar button#cb-send svg#cb-send-icon{display:block!important;width:16px!important;height:16px!important;min-width:16px!important;min-height:16px!important;fill:none!important;stroke:#ffffff!important;stroke-width:2.5!important;opacity:1!important;visibility:visible!important;overflow:visible!important;color:#ffffff!important;}'
    + '#lead-bot #cb-input-bar#cb-input-bar button#cb-send svg#cb-send-icon *{stroke:#ffffff!important;fill:none!important;opacity:1!important;visibility:visible!important;display:inline!important;}'
    + '.cb-schedule-wrap{display:none;flex-shrink:0;}'
    + '.cb-schedule{display:flex!important;align-items:center;justify-content:center;text-align:center;background:linear-gradient(135deg,#F09300,#f5a623);color:#fff!important;font-weight:700;font-size:13.5px;font-family:"Outfit",sans-serif;text-decoration:none!important;padding:16px 16px;letter-spacing:.2px;transition:filter .2s;width:100%;box-sizing:border-box;}'
    + '.cb-schedule:hover{filter:brightness(.92);}'
    + '#cb-backdrop{position:fixed;inset:0;background:rgba(10,20,40,0.45);z-index:2147483645;opacity:0;pointer-events:none;transition:opacity .25s ease;display:none;}'
    + '#cb-backdrop.cb-backdrop-on{opacity:1;pointer-events:all;}'
    /* Mac-only desktop sizing: gated on html.cb-is-mac (real OS detection,
     * see IS_MAC above), never on screen width — a Windows desktop at the
     * exact same resolution as a MacBook must keep the original 360x635
     * size untouched. Scoped further by min-width so it only enlarges on
     * a MacBook's own larger screens, not on small external displays a
     * Mac might be connected to. */
    + 'html.cb-is-mac .cb-card{width:420px;height:760px;}'
    + '@media (min-width:1440px){html.cb-is-mac .cb-card{width:460px;height:820px;}}'
    + '@media (min-width:1920px){html.cb-is-mac .cb-card{width:500px;height:880px;}}'
    /* width/height use !important specifically so this mobile override
     * always wins regardless of selector specificity or OS — without it,
     * the html.cb-is-mac Mac-only rules above (which have higher
     * specificity than a plain .cb-card selector) would incorrectly win
     * on a Mac browser resized down to mobile width (e.g. responsive
     * testing), keeping the larger Mac desktop size instead of collapsing
     * to the intended full-screen mobile layout. */
    /* Mobile only: the decorative animated gradient ring (#lead-bot::before)
     * keeps its rounded 25px radius from the desktop rule unless explicitly
     * reset here — on mobile that produces a visibly rounded glowing border
     * around an otherwise edge-to-edge square widget, and clips/overlaps
     * the bottom CTA bar's corners. Squaring it off (border-radius:0) keeps
     * the same glow/colors/animation, just following the widget's actual
     * sharp mobile corners instead of fighting them. */
    + '@media (max-width:768px){#cb-backdrop{display:block;}#lead-bot{top:0;bottom:0;right:0;left:0;width:100%;animation:none;display:flex;align-items:stretch;justify-content:stretch;padding:0;background:none;box-shadow:none;border-radius:0;}#lead-bot::before{border-radius:0;}.cb-card{width:100%!important;height:100%!important;max-height:none!important;border-radius:0;overflow:hidden;border:none;}.cb-body{flex:1 1 auto!important;max-height:none!important;min-height:0!important;}.cb-qbtns button,.cb-bbtns button{font-size:13.5px!important;padding:11px 12px!important;min-height:48px!important;}.cb-input-bar{padding:12px!important;}.cb-input-bar input{font-size:15px;box-sizing:border-box;padding:12px 16px;}#cb-greeting-bubble{right:88px;bottom:16px;max-width:calc(100vw - 170px);}#cb-greeting-card{right:8px;left:8px;width:auto;bottom:16px;}#bot-launcher{bottom:16px;right:16px;width:60px;height:60px;z-index:2147483646;}#bot-launcher img{width:54px;height:54px;}.cb-online-dot{bottom:2px;right:2px;width:12px;height:12px;}.cb-launcher-badge{width:16px;height:16px;font-size:9px;top:0;right:0;}}';
    /* Dark mode intentionally NOT implemented: the widget must always render
     * in its light theme regardless of OS/browser color-scheme preference —
     * a @media (prefers-color-scheme:dark) block previously mirrored the
     * host's dark-mode setting here; removed by design so visitors on a
     * dark system theme still see the light card. */

  function injectStyles() {
    if (!document.getElementById('cb-font-link')) {
      var link = document.createElement('link');
      link.id = 'cb-font-link';
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap';
      document.head.appendChild(link);
    }
    var style = document.createElement('style');
    style.id = 'cb-widget-styles';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  /* ── DOM BUILD ── */
  function buildDOM() {
    var backdrop = document.createElement('div');
    backdrop.id = 'cb-backdrop';
    document.body.appendChild(backdrop);

    var launcher = document.createElement('div');
    launcher.id = 'bot-launcher';
    launcher.style.display = 'none';
    /* Keyboard/AT accessibility: this div is the ONLY way to open the widget
     * once the teaser has been dismissed or timed out, so it must be reachable
     * and operable without a mouse (WCAG 2.1.1). role+tabindex put it in the
     * tab order and expose it as a button to screen readers; the keydown
     * handler (wired below, alongside launcherClick) makes Enter/Space
     * activate it the same way a native <button> would. */
    launcher.setAttribute('role', 'button');
    launcher.setAttribute('tabindex', '0');
    launcher.setAttribute('aria-label', 'Open chat with ' + BOT_NAME);
    launcher.innerHTML =
      '<img src="' + AVATAR_URL + '" alt="' + BOT_NAME + '" onerror="this.src=\'' + AVATAR_FB + '\'" />' +
      '<span class="cb-online-dot"></span>' +
      '<span class="cb-launcher-badge" id="cb-launcher-badge">1</span>';
    document.body.appendChild(launcher);

    var win = document.createElement('div');
    win.id = 'lead-bot';
    win.style.display = 'none';
    win.innerHTML =
      '<div class="cb-card">' +
        '<div class="cb-header" id="cb-header">' +
          '<div class="cb-user">' +
            '<div class="cb-avatar-wrap">' +
              '<img src="' + AVATAR_URL + '" alt="' + BOT_NAME + '" onerror="this.src=\'' + AVATAR_FB + '\'" />' +
              '<span class="cb-hdr-dot"></span>' +
            '</div>' +
            '<div><div class="cb-ch-name">' + BOT_NAME + '</div><div class="cb-ch-status">' + BOT_TITLE + '</div></div>' +
          '</div>' +
          '<div style="display:flex!important;align-items:center;">' +
            '<button class="cb-restart-btn" id="cb-restart-compact" aria-label="Start new conversation" title="Start new conversation">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>' +
            '</button>' +
            '<button class="cb-close-btn" id="cb-close-compact" aria-label="Close chat">&#x00D7;</button>' +
          '</div>' +
        '</div>' +
        '<div id="cb-top-section">' +
          '<div class="cb-top-row">' +
            '<div class="cb-user">' +
              '<div class="cb-avatar-wrap">' +
                '<img src="' + AVATAR_URL + '" alt="' + BOT_NAME + '" onerror="this.src=\'' + AVATAR_FB + '\'" />' +
                '<span class="cb-hdr-dot"></span>' +
              '</div>' +
              '<div><div class="cb-ch-name">' + BOT_NAME + '</div><div class="cb-ch-status">' + BOT_TITLE + '</div></div>' +
            '</div>' +
            '<div style="display:flex!important;align-items:center;">' +
              '<button class="cb-restart-btn" id="cb-restart-expanded" aria-label="Start new conversation" title="Start new conversation">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>' +
              '</button>' +
              '<button class="cb-close-btn" id="cb-close-expanded" aria-label="Close chat">&#x00D7;</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div id="cb-welcome">' +
          '<div class="cb-welcome-av-wrap">' +
            '<img src="' + AVATAR_URL + '" alt="' + BOT_NAME + '" class="cb-welcome-av" onerror="this.src=\'' + AVATAR_FB + '\'" />' +
            '<span class="cb-welcome-dot"></span>' +
          '</div>' +
          '<div class="cb-welcome-name">' + BOT_NAME + '</div>' +
          '<div class="cb-welcome-role">Customer Success &middot; ' + BOT_TITLE + '</div>' +
          '<p class="cb-welcome-fine">By using this chat, you agree to our terms and privacy policy.</p>' +
        '</div>' +
        '<div id="cb-messages" class="cb-body cb-body-hidden">' +
          '<div style="display:flex!important;align-items:flex-end!important;gap:8px!important;max-width:88%!important;">' +
            '<img src="' + AVATAR_URL + '" style="' + AV_STYLE + '" alt="" onerror="this.src=\'' + AVATAR_FB + '\'" />' +
            '<div class="cb-bot-msg" style="flex:1!important;">Hello! What kind of project do you need help bringing to life?</div>' +
          '</div>' +
          '<div id="cb-step1" class="cb-qbtns cb-grid">' +
            '<button data-step1="New startup or app idea">New startup or app idea</button>' +
            '<button data-step1="Software for my business">Software for my business</button>' +
            '<button data-step1="Digital marketing help">Digital marketing help</button>' +
            '<button data-step1="Just exploring">Just exploring</button>' +
          '</div>' +
        '</div>' +
        '<div class="cb-input-bar" id="cb-input-bar" style="display:flex!important;align-items:center;gap:8px;padding:18px 12px 20px;border-top:1px solid rgba(255,255,255,0.3);background:rgba(255,255,255,0.45);flex-shrink:0;">' +
          '<input type="text" id="cb-input" placeholder="Type your answer..." autocomplete="off" />' +
          '<button id="cb-send" aria-label="Send">' +
            '<svg id="cb-send-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:block!important;opacity:1!important;visibility:visible!important;">' +
              '<line x1="12" y1="19" x2="12" y2="5" style="stroke:#fff!important;opacity:1!important;"/><polyline points="5 12 12 5 19 12" style="stroke:#fff!important;opacity:1!important;"/>' +
            '</svg>' +
          '</button>' +
        '</div>' +
        '<div class="cb-schedule-wrap" id="cb-schedule-wrap" style="display:none!important;">' +
          '<a href="' + CALENDLY_URL + '" target="_blank" rel="noopener" class="cb-schedule" id="cb-schedule-bar">Schedule a Free Consultation</a>' +
        '</div>' +
      '</div>';
    document.body.appendChild(win);

    return { launcher: launcher, win: win };
  }

  /* ── MAIN ── */
  function init() {
    injectStyles();
    buildDOM();

    var msgs     = document.getElementById('cb-messages');
    var inputEl  = document.getElementById('cb-input');
    var inputBar = document.getElementById('cb-input-bar');
    var schedBar = document.getElementById('cb-schedule-wrap');

    /* Gated schedule bar (Andrew's feedback): this used to navigate
     * straight to Google Calendar no matter what, so a visitor could book
     * a meeting without ever becoming a lead — no email, no Zapier/CRM
     * record, no ad attribution (Google's booking page can't carry gclid/
     * UTM and our tags don't run there). Now:
     *  - name+email already captured → let the native new-tab navigation
     *    proceed, and submit the lead right here so a booking can never
     *    outrun the CRM record (submitLead is idempotent via its own
     *    leadSubmitted guard, so a later CTA click won't double-send);
     *  - otherwise → cancel the navigation and route into the existing
     *    contact-capture flow. The calendar then opens from the final
     *    "Book a Google Meet" button's own click — a real user gesture,
     *    so Safari/iOS popup blocking (see trackScheduleClick's comment)
     *    never comes into play on that later open. */
    var schedLink = document.getElementById('cb-schedule-bar');
    if (schedLink) schedLink.addEventListener('click', function (e) {
      trackScheduleClick();
      if (lead.name && lead.email) { submitLead(); return; }
      e.preventDefault();
      cancelTeaserFlow();
      cancelPendingMcqReveal();
      /* Drop any question buttons from the step we're jumping away from so
       * a stale option can't be clicked into the wrong step later. */
      var stale = msgs.querySelectorAll('.cb-qbtns, .cb-bbtns');
      for (var i = 0; i < stale.length; i++) stale[i].remove();
      addUserMsg('Schedule a Free Consultation');
      if (scheduleGatePending) { inputEl.focus(); return; }
      scheduleGatePending = true;
      goToContactStep("Happy to get you booked! Let me grab a couple quick details first so we can confirm your meeting.");
    });

    /* AI conversation history — used whenever the user types free text
     * instead of clicking a scripted button. */
    var chatHistory = [];

    /* Snapshot of every rendered message bubble, in order, purely for
     * replaying the transcript visually after a refresh — separate from
     * chatHistory (which only holds the role/content pairs sent to
     * OpenAI) since it also needs to know bot vs. user for rendering. */
    var transcript = [];

    function saveSession() {
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify({
          step: step,
          lead: lead,
          tentativeHints: tentativeHints,
          contactFlowTone: contactFlowTone,
          chatHistory: chatHistory,
          transcript: transcript,
          conversationStarted: conversationStarted,
          savedAt: Date.now()
        }));
      } catch (e) { /* localStorage unavailable (private mode, quota) — degrade silently, in-memory state still works for this page load */ }
      /* Separate, long-lived record purely for the teaser bubble's copy on
       * a FUTURE visit ("still thinking about X?") — independent of
       * cb_session_v1 itself (which expires in 4h and drives actual
       * conversation resumption, untouched by this). Only written once the
       * visitor is at least one level into a real answer, not on every
       * button click. */
      if (lead.intent_detail) saveTeaserMemory({ lastTopic: lead.intent_detail, topicSavedAt: Date.now() });
    }

    /* Sessions older than this are treated as abandoned/stale rather than
     * resumed — avoids resurrecting a days-old half-finished conversation
     * for a returning visitor who'd rather start fresh. */
    var SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours

    function loadSession() {
      try {
        var raw = localStorage.getItem(SESSION_KEY);
        if (!raw) return null;
        var parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        if (!parsed.savedAt || Date.now() - parsed.savedAt > SESSION_MAX_AGE_MS) {
          localStorage.removeItem(SESSION_KEY);
          return null;
        }
        return parsed;
      } catch (e) { return null; }
    }

    function clearSession() {
      try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
    }

    /* Replays a saved session's transcript into the message thread (hidden
     * behind the still-closed panel) and restores step/lead/chatHistory/
     * conversationStarted, so a refreshed page picks up exactly where the
     * visitor left off instead of starting over — without forcing the chat
     * panel open on its own. conversationStarted being restored to true is
     * what makes the next launcherClick() skip the teaser and go straight
     * to toggleBot(), which opens the now-already-populated panel. Does
     * NOT re-trigger botReply for the in-progress question (that text is
     * already the last replayed bot bubble) — it only re-renders that
     * step's button group so the visitor can keep going once they reopen. */
    function restoreSession() {
      var session = loadSession();
      if (!session || !session.transcript || session.transcript.length === 0) return false;

      isReplayingSession = true;
      session.transcript.forEach(function (entry) {
        if (entry.role === 'bot') addBotMsg(entry.html);
        else if (entry.role === 'user') addUserMsg(entry.text);
      });
      isReplayingSession = false;

      chatHistory = session.chatHistory || [];
      Object.assign(lead, session.lead || {});
      Object.assign(tentativeHints, session.tentativeHints || {});
      contactFlowTone = session.contactFlowTone === 'soft' ? 'soft' : 'default';
      step = typeof session.step === 'number' ? session.step : step;
      conversationStarted = !!session.conversationStarted;
      transcript = session.transcript;

      if (step >= 1) expandUI();

      var noFollowUpWasOpen = session.transcript.some(function (e) {
        return e.role === 'bot' && /feels harder than it should be/i.test(e.html || '');
      });
      if (noFollowUpWasOpen && step === 0) {
        renderNoFollowUpButtons();
      } else if (step === 1) {
        showIntentOptions(lead.intent);
      } else if (step === 0) {
        renderStep0Buttons();
      }
      /* Steps 2+ (budget/notes/contact/final) intentionally don't
       * re-render their own button group here — those steps' own botReply
       * text is already the last replayed message, and re-invoking them
       * would re-ask the question a second time. The visitor can just
       * type their answer; handleInput() resumes from the restored step
       * exactly like a live conversation would. */

      document.getElementById('cb-welcome').style.display = 'none';
      msgs.classList.remove('cb-body-hidden');
      showScheduleBar();
      return true;
    }

    /* Guards against duplicate/concurrent AI calls (e.g. a double-click or
     * double-tap on send firing handleInput twice before the first request
     * resolves), which otherwise stacks near-identical AI replies. */
    var aiRequestInFlight = false;
    var handleInputInFlight = false;
    var ctaHandled = false;

    /* Delays a qualification step's button group (step-0 re-render, intent
     * sub-options, budget) by a beat after its question text lands, instead
     * of dropping a wall of choices on the visitor the instant they finish
     * reading (or typing). Buttons stay a quick-pick assist, not the
     * default interaction. The token counter invalidates any earlier
     * pending reveal the moment a newer one is scheduled (e.g. the user
     * advanced past this step before the timer fired), and
     * cancelPendingMcqReveal (called at the top of handleInput) invalidates
     * it the instant the visitor starts typing instead of clicking, so a
     * button group never pops in on top of, or right after, an answer
     * they've already given. */
    var mcqRevealTimer = null;
    var mcqRevealToken = 0;
    /* See cancelTeaserFlow — tracks openFromTeaser's "Yes" branch's own
     * greeting botReply so a fast follow-up message can preempt it instead
     * of it firing later and duplicating the greeting. */
    var pendingGreetingTimer = null;
    var MCQ_REVEAL_DELAY = 900;
    function scheduleMcqReveal(renderFn) {
      clearTimeout(mcqRevealTimer);
      var token = ++mcqRevealToken;
      mcqRevealTimer = setTimeout(function () {
        if (token !== mcqRevealToken) return;
        renderFn();
      }, MCQ_REVEAL_DELAY);
    }
    function cancelPendingMcqReveal() {
      clearTimeout(mcqRevealTimer);
      mcqRevealToken++;
    }

    /* Derive API endpoint from widget.js src — same origin as the widget,
     * unless data-api-base points it at a separate host (see
     * API_BASE_OVERRIDE above). */
    var API_URL = (function () {
      if (API_BASE_OVERRIDE) return API_BASE_OVERRIDE + '/api/chat';
      try {
        var base = new URL(SCRIPT_EL.src, location.href).href.replace(/\/[^/]*$/, '/');
        return base + 'api/chat';
      } catch (e) {
        return '/api/chat';
      }
    })();

    function scroll() { msgs.scrollTop = msgs.scrollHeight; }

    /* Scrolls so the most recent bot question stays visible at the top of
     * the panel instead of being pushed off-screen by its own button group
     * (button rows can be taller than the remaining scroll viewport). */
    function scrollToLatestBotMsg() {
      var wraps = msgs.querySelectorAll('.cb-bot-msg-wrap');
      var last = wraps[wraps.length - 1];
      if (last) { msgs.scrollTop = last.offsetTop - 8; } else { scroll(); }
    }

    function avImg() {
      return '<img src="' + AVATAR_URL + '" style="' + AV_STYLE + '" alt="" onerror="this.src=\'' + AVATAR_FB + '\'" />';
    }

/* Removes the previous bot bubble if it has the exact same text, so a
     * message firing twice (e.g. a race between the AI response and a
     * reminder/auto-open) replaces the old one instead of stacking a
     * duplicate. Reads the DOM directly so it also catches bubbles built
     * by other code paths (like the idle reminder), not just addBotMsg. */
    /* Bot message text (AI replies, knowledge-base content, hardcoded
     * strings) is NEVER passed through innerHTML or any other HTML-parsing
     * API. buildBotMsgBubble below builds the message bubble entirely with
     * DOM APIs (createElement/createTextNode), splitting only on '\n' to
     * insert real <br> elements between text nodes. A payload like
     * <script>, <img onerror=...>, <svg onload=...>, or <iframe src=
     * "javascript:..."> coming back from the model (e.g. echoed/quoted
     * user input) is therefore inserted as literal, inert text — it is
     * never parsed as markup in the first place, so there's no escaping
     * step to forget or get wrong. */
    function buildBotMsgBubble(text) {
      var bubble = document.createElement('div');
      bubble.className = 'cb-bot-msg';
      bubble.setAttribute('style', BOT_STYLE);
      var lines = String(text == null ? '' : text).split('\n');
      lines.forEach(function (line, i) {
        if (i > 0) bubble.appendChild(document.createElement('br'));
        if (line) bubble.appendChild(document.createTextNode(line));
      });
      return bubble;
    }

    function dedupeLastBotMsg(text) {
      var wraps = msgs.querySelectorAll('.cb-bot-msg-wrap');
      var last = wraps[wraps.length - 1];
      var lastBubble = last && last.querySelector('.cb-bot-msg');
      if (lastBubble && lastBubble.textContent === String(text == null ? '' : text)) last.remove();
    }

    var isReplayingSession = false;

    function addBotMsg(text) {
      dedupeLastBotMsg(text);
      var w = document.createElement('div');
      w.className = 'cb-bot-msg-wrap';
      w.setAttribute('style', WRAP_STYLE);
      var av = document.createElement('img');
      av.src = AVATAR_URL;
      av.alt = '';
      av.setAttribute('style', AV_STYLE);
      av.onerror = function () { av.onerror = null; av.src = AVATAR_FB; };
      w.appendChild(av);
      w.appendChild(buildBotMsgBubble(text));
      msgs.appendChild(w); scroll();
      if (!isReplayingSession) { transcript.push({ role: 'bot', html: text }); saveSession(); }
    }

    /* Appends a resume-the-flow line to the LAST bot bubble (the AI's own
     * answer, just rendered by askAI) instead of opening a new, separate
     * bubble via botReply(). A detour answer followed by an unrelated
     * second message in its own bubble is exactly the "feels like a form
     * bolted onto a chatbot" pattern this exists to avoid — one consultant
     * voice continuing their own sentence reads naturally; two disconnected
     * messages stacked on top of each other do not. Always merges into the
     * same bubble, even when the AI's own reply already ends in a question
     * mark: an earlier version bailed out here and let the caller fall back
     * to a second, separate botReply() bubble instead, which is exactly the
     * "two questions back to back" stacking bug this function exists to
     * prevent, just moved one level up. One bubble with two sentences reads
     * as a single consultant continuing their thought; two bubbles in a row
     * read as the bot ignoring what was just said. Keeps chatHistory/
     * transcript in sync with what's now visually shown, since both were
     * already seeded with the AI's original (un-appended) reply by askAI
     * just before this runs. */
    function appendResumeLineToLastBotMsg(aiReply, resumeLine) {
      var wraps = msgs.querySelectorAll('.cb-bot-msg-wrap');
      var last = wraps[wraps.length - 1];
      var lastBubble = last && last.querySelector('.cb-bot-msg');
      if (!lastBubble) return false;
      lastBubble.appendChild(document.createElement('br'));
      lastBubble.appendChild(document.createElement('br'));
      lastBubble.appendChild(document.createTextNode(resumeLine));
      scroll();
      var combined = (aiReply || '') + '\n\n' + resumeLine;
      if (!isReplayingSession) {
        if (chatHistory.length && chatHistory[chatHistory.length - 1].role === 'assistant') {
          chatHistory[chatHistory.length - 1].content = combined;
        }
        if (transcript.length && transcript[transcript.length - 1].role === 'bot') {
          transcript[transcript.length - 1].html = combined;
        }
        saveSession();
      }
      return true;
    }

    function addUserMsg(text) {
      cancelTeaserFlow();
      conversationStarted = true;
      var d = document.createElement('div');
      d.setAttribute('style', USER_STYLE);
      d.className = 'cb-user-msg';
      d.textContent = text;
      msgs.appendChild(d); scroll();
      if (!isReplayingSession) { transcript.push({ role: 'user', text: text }); saveSession(); }
    }

    /* Inserts the teaser greeting question + the user's Yes/No reply at the very
     * top of the thread (before the static "Hello! What kind of project..."
     * block), so the greeting card's question reads first when opened via Yes/No. */
    function prependGreetingExchange(answer) {
      /* The static "Hello! What kind of project..." + MCQ block is redundant
       * once the teaser's own Yes/No question has already been answered —
       * remove it so it doesn't sit between the greeting exchange and the
       * follow-up reply. */
      var staticIntro = msgs.firstChild;
      if (staticIntro) staticIntro.remove();
      var s1 = document.getElementById('cb-step1');
      if (s1) s1.remove();

      var q = document.createElement('div');
      q.className = 'cb-bot-msg-wrap';
      q.setAttribute('style', WRAP_STYLE);
      q.innerHTML = avImg() + '<div class="cb-bot-msg" style="' + BOT_STYLE + '">Are you currently exploring custom software or app development for your business?</div>';
      msgs.insertBefore(q, msgs.firstChild);

      var a = document.createElement('div');
      a.setAttribute('style', USER_STYLE);
      a.className = 'cb-user-msg';
      a.textContent = answer;
      msgs.insertBefore(a, q.nextSibling);
      scroll();
    }

    function showTyping() {
      var w = document.createElement('div');
      w.className = 'cb-typing-wrap'; w.id = 'cb-typing';
      w.setAttribute('style', WRAP_STYLE);
      w.innerHTML = avImg() + '<div class="cb-typing"><span></span><span></span><span></span></div>';
      msgs.appendChild(w); scroll();
    }
    function hideTyping() { var t = document.getElementById('cb-typing'); if (t) t.remove(); }

    function botReply(msg, cb, delay) {
      showTyping();
      return setTimeout(function () {
        hideTyping();
        addBotMsg(msg);
        if (cb) cb();
      }, delay || 1200);
    }

    function makeBackBtn(label, onClick) {
      var b = document.createElement('button');
      b.className = 'cb-back-btn';
      b.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0154B1" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;display:block;">' +
        '<polyline points="15 18 9 12 15 6"/></svg><span>' + label + '</span>';
      b.onclick = onClick;
      return b;
    }

    /* Does this message actually look like an attempt to provide a phone
     * number, rather than a conversational aside ("I have one doubt",
     * "Wait", "Can I ask something first?")? Keyword-denylisting every
     * possible way someone might phrase a detour (isOffTopic's approach)
     * is inherently incomplete — the next unanticipated phrasing slips
     * through and hits the same false "invalid phone number" bug. Instead,
     * require the message to be digit-dominant before treating it as a
     * phone attempt at all: digits must make up at least half of its
     * non-space characters. This deliberately does NOT require a minimum
     * digit count — "123" is digit-dominant and short, so it's correctly
     * treated as a (invalid) phone attempt and still gets the real
     * validation-rejection message, while "I have 1 doubt" is mostly
     * letters despite containing a digit, so it's correctly treated as a
     * conversational detour instead. The actual length check (>= 7
     * digits) still happens in the real validation step below — this
     * function only decides whether to validate at all. */
    function looksLikePhoneAttempt(v) {
      var trimmed = v.trim();
      if (!trimmed) return false;
      var digitCount = (trimmed.match(/\d/g) || []).length;
      if (digitCount === 0) return false;
      var nonSpaceLen = trimmed.replace(/\s/g, '').length;
      return digitCount / nonSpaceLen >= 0.5;
    }

    /* Same idea for email: a real attempt either contains '@', or is a
     * single word with no spaces at all (covers garbled/typo'd attempts
     * like "not-an-email" or "akashgmailcom" with the @ missing or
     * mistyped). Genuine conversational detours ("Can I ask something
     * first?", "What services do you offer?") are essentially always
     * multiple words, so a single bare token is far more likely to be a
     * bad email attempt than real conversation — a one-word detour like
     * "Wait" is rare enough, and ambiguous enough on its own, that
     * treating it as a (failed) email attempt and asking the user to
     * double-check is an acceptable tradeoff for reliably catching
     * malformed email attempts instead. */
    function looksLikeEmailAttempt(v) {
      var trimmed = v.trim();
      if (trimmed.indexOf('@') > -1) return true;
      return trimmed.length > 0 && trimmed.indexOf(' ') === -1;
    }

    /* Detects an explicit "I don't want to give that out" (or a hostile
     * dismissal) on the name/phone/email steps — checked BEFORE the
     * AI-detour branch so a refusal short-circuits straight to skipping/
     * advancing the field instead of ever reaching the AI blind (the AI
     * call on that detour branch has no idea a name/phone/email question
     * is even open — no stepContext is sent on that path — so it free-
     * associates a generic reply and the widget then re-asks the same
     * question on top of it, visibly ignoring the refusal).
     *
     * v1 of this function was a flat phrase list ("don't want to give",
     * "don't want to share", "don't want to tell", ...) and missed "I
     * don't want to MENTION it" outright — any verb not hand-typed into the
     * list slips through with zero warning, and there's always another verb
     * (mention, disclose, provide, hand over, ...) nobody thought to add.
     * Replaced with a negation + disclosure-verb PATTERN so new phrasing of
     * the same intent is caught automatically instead of needing its own
     * list entry every time QA finds another gap. can't/cannot are
     * deliberately excluded from the negation side: those show up
     * constantly in ordinary questions to the bot ("can't you just tell me
     * a price range?") that are not self-refusals, and pairing them with a
     * disclosure verb produced false positives in testing. */
    function looksLikeContactRefusal(v) {
      /* iOS/macOS (and many keyboards) auto-convert a typed straight
       * apostrophe into a curly one (U+2019) as you type — "don't" the user
       * actually sends can be "don’t", which none of the `'?`-based
       * regexes below would match. Normalizing both curly quote characters
       * to a plain ASCII apostrophe up front means every check after this
       * line doesn't need its own Unicode-aware variant. */
      var lower = v.trim().toLowerCase().replace(/[‘’]/g, "'").replace(/[.!?]+$/, '');

      // Exact whole-message refusals/hostility — only fires on an exact
      // match so short common words ("no", "skip") don't trip on every
      // message that happens to contain them as part of an unrelated word.
      var exactPhrases = [
        'no', 'nope', 'nah', 'not telling', 'no thanks', 'rather not',
        'prefer not to say', 'anonymous', 'not comfortable sharing',
        'i won\'t', 'i wont', 'won\'t', 'wont', 'i refuse', 'refuse',
        'never', 'no way', 'not happening', 'absolutely not',
      ];
      if (exactPhrases.indexOf(lower) > -1) return true;

      /* Same refusal/hostility vocabulary, but matched as a whole word or
       * phrase ANYWHERE in the message (word-boundary regex, not naive
       * substring — plain .indexOf() would also match "no" inside "Reno"
       * or "skip" inside "skipper"). Covers a refusal embedded in a fuller
       * sentence ("nah, I'd rather skip that one", "ugh, just stop asking
       * me this") rather than only a bare one-word reply. Hostile/dismissive
       * non-answers are included here too — they must never fall through
       * to isValidName/looksLikePhoneAttempt and get accepted as the
       * literal value (the "Nice to meet you, shut up!" bug). */
      var boundaryPhrases = /\b(skip|pass|whatever|forget it|stop asking|stop it|go away|leave me alone|none of your business|mind your own business|who cares|shut up|get lost|piss off|screw off)\b/;
      if (boundaryPhrases.test(lower)) return true;

      /* Negation + disclosure-verb pattern: catches "I don't want to
       * GIVE/SHARE/TELL/MENTION/PROVIDE/DISCLOSE/REVEAL/SAY ..." in any
       * wording. Both halves must be present so an unrelated sentence that
       * only contains one half ("can you tell me about pricing" — verb, no
       * negation) never matches. can't/cannot are deliberately excluded
       * from the negation side: those show up constantly in ordinary
       * questions to the bot ("can't you just tell me a price range?")
       * that are not self-refusals, and pairing them with a disclosure
       * verb produced false positives in testing. */
      var negation = /\b(don'?t want to|dont want to|won'?t|will not|do not want to|not going to|not comfortable|rather not|prefer not)\b/;
      /* Word stems + \w* rather than exact verbs, so inflections (sharing,
       * shared, telling, told, mentioned, ...) match without listing every
       * form by hand — \w* allows zero-or-more trailing letters, so the
       * bare stem itself still matches too (give/give\w*, tell/tell\w*).
       * gave/told/said are irregular past tenses and listed separately
       * since they don't share a stem with their present-tense form. */
      var disclosureVerb = /\b(giv\w*|gave|shar\w*|tell\w*|told|mention\w*|provid\w*|disclos\w*|say\w*|said|reveal\w*|hand over|handing over|handed over)\b/;
      if (negation.test(lower) && disclosureVerb.test(lower)) return true;

      /* Bare "not" + the GERUND form specifically ("not telling", "not
       * giving", "not sharing", "not mentioning", ...) — narrower than
       * broadening the negation set above to bare "not" + any base verb,
       * which would false-flag ordinary sentences like "I'm not sure, can
       * you tell me more" (bare "not" elsewhere in the sentence + "tell"
       * used for an unrelated ask). The gerund-right-after-"not" shape is
       * specific enough to "I am not [verb]-ing this" that it doesn't share
       * that false-positive risk. */
      if (/\bnot\s+\w*\s*(telling|giving|sharing|mentioning|providing|disclosing|saying|revealing|handing over)\b/.test(lower)) return true;

      /* "I don't have a phone/email/mail" or bare "no phone"/"no email" —
       * the same "this contact method doesn't exist for me" shape regardless
       * of which field is being asked about. Previously hardcoded to phone
       * only ("don't have a phone"), which is exactly why the email step's
       * identical phrasing ("I don't have any mail", "I don't have an
       * email", "no email") fell through this entire function with no
       * match: the detour went straight to the AI instead, which classified
       * "I don't have any mail" as a normal (non-refused) turn in QA, so the
       * email-still-open resume line got appended right after a reply that
       * had already conceded "we'll use phone instead" — two contradictory
       * sentences in one bubble. Generalized once across phone/number/email/
       * mail (mirrors isValidName's own "no name" gap-fix for the name
       * field) so this is caught locally, with zero dependency on the AI's
       * per-turn judgment call, on every contact step. */
      /* Article is OPTIONAL ("have\s*(a|an|any)?\s*") — "I don't have
       * email"/"i dont have phone" (no article at all) is at least as
       * common as "I don't have an email" in real typed input, and a
       * mandatory article here was the exact gap that let "sorry but i
       * dont have email" fall through Layer 1 and into the AI-only path
       * during QA, re-triggering the same contradictory-resume-line bug
       * for a phrasing one step short of what the first fix covered. */
      if (/\bdon'?t have\s*(a|an|any)?\s*(phone|number|email|e-?mail|mail)\b/.test(lower)) return true;
      if (/\bno\s+(phone|number|email|e-?mail|mail)\b/.test(lower)) return true;
      var substrings = ["i'd rather not", 'id rather not'];
      return substrings.some(function (k) { return lower.indexOf(k) > -1; });
    }

    /* Layer 1 (fast, local, zero AI latency) of the exit-signal detector —
     * mirrors looksLikeContactRefusal's own two-tier shape (exact bare
     * phrase list + boundary-anywhere regex for longer/embedded phrasing).
     * Catches a visitor stepping away or deferring ("I'll talk about it
     * later", "not right now", "I have to go") so the widget can stop
     * qualification entirely instead of re-asking the current project
     * question right after acknowledging them — the exact contradiction
     * ("no problem... would you like to book a call? what project do you
     * need help with?") this exists to close. Layer 2 is the AI's own
     * conversationEnding turn-signal (api/chat.js), a backstop for
     * phrasing this finite local list doesn't recognize — same two-layer
     * pattern as contact refusal detection.
     *
     * Short, extremely common acknowledgment words ("thanks", "sounds
     * good") are deliberately EXACT-MATCH ONLY, never boundary-anywhere —
     * "thanks, what about pricing though?" must not trigger this, since
     * the conversation isn't actually over there; only a bare, standalone
     * acknowledgment with nothing else attached counts. */
    function looksLikeExitSignal(v) {
      var lower = v.trim().toLowerCase().replace(/[‘’]/g, "'").replace(/[.!?]+$/, '');
      var exactPhrases = [
        'later', 'maybe later', 'not now', 'not right now', 'not today',
        'thanks', 'thank you', 'thanks anyway', "that's enough", 'thats enough',
        'sounds good', 'sounds good thanks', 'i need some time', 'i have to go',
        'i gotta go', 'i got to go', 'maybe some other time', 'some other time',
        'maybe another time',
      ];
      if (exactPhrases.indexOf(lower) > -1) return true;
      var boundaryPhrases = /\b(talk about it later|think about it|come back later|reach out later|contact you later|discuss it later|get back to you|need some time|have to go|got to go|gotta run|review it first|maybe another time|some other time)\b/;
      return boundaryPhrases.test(lower);
    }

    /* Same shape-based idea as looksLikePhoneAttempt/looksLikeEmailAttempt,
     * applied to the name step. Previously this step relied on isOffTopic's
     * narrow keyword denylist (price/cost/services/help/contact/etc.) to
     * decide whether to detour to the AI instead of validating as a name —
     * a real question like "who is andrew" or "i have one question before
     * i tell you my name who is andrew" contains NONE of those keywords,
     * so it fell straight through into isValidName() and got flatly
     * rejected as a refusal, with the actual question never answered at
     * all. A genuine name is short and declarative; treat anything with a
     * '?', a leading question/imperative word, or more than 4 words as a
     * detour to answer via the AI instead of as a (failed) name attempt —
     * mirrors isValidName's own word-count threshold so the two stay
     * consistent. The imperative words (tell, show, explain, etc.) close a
     * gap a leading-question-word check alone misses: "Tell me about
     * FlowerMoxie" is 4 words, has no '?', and doesn't start with
     * who/what/how, so it used to pass straight through as if it WERE the
     * user's name ("Nice to meet you, Tell me about FlowerMoxie!"). */
    function looksLikeNameAttempt(v) {
      var trimmed = v.trim();
      if (!trimmed) return false;
      if (trimmed.indexOf('?') > -1) return false;
      var wordCount = trimmed.split(/\s+/).filter(Boolean).length;
      if (wordCount > 4) return false;
      var firstWord = trimmed.split(/\s+/)[0].toLowerCase();
      var questionWords = ['who', 'what', 'when', 'where', 'why', 'how', 'is', 'are', 'do', 'does', 'can', 'could', 'would', 'will',
        'tell', 'show', 'explain', 'describe', 'give', 'list', 'let'];
      if (questionWords.indexOf(firstWord) > -1) return false;
      return true;
    }

    /* Deterministic local match against a step's own option list, tried
     * BEFORE the AI call so an exact (or near-exact) typed option advances
     * the qualification step instantly, without depending on the model to
     * correctly self-report [[STEP_ANSWERED]] for the easy case. Restores
     * the QA-approved version's reliability: the old widget always tried
     * a local keyword/exact match first and only fell back to an AI
     * classify call when that failed. Intentionally conservative — only
     * an exact case-insensitive match or a one-sided substring match
     * counts, so this never mis-fires on a real sentence that happens to
     * mention a word from an option (e.g. "I'm not sure about budget yet"
     * should NOT silently match "Not sure yet" here; that ambiguous case
     * is exactly what the AI call is still for). */
    function localExactOptionMatch(v, options) {
      var trimmed = v.trim();
      var lower = trimmed.toLowerCase();
      for (var i = 0; i < options.length; i++) {
        var opt = options[i];
        var optLower = opt.toLowerCase();
        if (lower === optLower) return opt;
      }
      // One-sided containment only when the typed text is short enough that
      // it's plausibly just the option itself with minor extra wording
      // (e.g. "asap" -> "ASAP", "mobile app" -> "Mobile App"), not a long
      // sentence that happens to contain the phrase incidentally.
      if (trimmed.length <= 24) {
        for (var j = 0; j < options.length; j++) {
          var opt2 = options[j];
          if (lower === opt2.toLowerCase()) return opt2;
          if (opt2.toLowerCase().indexOf(lower) > -1 || lower.indexOf(opt2.toLowerCase()) > -1) return opt2;
        }
      }
      return null;
    }

    /* Rejects refusal phrases, sentences, and phone/email-shaped values
     * from being stored as the lead's name — without this, "I won't tell
     * my name" gets accepted verbatim and the bot replies "Nice to meet
     * you, i won't tell my name!", producing garbage CRM data. Mirrors the
     * deterministic-keyword-check pattern used by isOffTopic/
     * detectContactCorrection rather than an AI call, since this is a
     * structural validation rule, not something that needs interpretation. */
    function isValidName(v) {
      var trimmed = v.trim();
      var lower = trimmed.toLowerCase();
      /* Bare/short refusal phrases — checked as exact matches (after
       * stripping punctuation) rather than substrings, so this list can
       * include short, common words like "no" or "skip" without rejecting
       * a real name that happens to contain them as a substring. "no name"
       * is the exact case that slipped through before: it's short enough
       * to pass every other check (not a sentence, not phone/email-shaped,
       * 2 words), so it needs its own explicit entry rather than relying
       * on the bare-"no" regex alone. */
      var lowerNoPunct = lower.replace(/[.!?]+$/, '');
      var exactRefusalPhrases = [
        'no name', 'no', 'nope', 'nah', 'skip', 'not telling',
        "don't want to tell", 'dont want to tell',
        "don't want to share", 'dont want to share',
        'rather not', 'prefer not to say', 'anonymous',
        'no thanks', 'not comfortable sharing',
      ];
      if (exactRefusalPhrases.indexOf(lowerNoPunct) > -1) return false;
      /* Longer refusal phrases that can appear embedded in a fuller
       * sentence ("I really don't want to tell you my name right now") —
       * substring match is appropriate here since these phrases are
       * distinctive enough that a real name would never contain them. */
      var refusalSubstrings = ["won't tell", 'wont tell', "don't want to share", 'dont want to share', "don't want to tell", 'dont want to tell', 'prefer not to say', 'not comfortable sharing', 'not comfortable', "rather not say", 'rather not', 'no thanks', 'not telling'];
      if (refusalSubstrings.some(function (k) { return lower.indexOf(k) > -1; })) return false;
      /* Phone numbers and email addresses typed into the name field. */
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return false;
      if (/^\d+$/.test(trimmed.replace(/[\s\-().]/g, ''))) return false;
      /* A real name is essentially never more than a few words — anything
       * longer is almost certainly a sentence (a refusal, a question, an
       * aside), not someone stating their name. */
      var wordCount = trimmed.split(/\s+/).filter(Boolean).length;
      if (wordCount > 4) return false;
      if (trimmed.length < 2) return false;
      /* Second line of defense behind looksLikeNameAttempt's own gate: a
       * leading imperative ("Tell me about FlowerMoxie", "Show me your
       * services") is conversational, never a name, even at <=4 words with
       * no '?' and no question word — without this, such a phrase gets
       * stored verbatim as lead.name ("Nice to meet you, Tell me about
       * FlowerMoxie!"). */
      var imperativeFirstWords = ['tell', 'show', 'explain', 'describe', 'give', 'list', 'let', 'who', 'what', 'when', 'where', 'why', 'how', 'is', 'are', 'do', 'does', 'can', 'could', 'would', 'will'];
      var firstWordLower = lower.split(/\s+/)[0];
      if (imperativeFirstWords.indexOf(firstWordLower) > -1) return false;
      return true;
    }

    /* Local, deterministic keyword check (same pattern as isOffTopic above)
     * for "the user wants to fix a contact detail they already gave us" —
     * deliberately not an AI call, since this is a structural data-edit
     * operation on the lead object, not conversational content the model
     * needs to interpret. Matches phrasing like "I forgot to enter my
     * actual email", "wrong phone number", "update my contact details". */
    function detectContactCorrection(v) {
      var lower = v.toLowerCase();
      var correctionKw = ['wrong', 'incorrect', 'mistake', 'typo', 'forgot to enter', 'forgot my real', 'forgot my actual', 'not my real', "didn't enter", 'did not enter', 'update my', 'change my', 'correct my', 'fix my', 'edit my'];
      var hasCorrectionIntent = correctionKw.some(function (k) { return lower.indexOf(k) > -1; });
      if (!hasCorrectionIntent) return null;
      if (/email/.test(lower)) return 'email';
      if (/phone|number/.test(lower)) return 'phone';
      if (/name/.test(lower)) return 'name';
      return ''; /* correction intent detected, but no field named yet — ask which one */
    }

    /* Merges the AI's [[TURN_SIGNAL:...]] extraction (see api/chat.js's
     * formatTurnSignalInstructions) into `lead`, re-validated through the
     * exact same local checks used everywhere else in this file
     * (isValidName / digit-length phone check / email regex) — the model's
     * own judgment is never trusted directly for what gets stored, only
     * used to notice that something was said. Never overwrites a field
     * already on file (first value wins, same as every other capture path
     * here). Called from a single choke point inside askAI, so every
     * LLM-first path (steps 0-3's stepContext detours, steps 4-6's
     * shape-gated detours, and plain free chat after lead capture) benefits
     * without each call site needing its own handling — this is what lets
     * "I'm Akash, quick question first" fill lead.name immediately instead
     * of only capturing it once step 4 is reached and asked head-on. */
    function applyInferredLeadInfo(info) {
      if (!info) return;
      var changed = false;
      if (!lead.name && info.name && isValidName(info.name)) { lead.name = info.name; changed = true; }
      if (!lead.phone && info.phone && info.phone.replace(/\D/g, '').length >= 7) { lead.phone = info.phone; changed = true; }
      if (!lead.email && info.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(info.email)) { lead.email = info.email; changed = true; }
      /* Company is opportunistic/low-stakes (no scripted step depends on
       * it, worst case the sales team sees a slightly-off guess) — just a
       * plausibility check, not full name-grade validation. */
      if (!lead.company && info.company && info.company.length <= 80 && !looksLikeContactRefusal(info.company)) { lead.company = info.company; changed = true; }
      /* intent/intentDetail/budget only ever arrive here already at HIGH
       * confidence (api/chat.js's formatTurnSignalInstructions keeps medium-
       * confidence guesses out of these keys entirely, see applyTentativeHints
       * below) — server-validated against the canonical taxonomy already,
       * re-checked here against the exact same source of truth the rest of
       * the widget uses (INTENT_OPTIONS/BUDGET_OPTIONS) rather than trusting
       * the server's copy blindly. intentDetail is only accepted once
       * lead.intent itself is resolved (possibly by the very line above it,
       * if both arrived in the same message) and is a genuine member of
       * THAT intent's own sub-options — a stray intentDetail with no
       * matching bucket is simply dropped rather than stored orphaned. */
      if (!lead.intent && info.intent && INTENT_OPTIONS[info.intent]) { lead.intent = info.intent; changed = true; }
      if (!lead.intent_detail && info.intentDetail && lead.intent && INTENT_OPTIONS[lead.intent] && INTENT_OPTIONS[lead.intent].indexOf(info.intentDetail) > -1) {
        lead.intent_detail = info.intentDetail; changed = true;
      }
      if (!lead.budget && info.budget && BUDGET_OPTIONS.indexOf(info.budget) > -1) { lead.budget = info.budget; changed = true; }
      if (changed) saveSession();
    }

    /* Medium-confidence project-type/budget hints (api/chat.js's "don't
     * lock it in yet" tier) — stored only while the real field is still
     * open, never trusted as the answer itself. Read back out via
     * handleInput's step-0/1/2 stepContext (`hint:` key) so the AI can
     * softly confirm ("sounds like this might lean toward X, is that
     * right?") instead of either asking cold or silently losing what the
     * visitor already half-said. Once the real field lands, the hint is
     * simply never consulted again (every read site already guards on the
     * field still being unset) — no separate clearing needed. */
    function applyTentativeHints(hints) {
      if (!hints) return;
      if (!lead.intent && hints.intent) tentativeHints.intent = hints.intent;
      if (!lead.budget && hints.budget) tentativeHints.budget = hints.budget;
    }

    /* Shared by the step-0/1/2 and "No"-followup detour callbacks below:
     * when the current question is still genuinely open and the AI's own
     * reply didn't ask something new (!redirected), the default is now a
     * plain-text nudge merged into the AI's own bubble, NOT a button wall —
     * buttons only surface when the AI itself signaled needsOptions (the
     * visitor asked for options, said "I don't know", seemed stuck, etc.).
     * Keeps the question visibly alive either way, just without defaulting
     * to a wall of choices on every single still-open turn. */
    function resumeStillOpen(aiReply, needsOptions, questionText, showButtonsFn) {
      if (needsOptions) {
        showButtonsFn();
        return;
      }
      if (!appendResumeLineToLastBotMsg(aiReply, questionText)) botReply(questionText);
    }

    /* Re-derives "what qualification info is still missing?" from `lead`
     * itself and asks exactly that, instead of any caller hardcoding "ask
     * the next thing in sequence" — the same principle as
     * advanceFromContactStep below, one level earlier in the flow. A rich
     * opening message ("I need an ERP for inventory, budget's ~$20k") can
     * set intent + intent_detail + budget all via applyInferredLeadInfo in
     * one shot, in which case this correctly skips straight to the notes
     * step without ever showing the intent/budget MCQs. Step 3 (notes) is
     * deliberately never auto-skipped here — it stays one always-asked,
     * low-friction beat between qualification and contact collection. */
    function advanceQualificationStep() {
      if (!lead.intent) {
        step = 0;
        botReply('What kind of project do you need help bringing to life?', renderStep0Buttons);
        return;
      }
      if (!lead.intent_detail) {
        step = 1;
        var followUpMsg = INTENT_DETAIL_FOLLOWUPS[lead.intent] || "Can you tell me a bit about it or if you already have a design in mind?";
        chatHistory.push({ role: 'assistant', content: followUpMsg });
        botReply(followUpMsg, function () { showIntentOptions(lead.intent); });
        return;
      }
      if (!lead.budget) {
        showBudgetStep();
        return;
      }
      showNotesStep();
    }

    /* Re-derives "what does this lead still need?" and resumes the
     * conversation accordingly, merging into the AI's own just-rendered
     * bubble rather than opening a new one (same one-voice convention as
     * appendResumeLineToLastBotMsg everywhere else in this file). Used from
     * the steps 4/5/6 detour branches below when the field that step was
     * about to ask for turns out to already be known — either just captured
     * by applyInferredLeadInfo from the SAME message that triggered this
     * detour, or captured earlier in the conversation. Without this, the
     * widget would ask for a field it already has, which is exactly the
     * "doesn't remember what I told it" bug this exists to close. */
    /* Contact-field question text, centralized here so every call site
     * (advanceFromContactStep, goToContactStep, the step 4/5/6 direct-set
     * and detour blocks) shares one copy instead of ~8 scattered literal
     * strings — and so they can all vary together by contactFlowTone
     * ('soft' reads as low-pressure/optional, matching a graceful-exit
     * hand-off; 'default' is the direct, standard end-of-qualification
     * phrasing) without hunting down every occurrence individually. */
    function nameQuestion() {
      if (contactFlowTone === 'soft') {
        return pickVaried([
          "Before you go, would you mind sharing your first name? Only if you're comfortable.",
          "No pressure at all, but what should I call you if we stay in touch?"
        ], 'q-name-soft');
      }
      return pickVaried([
        "Whenever you're ready, what's your name?",
        "By the way, what should I call you?"
      ], 'q-name-default');
    }
    function phoneQuestion() {
      if (contactFlowTone === 'soft') {
        return pickVaried([
          "Is there a phone number you'd like our consultant to reach you on? Again, only if you're comfortable.",
          "No obligation, but if you'd ever like a call back, what's the best number?"
        ], 'q-phone-soft');
      }
      return pickVaried([
        "What's the best phone number to reach you?",
        "And what's a good number to reach you on?"
      ], 'q-phone-default');
    }
    function emailQuestion() {
      if (contactFlowTone === 'soft') {
        return pickVaried([
          "What's the best email in case you'd like us to send helpful information or follow up later? Totally optional.",
          "If it's easier, I can just grab an email to send some info over whenever you're ready, entirely up to you."
        ], 'q-email-soft');
      }
      return pickVaried([
        "What's the best email address to reach you?",
        "And what's the best email to send details to?"
      ], 'q-email-default');
    }

    function advanceFromContactStep(aiReply) {
      if (lead.name && lead.phone && lead.email) {
        step = 7;
        var doneLine = "Perfect, I've got everything I need. Based on what you've shared, the best next step is a quick call or Google Meet to go over your project!";
        if (!appendResumeLineToLastBotMsg(aiReply, doneLine)) botReply(doneLine);
        showFinalCTA(true);
        return;
      }
      step = !lead.name ? 4 : !lead.phone ? 5 : 6;
      var nextQ = step === 4 ? nameQuestion() : step === 5 ? phoneQuestion() : emailQuestion();
      if (!appendResumeLineToLastBotMsg(aiReply, nextQ)) {
        botReply(nextQ);
      }
    }

    /* The three resolve*Refusal functions below are each reachable from TWO
     * different triggers: the widget's own local looksLikeContactRefusal()
     * regex/keyword check (fast, free, catches the common/anticipated
     * phrasing), and the AI's [[REFUSED]] marker (a second line of defense
     * for phrasing the local check doesn't recognize — see stepContext in
     * the step 4/5/6 askAI calls below). Reached via the local check, there
     * is no existing bot bubble for this turn yet, so aiReply is omitted
     * and a fresh botReply() is used. Reached via the AI, askAI has ALREADY
     * rendered the AI's own empathetic acknowledgment as a bubble before
     * this runs — calling botReply() again here would stack a second,
     * separate bubble right under it, which is exactly the "two questions/
     * messages back to back" bug fixed earlier in this file, just
     * reintroduced through this new path. Passing aiReply merges the
     * follow-up line into that same already-rendered bubble instead via
     * appendResumeLineToLastBotMsg, consistent with every other detour-
     * resume in this file. */

    /* First occurrence: acknowledge and explicitly offer the easiest
     * alternative (nickname/first name/business name), staying on step 4
     * for one more try — matches the spirit of the pre-existing isValidName
     * rejection message. Second occurrence: stop asking, fall back to a
     * generic placeholder so the conversation can actually progress
     * (lead.name still has to be non-empty — api/send-lead.js requires it)
     * instead of looping on the same question forever. */
    function resolveNameRefusal(aiReply) {
      var hasAiReply = aiReply !== undefined && aiReply !== null;
      if (!nameRefusalAcknowledged) {
        nameRefusalAcknowledged = true;
        var followUp = "Even a first name, nickname, or business name works great, just so our team knows who they're chatting with. What would you like us to call you?";
        if (hasAiReply) {
          if (!appendResumeLineToLastBotMsg(aiReply, followUp)) botReply(followUp);
        } else {
          var reply = 'No worries at all! ' + followUp;
          chatHistory.push({ role: 'assistant', content: reply });
          botReply(reply);
        }
      } else {
        lead.name = 'Friend';
        step = 5;
        var followUp2 = 'What\'s the best phone number to reach you?';
        if (hasAiReply) {
          if (!appendResumeLineToLastBotMsg(aiReply, followUp2)) botReply(followUp2);
        } else {
          var reply2 = 'No problem, we\'ll just go with "Friend" for now. ' + followUp2;
          chatHistory.push({ role: 'assistant', content: reply2 });
          botReply(reply2);
        }
      }
    }

    /* Phone is genuinely optional — a single refusal skips it outright (no
     * two-stage nudge, unlike name/email) and advances straight to email. */
    function resolvePhoneRefusal(aiReply) {
      step = 6;
      var followUp = "What's the best email address to reach you?";
      if (aiReply !== undefined && aiReply !== null) {
        if (!appendResumeLineToLastBotMsg(aiReply, 'Whenever you\'re ready, ' + followUp.charAt(0).toLowerCase() + followUp.slice(1))) {
          botReply(followUp);
        }
      } else {
        var reply = "No problem, we don't need a phone number then. " + followUp;
        chatHistory.push({ role: 'assistant', content: reply });
        botReply(reply);
      }
    }

    /* Email can't be silently skipped like phone — api/send-lead.js still
     * requires it to deliver the lead — so this offers the next-best
     * alternative (a phone callback if one is on file, direct contact info
     * otherwise) and moves straight to the final CTA rather than looping. */
    function resolveEmailRefusal(aiReply) {
      var followUp = lead.phone
        ? "We'll have our team reach out by phone at " + lead.phone + ' instead.'
        : 'Feel free to reach us directly at 406-936-3049 or contact@demskigroup.com whenever you\'re ready.';
      if (aiReply !== undefined && aiReply !== null) {
        if (appendResumeLineToLastBotMsg(aiReply, followUp)) {
          showFinalCTA(true);
        } else {
          botReply(followUp, function () { showFinalCTA(true); });
        }
      } else {
        var reply = 'No worries! ' + followUp;
        chatHistory.push({ role: 'assistant', content: reply });
        botReply(reply, function () { showFinalCTA(true); });
      }
    }

    /* A short, warm summary used as showFinalCTA's intro line specifically
     * for the soft/deferred tone — references the project type if one was
     * actually captured, so it reads as "I was listening" rather than a
     * generic close. Falls back to a topic-free variant when nothing was
     * captured yet (e.g. the visitor deferred right at the very start). */
    function buildSoftClosingSummary() {
      var topic = lead.intent_detail || lead.intent;
      if (topic) {
        return 'It sounds like ' + topic + ' is what you\'re exploring, and you\'d like to think it over first, that\'s completely understandable. Whenever you\'re ready, we\'d be happy to continue right where we left off.';
      }
      return "No problem taking some time to think it over. Whenever you're ready, we'd be happy to continue right where we left off.";
    }

    /* Entry point for a "the visitor is stepping away / deferring" signal
     * (looksLikeExitSignal locally, or the AI's own conversationEnding
     * turn-signal as a backstop — see both call sites in handleInput/
     * askAI below). This is the fix for the "no problem... would you like
     * to book a call? what project do you need help with?" contradiction:
     * once this fires, qualification is over, full stop, no more project
     * questions get asked no matter what step the conversation was on.
     *
     * aiReply is omitted when reached via the local Layer-1 match (no AI
     * call was made this turn, so nothing has acknowledged the message
     * yet — a canned acknowledgment is shown). It's provided when reached
     * via the AI's own conversationEnding marker, in which case the
     * system prompt already had the model produce its own graceful
     * acknowledgment as the visible reply — appending a second, canned one
     * on top would just be redundant, so this proceeds straight to the
     * soft contact offer after a natural beat instead. */
    function enterGracefulExitFlow(aiReply) {
      contactFlowTone = 'soft';
      if (aiReply === undefined || aiReply === null) {
        var exitAck = pickVaried([
          "No problem at all. Take your time, whenever you're ready we'll be happy to continue right where we left off.",
          "Totally understand, no rush at all. We'll pick up right where we left off whenever works for you.",
          "Of course, take all the time you need. We'll be here when you're ready to continue."
        ], 'exit-ack');
        chatHistory.push({ role: 'assistant', content: exitAck });
        botReply(exitAck, function () { goToContactStep(undefined); });
      } else {
        setTimeout(function () { goToContactStep(undefined); }, 900);
      }
    }

    /* ── AI CALL ──
     * Used for every typed message (LLM-first: the model always sees and
     * answers what the user actually said). Sends the running chatHistory
     * to the /api/chat proxy (OpenAI GPT-4o-mini) and renders the reply
     * like a normal bot message. When stepContext is passed (the current
     * qualification question + its option shortcuts), the server also
     * returns stepAnswered — true if the model judged the user's message
     * to already answer that question, so the caller can skip re-showing
     * redundant MCQ buttons instead of always showing them regardless of
     * context. onDone receives (reply, stepAnswered, matchedOption,
     * redirected, collectContact) — redirected is true when the AI's reply
     * itself asked a new specific question, meaning the caller should show
     * NO buttons at all and just wait for the next typed message, rather
     * than stacking the original MCQ options underneath. collectContact is
     * true specifically when the user wants to be connected with the team
     * (e.g. "can someone contact me") — the AI defers entirely to the
     * widget's own validated name/phone/email flow instead of asking for
     * those itself, so the caller should hand off to enterContactFlow()
     * rather than treating this like an ordinary redirect. refused is true
     * when stepContext's question was asking for name/phone/email and the
     * AI judged the message an explicit refusal or hostile dismissal rather
     * than a genuine attempt — the second line of defense behind the
     * widget's own local looksLikeContactRefusal() regex/keyword check, for
     * phrasing that check doesn't recognize (the AI actually understands
     * language; the local check is necessarily a finite pattern list). All
     * signal fields are null when no stepContext was supplied. */
    function askAI(userText, silent, onDone, stepContext) {
      if (aiRequestInFlight) return;
      aiRequestInFlight = true;
      if (!silent) {
        chatHistory.push({ role: 'user', content: userText });
      }
      showTyping();
      inputEl.disabled = true;

      var body = { messages: chatHistory };
      if (stepContext) body.stepContext = stepContext;

      fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        aiRequestInFlight = false;
        hideTyping();
        inputEl.disabled = false;
        var reply = (data.reply || "I'm having a little trouble right now. Please try again or call us at 406-936-3049.").replace(/—/g, ',');
        chatHistory.push({ role: 'assistant', content: reply });
        addBotMsg(reply);
        applyInferredLeadInfo(data.leadInfo);
        applyTentativeHints(data.hints);
        resetIdleTimer();
        setTimeout(function () { inputEl.focus(); }, 100);
        /* Layer 2 of exit-signal handling (backstop behind the local
         * looksLikeExitSignal check in handleInput, for deferral phrasing
         * that finite list doesn't recognize) — checked BEFORE the
         * collectContact/readyForContact branch below since the two are
         * meant to be mutually exclusive outcomes (api/chat.js already
         * enforces this server-side too) and, if a reply somehow carried
         * both, backing off is the safer default. This is what stops the
         * "no problem... would you like to book a call? what project do
         * you need help with?" contradiction: once conversationEnding
         * fires, the qualification-step fallback logic in onDone below
         * never runs at all for this turn. */
        if (data.conversationEnding === true && step < 4) {
          enterGracefulExitFlow(reply);
          return;
        }
        /* Centralized "time to collect contact info" check — covers BOTH
         * the stepContext-gated explicit [[COLLECT_CONTACT]] marker AND the
         * new always-on, inferred readyForContact signal (see api/chat.js's
         * formatTurnSignalInstructions), which fires even on paths that
         * never had a stepContext at all (plain free chat, the very first
         * typed message). `step < 4` guards this to only ever fire before
         * contact collection has already started — once inside steps 4-6,
         * we're already collecting, and readyForContact firing there would
         * be redundant at best. Individual onDone callbacks below no longer
         * need their own `if (collectContact)` check, this one covers all
         * of them; onDone simply never runs on this path. */
        if ((data.collectContact === true || data.readyForContact === true) && step < 4) {
          enterContactFlow();
          return;
        }
        if (onDone) onDone(reply, data.stepAnswered === true, data.matchedOption || null, data.redirected === true, data.collectContact === true, data.refused === true, data.needsOptions === true);
      })
      .catch(function () {
        aiRequestInFlight = false;
        hideTyping();
        inputEl.disabled = false;
        addBotMsg("Sorry, I'm having trouble connecting right now. Please call us at 406-936-3049 or email contact@demskigroup.com.");
        resetIdleTimer();
        if (onDone) onDone(null, false, null, false, false, false, false);
      });
    }


    /* The input bar is always visible once the chat is open (set in the
     * static markup) and must never be hidden again — hideInputBar is kept
     * as a no-op so every existing call site stays valid without having to
     * audit/rewrite each one individually. */
    function showInputBar() {
      inputBar.setAttribute('style', 'display:flex!important;align-items:center;gap:8px;padding:18px 12px 20px;border-top:1px solid rgba(255,255,255,0.3);background:rgba(255,255,255,0.45);flex-shrink:0;');
      setTimeout(function () { scroll(); inputEl.focus(); }, 50);
    }

    function hideInputBar() {}

    function showScheduleBar() {
      schedBar.style.setProperty('display', 'block', 'important');
    }

    /* ── IDLE ── */
    function removeIdleReminder() {
      var b = document.getElementById(IDLE_MSG_ID);  if (b) b.remove();
      var d = document.getElementById(IDLE_BTNS_ID); if (d) d.remove();
    }

    function scheduleIdleTimer() {
      clearTimeout(idleTimer);
      if (step < 7 && !idleReminderShown) idleTimer = setTimeout(showIdleReminder, idleInterval);
    }

    function resetIdleTimer() {
      clearTimeout(idleTimer);
      idleInterval = 40000;
      removeIdleReminder();
      awaitingIdleResponse = false;
      scheduleIdleTimer();
    }

    /* The floating idle bubble's message (shown only while the chat window
     * is closed, see below) — unlike the in-chat reminder text (`idleMsg`
     * below, left exactly as-is: that's chat transcript content, not the
     * teaser bubble), this one adapts to how far the conversation actually
     * got, since `lead`/`step` are both in scope here. Close to done ->
     * offer to connect with the team; mid-conversation with a known
     * project type -> reference it by name; otherwise a generic "still
     * here" nudge. */
    function pickIdleBubbleMessage() {
      if (step >= 4 && step < 7) {
        return pickVaried([
          "If you'd like, I can connect you with one of our consultants.",
          "Whenever you're ready, I can get our team looped in."
        ], 'idle-almost-done');
      }
      var topic = lead.intent_detail || lead.intent;
      if (topic) {
        return pickVaried([
          'Still thinking about ' + topic + '?',
          'We were discussing your ' + topic + ', happy to keep going.',
          'Ready to continue whenever you are.'
        ], 'idle-topic');
      }
      return pickVaried([
        "Still there? No rush, I'm here if you need anything.",
        "Feel free to ask anything, I'm around.",
        "If you'd like help with anything else, I'm here."
      ], 'idle-generic');
    }

    /* Fires at most ONCE per session, and never while the user is actively
     * engaged: input focused, or chat freshly interacted with (the timer
     * is restarted from scratch by resetIdleTimer on every interaction, so
     * by the time this fires the user has genuinely gone quiet for a full
     * idleInterval). If the input happens to have focus right as the timer
     * elapses, push it out a bit further rather than interrupting typing. */
    function showIdleReminder() {
      if (step >= 7 || awaitingIdleResponse || idleReminderShown) return;
      if (document.activeElement === inputEl) {
        idleTimer = setTimeout(showIdleReminder, 15000);
        return;
      }
      idleReminderShown = true;
      awaitingIdleResponse = true;

      /* Badge + shake + sound on the launcher only make sense while the
       * chat window is closed — skip them while the user has it open. */
      var leadBotEl = document.getElementById('lead-bot');
      var chatIsOpen = leadBotEl && leadBotEl.style.display === 'block';
      var idleMsg = "If you'd like help with anything else, I'm here.";
      if (!chatIsOpen) {
        document.getElementById('cb-launcher-badge').classList.add('cb-badge-on');
        var idleLauncher = document.getElementById('bot-launcher');
        if (idleLauncher) {
          idleLauncher.classList.remove('cb-shake');
          void idleLauncher.offsetWidth;
          idleLauncher.classList.add('cb-shake');
          setTimeout(function () { idleLauncher.classList.remove('cb-shake'); }, 2000);
        }
        playNotification();
        showIdleBubble(pickIdleBubbleMessage());
      }

      removeIdleReminder();
      dedupeLastBotMsg(idleMsg);
      var wrap = document.createElement('div');
      wrap.id = IDLE_MSG_ID;
      wrap.className = 'cb-bot-msg-wrap';
      wrap.setAttribute('style', WRAP_STYLE);
      var idleAv = document.createElement('img');
      idleAv.src = AVATAR_URL;
      idleAv.alt = '';
      idleAv.setAttribute('style', AV_STYLE);
      idleAv.onerror = function () { idleAv.onerror = null; idleAv.src = AVATAR_FB; };
      wrap.appendChild(idleAv);
      wrap.appendChild(buildBotMsgBubble(idleMsg));
      msgs.appendChild(wrap); scroll();
      awaitingIdleResponse = false;
      /* One-time only — no follow-up timer is scheduled after this. */
    }

    /* ── EXPAND UI ── */
    function expandUI() {
      if (expanded) return; expanded = true;
      document.getElementById('cb-header').style.display = 'none';
      document.getElementById('cb-top-section').style.display = 'block';
    }

    /* ── GREETING CARD (big, shown first) ── */
    function showGreetingCard() {
      if (expanded || teaserFlowDone || document.getElementById('cb-greeting-card')) return;
      var c = document.createElement('div'); c.id = 'cb-greeting-card';
      c.innerHTML =
        '<div class="cb-gc-head">' +
          '<div class="cb-gc-av-wrap">' +
            '<img src="' + AVATAR_URL + '" alt="' + BOT_NAME + '" onerror="this.src=\'' + AVATAR_FB + '\'" />' +
            '<span class="cb-gc-online"></span>' +
          '</div>' +
          '<div><div class="cb-gc-name">' + BOT_NAME + '</div><div class="cb-gc-time">Just now</div></div>' +
          '<span class="cb-gc-close" id="cb-gc-close">&#x00D7;</span>' +
        '</div>' +
        '<p class="cb-gc-question">Are you currently exploring custom software or app development for your business?</p>' +
        '<div class="cb-gc-yn">' +
          '<button id="cb-gc-yes">Yes</button>' +
          '<button id="cb-gc-no">No</button>' +
        '</div>' +
        '<div class="cb-gc-input">' +
          '<input type="text" id="cb-gc-input-el" placeholder="Ask a question" autocomplete="off" />' +
          '<button id="cb-gc-send" aria-label="Send">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>' +
          '</button>' +
        '</div>';
      document.body.appendChild(c);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { c.classList.add('cb-gv'); });
      });
      document.getElementById('cb-gc-close').onclick = function () {
        if (cardTimer) { clearTimeout(cardTimer); cardTimer = null; }
        dismissGreetingCard();
        scheduleLauncherBadge();
      };
      document.getElementById('cb-gc-yes').onclick   = function () { openFromTeaser('Yes'); };
      document.getElementById('cb-gc-no').onclick    = function () { openFromTeaser('No'); };
      document.getElementById('cb-gc-send').onclick  = sendFromGreetingCard;
      var gcInputEl = document.getElementById('cb-gc-input-el');
      gcInputEl.onkeydown = function (e) {
        if (e.key === 'Enter') sendFromGreetingCard();
      };

      /* While the user is focused on/typing in the greeting card's input,
       * the auto-collapse-to-bubble timer must never fire — collapsing the
       * card out from under someone mid-keystroke is the exact bug this
       * fixes. gcInputFocused suspends the timer entirely on focus, and
       * every keyboard/paste/input event (covering normal typing, IME/
       * autocomplete, mobile keyboards, and voice-typed input alike, since
       * all of those ultimately fire an 'input' event) restarts it fresh
       * on blur. Mouse movement, scrolling, and touch ANYWHERE on the page
       * — not just on the card itself — also count as activity, so a user
       * reading the page (scrolling, moving their mouse) without literally
       * touching the card doesn't get it yanked away from under them
       * either. Listeners are document-level and explicitly torn down in
       * dismissGreetingCard so they don't pile up across repeated
       * show/dismiss cycles (teaser → reopen → teaser, etc). */
      var gcInputFocused = false;
      function restartCardTimer() {
        if (cardTimer) { clearTimeout(cardTimer); cardTimer = null; }
        if (gcInputFocused) return; /* timer stays suspended until blur */
        cardTimer = setTimeout(function () {
          dismissGreetingCard();
          scheduleLauncherBadge();
        }, 60000);
      }
      gcInputEl.addEventListener('focus', function () {
        gcInputFocused = true;
        if (cardTimer) { clearTimeout(cardTimer); cardTimer = null; }
      });
      gcInputEl.addEventListener('blur', function () {
        gcInputFocused = false;
        restartCardTimer();
      });
      ['keydown', 'keyup', 'input', 'paste'].forEach(function (evt) {
        gcInputEl.addEventListener(evt, restartCardTimer);
      });
      var gcActivityEvents = ['mousemove', 'scroll', 'touchstart', 'touchmove'];
      gcActivityEvents.forEach(function (evt) {
        document.addEventListener(evt, restartCardTimer, { passive: true });
      });
      gcTeardownActivityListeners = function () {
        gcActivityEvents.forEach(function (evt) {
          document.removeEventListener(evt, restartCardTimer, { passive: true });
        });
        gcTeardownActivityListeners = null;
      };

      /* No interaction on the card → hide it, then wait silently (no visible
       * bubble) until the badge/shake/sound moment, where the small teaser
       * bubble now appears alongside them instead of arriving on its own
       * beforehand. */
      restartCardTimer();
    }

    function sendFromGreetingCard() {
      cancelTeaserFlow();
      var inp = document.getElementById('cb-gc-input-el');
      var val = inp && inp.value.trim();
      openFromTeaser(val || null);
    }

    function dismissGreetingCard() {
      if (cardTimer) { clearTimeout(cardTimer); cardTimer = null; }
      if (gcTeardownActivityListeners) gcTeardownActivityListeners();
      var c = document.getElementById('cb-greeting-card'); if (!c) return;
      c.classList.remove('cb-gv'); c.classList.add('cb-gh');
      setTimeout(function () { if (c.parentNode) c.remove(); }, 400);
    }

    /* ── GREETING BUBBLE (small) ──
     * Previously shown on its own, silently, 40s before the badge/shake/
     * sound stage — a popup with no sound or motion arriving on its own,
     * unprompted, is exactly what was reported as unwanted. Split into two
     * pieces: scheduleLauncherBadge() is the silent wait (no DOM, nothing
     * visible) that replaces the old immediate bubble display after the
     * card is dismissed, and renderGreetingBubble() is the actual bubble
     * markup, now called FROM showLauncherBadge() below so the bubble only
     * ever appears in the same instant as the badge/shake/notification
     * sound — one single noticeable moment instead of two separate ones. */
    function scheduleLauncherBadge() {
      if (expanded || teaserFlowDone) return;
      bubbleTimer = setTimeout(showLauncherBadge, 40000);
    }

    function renderGreetingBubble() {
      if (expanded || teaserFlowDone || document.getElementById('cb-greeting-bubble')) return;
      var b = document.createElement('div'); b.id = 'cb-greeting-bubble'; b.className = 'cb-teaser-bubble';
      b.innerHTML =
        '<p id="cb-bopen">' + escapeHtml(pickTeaserMessage()) + '</p>' +
        '<img class="cb-bubble-av" src="' + AVATAR_URL + '" alt="' + BOT_NAME + '" onerror="this.src=\'' + AVATAR_FB + '\'" />' +
        '<span class="cb-bubble-close" id="cb-bclose">&#x00D7;</span>';
      document.body.appendChild(b);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { b.classList.add('cb-bv'); });
      });
      document.getElementById('cb-bclose').onclick = function () { cancelTeaserFlow(); dismissBubble(); };
      document.getElementById('cb-bopen').onclick   = function () { cancelTeaserFlow(); openFromTeaser(null); };
    }

    function dismissBubble() {
      if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null; }
      var b = document.getElementById('cb-greeting-bubble'); if (!b) return;
      b.classList.remove('cb-bv'); b.classList.add('cb-bh');
      setTimeout(function () { if (b.parentNode) b.remove(); }, 400);
    }

    /* ── IDLE REMINDER BUBBLE (floating teaser fired alongside the badge/shake
     * during an active conversation) ── Reuses the .cb-teaser-bubble visuals
     * but, unlike the pre-conversation greeting bubble, clicking it must
     * resume the existing chat (launcherClick already knows how) rather than
     * starting the teaser flow, and it self-hides after a few seconds while
     * leaving the red badge on. Only one can ever be on screen at a time. */
    function dismissIdleBubble() {
      if (idleBubbleTimer) { clearTimeout(idleBubbleTimer); idleBubbleTimer = null; }
      var b = document.getElementById(IDLE_BUBBLE_ID); if (!b) return;
      b.classList.remove('cb-bv'); b.classList.add('cb-bh');
      setTimeout(function () { if (b.parentNode) b.remove(); }, 400);
    }

    function showIdleBubble(text) {
      dismissIdleBubble();
      var b = document.createElement('div'); b.id = IDLE_BUBBLE_ID; b.className = 'cb-teaser-bubble';
      b.innerHTML =
        '<p id="cb-ibopen">' + escapeHtml(text) + '</p>' +
        '<img class="cb-bubble-av" src="' + AVATAR_URL + '" alt="' + BOT_NAME + '" onerror="this.src=\'' + AVATAR_FB + '\'" />' +
        '<span class="cb-bubble-close" id="cb-ibclose">&#x00D7;</span>';
      document.body.appendChild(b);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { b.classList.add('cb-bv'); });
      });
      document.getElementById('cb-ibclose').onclick = function (e) { e.stopPropagation(); dismissIdleBubble(); };
      document.getElementById('cb-ibopen').onclick   = function () { dismissIdleBubble(); launcherClick(); };
      idleBubbleTimer = setTimeout(dismissIdleBubble, 7000);
    }

    /* No interaction since the card was dismissed for 40s (scheduleLauncherBadge)
     * → red badge + shake + notification sound on the launcher avatar, AND
     * the small "Hey! Do you have any questions?" bubble, all in the same
     * moment — the bubble used to arrive 40s earlier than this on its own,
     * silently. */
    function showLauncherBadge() {
      if (expanded || teaserFlowDone) return;
      var badge = document.getElementById('cb-launcher-badge');
      if (badge) badge.classList.add('cb-badge-on');
      playNotification();
      var launcher = document.getElementById('bot-launcher');
      if (launcher) {
        launcher.classList.remove('cb-shake');
        void launcher.offsetWidth; /* restart animation if it ran before */
        launcher.classList.add('cb-shake');
        setTimeout(function () { launcher.classList.remove('cb-shake'); }, 2000);
      }
      renderGreetingBubble();
      /* Still no interaction for another 10s → auto-open with the nudge message. */
      badgeTimer = setTimeout(autoOpenWithNudge, 10000);
    }

    /* Auto-open after the badge has been ignored for 10s. Skips the normal
     * welcome flow entirely and goes straight to a soft engagement nudge —
     * no conversation has happened yet at this point, so this is an invite
     * to start one, not a re-engagement check-in. */
    function autoOpenWithNudge() {
      if (expanded || teaserFlowDone) return;
      teaserFlowDone = true;
      dismissGreetingCard();
      dismissBubble();
      var badge = document.getElementById('cb-launcher-badge');
      if (badge) badge.classList.remove('cb-badge-on');
      setTimeout(function () {
        expanded = true;
        document.getElementById('lead-bot').style.display = 'block';
        setLauncherVisible(false);
        setBackdropVisible(true);
        document.getElementById('cb-welcome').style.display = 'none';
        msgs.classList.remove('cb-body-hidden');
        showScheduleBar();
        resetIdleTimer();
        msgs.innerHTML = '';
        addBotMsg("If you'd like help with anything, I'm here.");
        showInputBar();
      }, 200);
    }

    /* Cancels every pending teaser timer/auto-open. Called on any user
     * interaction (Yes/No, launcher, bubble, close button, or message). */
    function cancelTeaserFlow() {
      teaserFlowDone = true;
      if (cardTimer)  { clearTimeout(cardTimer);  cardTimer  = null; }
      if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null; }
      if (badgeTimer)  { clearTimeout(badgeTimer);  badgeTimer  = null; }
      /* openFromTeaser's "Yes" branch schedules its own greeting botReply
       * (typing delay + the message itself) — if the visitor types a
       * detour message before that timer fires, it must not go on to fire
       * anyway afterward and duplicate the greeting on top of whatever the
       * detour already rendered. Every path that calls cancelTeaserFlow
       * (every real user interaction, via addUserMsg/handleInput) also
       * preempts this. */
      if (pendingGreetingTimer) { clearTimeout(pendingGreetingTimer); pendingGreetingTimer = null; }
      var badge = document.getElementById('cb-launcher-badge');
      if (badge) badge.classList.remove('cb-badge-on');
    }

    function openFromTeaser(prefillText) {
      cancelTeaserFlow();
      dismissGreetingCard();
      dismissBubble();
      setTimeout(function () {
        document.getElementById('lead-bot').style.display = 'block';
        setLauncherVisible(false);
        setBackdropVisible(true);
        startChat();
        if (prefillText) {
          setTimeout(function () {
            cancelTeaserFlow();
            conversationStarted = true;
            prependGreetingExchange(prefillText);
            if (prefillText === 'No') {
              showNoFollowUp();
            } else if (prefillText === 'Yes') {
              expandUI();
              pendingGreetingTimer = botReply('What kind of project do you need help bringing to life?', function () {
                pendingGreetingTimer = null;
                renderStep0Buttons();
              });
            } else {
              /* The very first message ever, typed straight into the
               * greeting card before any step/stepContext exists — a rich
               * one-shot answer here ("I need an ERP for inventory, ~20k
               * budget, I'm Akash...") can set intent/intent_detail/budget
               * (and contact fields) via applyInferredLeadInfo inside
               * askAI, same as any other detour. Without this callback
               * nothing would ever move the conversation past step 0
               * afterward — the bot would answer and then just sit there. */
              askAI(prefillText, false, function (reply, stepAnswered, matchedOption, redirected, collectContact, refused, needsOptions) {
                if (lead.intent) {
                  advanceQualificationStep();
                } else if (!redirected) {
                  resumeStillOpen(reply, needsOptions, 'What kind of project do you need help bringing to life?', renderStep0Buttons);
                }
              });
            }
          }, 500);
        }
      }, 200);
    }

    /* ── "NO" FOLLOW-UP (hardcoded persuasive nudge + quick replies) ── */
    var NO_FOLLOWUP_OPTS = ['Managing data', 'Customer interactions', 'Team coordination', 'Nothing really'];
    var NO_FOLLOWUP_REPLIES = {
      'Managing data':          "That's a common one, disorganized data slows everything down. Let's talk budget.",
      'Customer interactions':  "Got it, smoother customer interactions can make a big difference. Let's talk budget.",
      'Team coordination':     "Makes sense, better team coordination saves a ton of time. Let's talk budget.",
      'Nothing really':        "No worries! Let's get a quick sense of budget in case anything comes up."
    };

    /* Shared by the button click and the typed-text match path: records the
     * pain point as the lead's intent detail, gives a short hardcoded
     * contextual reply, then always continues into the scripted Budget
     * MCQ — never leaves the user parked in free-text mode. */
    function selectNoFollowUp(val) {
      lead.intent = 'Software for my business';
      lead.intent_detail = val;
      chatHistory.push({ role: 'user', content: val });
      botReply(NO_FOLLOWUP_REPLIES[val] || "Got it, let's talk budget.", function () {
        showBudgetStep();
      });
    }

    function renderNoFollowUpButtons() {
      var old = document.getElementById('cb-no-followup'); if (old) old.remove();
      var div = document.createElement('div');
      div.className = 'cb-qbtns cb-grid'; div.id = 'cb-no-followup';
      div.innerHTML = NO_FOLLOWUP_OPTS.map(function (o) {
        return '<button data-nofollow="' + o + '">' + o + '</button>';
      }).join('');
      msgs.appendChild(div); scrollToLatestBotMsg();
      var btns = div.querySelectorAll('[data-nofollow]');
      for (var i = 0; i < btns.length; i++) {
        (function (btn) {
          btn.onclick = function () {
            var val = btn.getAttribute('data-nofollow');
            div.remove();
            addUserMsg(val);
            selectNoFollowUp(val);
          };
        })(btns[i]);
      }
    }

    function showNoFollowUp() {
      chatHistory.push({ role: 'user', content: 'No' });
      var msg = "Even if you're not actively looking, understanding what's possible can spark ideas. Many of our 250+ clients didn't realize how much custom software could transform their business. What's one thing in your business that feels harder than it should be?";
      addBotMsg(msg);
      chatHistory.push({ role: 'assistant', content: msg });
      resetIdleTimer();
      renderNoFollowUpButtons();
    }

    /* ── START CHAT ── */
    function startChat() {
      document.getElementById('cb-welcome').style.display = 'none';
      msgs.classList.remove('cb-body-hidden');
      showInputBar();
      showScheduleBar();
      resetIdleTimer();
    }

    function setLauncherVisible(visible) {
      var launcher = document.getElementById('bot-launcher');
      if (launcher) launcher.style.display = visible ? 'flex' : 'none';
    }

    /* Dims the page behind the chat on mobile/tablet (<=768px), where the
     * chat itself goes near-full-screen — no-op visually on desktop since
     * #cb-backdrop only renders via that media query. Clicking it closes
     * the chat, matching standard full-screen-modal mobile UX. */
    function setBackdropVisible(visible) {
      var backdrop = document.getElementById('cb-backdrop');
      if (backdrop) backdrop.classList.toggle('cb-backdrop-on', visible);
    }

    /* ── TOGGLE BOT ── */
    function toggleBot() {
      var win = document.getElementById('lead-bot');
      var isOpen = (win.style.display === 'none' || win.style.display === '');
      win.style.display = isOpen ? 'block' : 'none';
      setLauncherVisible(!isOpen);
      setBackdropVisible(isOpen);
      if (isOpen) {
        cancelTeaserFlow();
        dismissGreetingCard();
        dismissBubble();
        setTimeout(function () { startChat(); }, 400);
      }
    }

    /* Re-shows the teaser card on demand, bypassing showGreetingCard's
     * one-shot guards (expanded/teaserFlowDone/already-rendered) — those
     * guards exist only to stop the *automatic* first-load popup from
     * reappearing uninvited, not to block an explicit avatar click. */
    function reopenTeaserCard() {
      if (cardTimer)  { clearTimeout(cardTimer);  cardTimer  = null; }
      if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null; }
      if (badgeTimer)  { clearTimeout(badgeTimer);  badgeTimer  = null; }
      var badge = document.getElementById('cb-launcher-badge');
      if (badge) badge.classList.remove('cb-badge-on');
      dismissBubble();
      var existing = document.getElementById('cb-greeting-card');
      if (existing) existing.remove();
      var wasExpanded = expanded, wasTeaserDone = teaserFlowDone;
      expanded = false; teaserFlowDone = false;
      showGreetingCard();
      expanded = wasExpanded; teaserFlowDone = wasTeaserDone;
    }

    /* ── AVATAR LAUNCHER CLICK ──
     * The avatar's only job is: full chat open → close it (toggleBot);
     * full chat closed → resume exactly where the user left off. For a
     * first-time visitor (no conversation started yet) that means showing
     * the small teaser card, same as the existing teaser flow — the full
     * chat only opens once they interact with it (Yes/No/send). But once
     * `conversationStarted` is true (any MCQ pick, typed message, or idle
     * reply — set in addUserMsg, which every one of those paths funnels
     * through), a conversation already exists, so reopening must go
     * straight back to the full chat feed instead of restarting the
     * teaser/welcome flow on top of existing history. Checking widget
     * visibility alone isn't enough here — minimizing and reopening must
     * never be treated as "no conversation yet". */
    function launcherClick() {
      if (conversationStarted) { toggleBot(); return; }
      var win = document.getElementById('lead-bot');
      var chatIsOpen = !(win.style.display === 'none' || win.style.display === '');
      if (chatIsOpen) { toggleBot(); return; }
      reopenTeaserCard();
    }

    /* Renders the step-0 intent MCQ (same 4 options as the initial static
     * markup) into the message thread. Shared by the "Back" path, the
     * typed-text clarify fallback, and the teaser's "Yes" button so every
     * entry point into step 0 stays MCQ-first instead of free text. */
    function renderStep0Buttons() {
      var old = document.getElementById('cb-step1'); if (old) old.remove();
      scheduleMcqReveal(function () {
        var s1 = document.createElement('div'); s1.className = 'cb-qbtns cb-grid'; s1.id = 'cb-step1';
        ['New startup or app idea', 'Software for my business', 'Digital marketing help', 'Just exploring'].forEach(function (v) {
          var b = document.createElement('button'); b.textContent = v;
          b.onclick = function () { step1Handler(v); }; s1.appendChild(b);
        });
        msgs.appendChild(s1); scrollToLatestBotMsg();
      });
    }

    /* ── STEP 1: Intent ── */
    function step1Handler(val, skipUserMsg) {
      expandUI();
      var s1 = document.getElementById('cb-step1'); if (s1) s1.remove();
      if (!skipUserMsg) addUserMsg(val);
      chatHistory.push({ role: 'user', content: val });
      lead.intent = val; resetIdleTimer();
      /* advanceQualificationStep re-derives the next question from `lead`
       * itself rather than hardcoding "always ask intent-detail next" — a
       * rich message can set intent_detail (or even budget) in the same
       * turn via applyInferredLeadInfo, in which case this correctly skips
       * straight past the question that answer already covered. */
      advanceQualificationStep();
    }

    /* ── INTENT OPTIONS ── */
    function showIntentOptions(intent) {
      var oldIntent = document.getElementById('cb-intent'); if (oldIntent) oldIntent.remove();
      scheduleMcqReveal(function () {
        var opts = INTENT_OPTIONS[intent] || ['Mobile App', 'Web App', 'Something else'];
        var div = document.createElement('div'); div.className = 'cb-qbtns cb-grid'; div.id = 'cb-intent';
        opts.forEach(function (o) {
          var b = document.createElement('button'); b.textContent = o;
          b.onclick = function () {
            var el = document.getElementById('cb-intent'); if (el) el.remove();
            addUserMsg(o); lead.intent_detail = o;
            chatHistory.push({ role: 'user', content: o });
            step = 2;
            showBudgetStep();
          };
          div.appendChild(b);
        });
        div.appendChild(makeBackBtn('Back', function () {
          var el = document.getElementById('cb-intent'); if (el) el.remove();
          lead.intent = ''; step = 0;
          botReply('No problem! What kind of project do you need help bringing to life?', function () {
            renderStep0Buttons();
          });
        }));
        msgs.appendChild(div); scrollToLatestBotMsg();
      });
    }

    /* ── BUDGET ── */
    /* Includes a one-clause "why I'm asking" so the question doesn't land
     * cold — a visitor has no reason to volunteer budget to a stranger
     * unless it's obvious it changes how their project gets approached. */
    var BUDGET_QUESTION = "Roughly what budget range are you working with? I ask because a $10k project and a $500k platform get planned very differently, so it helps me point you toward the right approach.";

    /* Bare button renderer, mirroring renderStep0Buttons/showIntentOptions —
     * callable on its own (from the "still open" detour resume below) so
     * budget's quick-pick buttons can be offered without re-asking the
     * question in a fresh bubble. */
    function renderBudgetButtons() {
      var oldBudget = document.getElementById('cb-budget'); if (oldBudget) oldBudget.remove();
      scheduleMcqReveal(function () {
        var div = document.createElement('div'); div.className = 'cb-bbtns cb-grid'; div.id = 'cb-budget';
        BUDGET_OPTIONS.forEach(function (bv) {
          var btn = document.createElement('button'); btn.textContent = bv;
          btn.onclick = function () {
            var el = document.getElementById('cb-budget'); if (el) el.remove();
            addUserMsg(bv); lead.budget = bv;
            chatHistory.push({ role: 'user', content: bv });
            showNotesStep();
          };
          div.appendChild(btn);
        });
        div.appendChild(makeBackBtn('Back', function () {
          var el = document.getElementById('cb-budget'); if (el) el.remove();
          lead.budget = ''; step = 1; showIntentOptions(lead.intent);
        }));
        msgs.appendChild(div); scrollToLatestBotMsg();
      });
    }

    function showBudgetStep() {
      step = 2; resetIdleTimer();
      chatHistory.push({ role: 'assistant', content: BUDGET_QUESTION });
      botReply(BUDGET_QUESTION, function () {
        showInputBar();
        inputEl.placeholder = 'Type your answer...';
        renderBudgetButtons();
      });
    }

    /* ── OPTIONAL NOTES (free text, skippable) ── */
    var NOTES_QUESTION = "Anything else you'd like us to know about your project?";

    /* Shared by showNotesStep's initial render and the LLM-first detour's
     * "still open" resume below — re-shows just the Skip button without
     * repeating the bot's question text (consistent with renderStep0Buttons'
     * quieter re-show style rather than showBudgetStep's re-ask-then-show
     * style, since re-asking "anything else?" again right after the AI just
     * answered a real question would read as redundant friction on a step
     * that's supposed to feel optional/low-pressure). */
    function renderNotesSkipButton() {
      showInputBar();
      inputEl.placeholder = 'Type here, or tap Skip...';
      setTimeout(function () { inputEl.focus(); }, 50);
      var oldSkip = document.getElementById('cb-notes-skip'); if (oldSkip) oldSkip.remove();
      var div = document.createElement('div'); div.className = 'cb-qbtns cb-grid'; div.id = 'cb-notes-skip';
      div.style.setProperty('grid-template-columns', '1fr', 'important');
      var skip = document.createElement('button'); skip.textContent = 'Skip';
      skip.onclick = function () {
        var el = document.getElementById('cb-notes-skip'); if (el) el.remove();
        addUserMsg('Skip');
        goToContactStep("Thanks, this helps a lot!");
      };
      div.appendChild(skip);
      msgs.appendChild(div); scrollToLatestBotMsg();
    }

    function showNotesStep() {
      step = 3; resetIdleTimer();
      hideInputBar();
      botReply(NOTES_QUESTION, renderNotesSkipButton);
    }

    /* Single entry point into contact collection (called both when the
     * project-qualification flow naturally finishes, and when the user
     * asks to be connected with the team mid-conversation). A lead is only
     * ever collected once per session: if name/phone/email are already on
     * file from an earlier pass through this same flow, each is skipped
     * rather than re-asked, and if all three are already known, this jumps
     * straight to the final CTA with a personalized acknowledgment instead
     * of repeating questions the visitor already answered. introMsg lets
     * callers phrase the hand-off appropriately for their own context
     * (e.g. "thanks, that helps" vs. "let me grab a few details so our
     * team can reach out") without duplicating the skip-logic itself. */
    /* introMsg === undefined is reserved for enterGracefulExitFlow (the
     * only caller that relies on the tone-aware default intro below) —
     * every other caller passes an explicit string (even '' ), which also
     * resets contactFlowTone back to 'default' here, so a stale 'soft'
     * tone from an earlier deferral in the same session never leaks into
     * an unrelated, later "ready now" entry into this same function. */
    function goToContactStep(introMsg) {
      if (introMsg !== undefined) contactFlowTone = 'default';
      resetIdleTimer();
      if (lead.name && lead.phone && lead.email) {
        showInputBar();
        var allKnownMsg = contactFlowTone === 'soft'
          ? "No worries, I've already got your details from earlier, we'll follow up whenever you're ready."
          : "Perfect, " + lead.name + "! I already have your contact information on file. Based on what you've shared, the best next step is a quick call or Google Meet to go over your project!";
        botReply(allKnownMsg, function () {
          showFinalCTA(true);
        });
        return;
      }
      step = !lead.name ? 4 : !lead.phone ? 5 : 6;
      showInputBar();
      inputEl.placeholder = 'Type your answer...';
      setTimeout(function () { inputEl.focus(); }, 50);
      var nextQuestion = step === 4 ? nameQuestion() : step === 5 ? phoneQuestion() : emailQuestion();
      var defaultIntro = contactFlowTone === 'soft' ? '' : "Let me grab your details so our team can reach out.";
      var intro = introMsg === undefined ? defaultIntro : introMsg;
      botReply(intro ? intro + '\n\n' + nextQuestion : nextQuestion);
    }

    /* Entry point used when the AI signals [[COLLECT_CONTACT]] mid-conversation
     * (e.g. "can you connect me with somebody?") rather than at the natural
     * end of project qualification — same skip-already-known-fields logic,
     * just reached from a different conversational moment. No separate
     * intro line here: the AI's own reply (already shown by askAI just
     * before this runs) already acknowledged the request naturally per the
     * system prompt, so repeating an intro would be a visible duplicate. */
    function enterContactFlow() {
      goToContactStep('');
    }

    /* True from the moment the schedule bar's click was intercepted for
     * contact capture until the session ends — showFinalCTA uses it to
     * phrase the hand-off as "pick a time" (the visitor already declared
     * booking intent) instead of pitching the call as a next step. */
    var scheduleGatePending = false;

    /* ── FINAL CTA ──
     * skipIntro is true when the caller (goToContactStep, for an
     * already-fully-known lead) already delivered an equivalent
     * "here's the next step" line itself — avoids stacking two near-
     * identical sentences back to back. */
    function showFinalCTA(skipIntro) {
      step = 7; clearTimeout(idleTimer);
      /* Fire the conversion event as soon as the lead is captured rather
       * than waiting for a CTA click + send-lead round-trip (Andrew's
       * feedback: no dataLayer event appeared after giving phone/email).
       * Every fully-captured path converges here — typed steps 5/6 and the
       * volunteered-info shortcuts — so this is the single reliable hook.
       * Guarded on some contact info existing because the step-6 email
       * refusal path also lands here with nothing on file. leadTracked
       * inside trackLeadConversion keeps the later post-submit call (still
       * present as a safety net for any path that skips this function)
       * from double-firing. */
      if (lead.email || lead.phone) trackLeadConversion();
      hideInputBar();
      function renderCtaButtons() {
        var div = document.createElement('div'); div.className = 'cb-cta-btns'; div.id = 'cb-cta';
        var book = document.createElement('button'); book.className = 'cb-cta-primary'; book.textContent = 'Book a Google Meet';
        book.onclick = function () { handleCTA('Book a Google Meet'); trackScheduleClick(); window.open(CALENDLY_URL, '_blank'); };
        div.appendChild(book);
        /* "Send me info by email" only makes sense when an email is on
         * file (the user may have refused to give one, see the step-6
         * refusal handler above) — omitted rather than shown pointing at
         * a blank address. */
        if (lead.email) {
          var em = document.createElement('button'); em.className = 'cb-cta-secondary'; em.textContent = 'Send me info by email';
          em.onclick = function () { handleCTA('Send me info by email'); };
          div.appendChild(em);
        }
        msgs.appendChild(div); scrollToLatestBotMsg();
      }
      if (skipIntro) { renderCtaButtons(); return; }
      var ctaIntro = scheduleGatePending
        ? "Perfect, you're all set! Click below to pick a time that works for you."
        : contactFlowTone === 'soft'
          ? buildSoftClosingSummary()
          : "Awesome! Based on what you've shared, the best next step is a quick call or Google Meet to go over your project!";
      botReply(ctaIntro, renderCtaButtons, 1200);
    }

    /* Google Calendar CTA tracking (Andrew's feedback item 2): previously
     * the chatbot opened Google Calendar directly with no visibility into
     * how many visitors actually clicked through. Pushes a dedicated
     * chatbot_schedule_click event before navigating. Both CALENDLY_URL
     * entry points (the final "Book a Google Meet" button and the
     * persistent schedule bar) call this one function — a single
     * implementation, not two.
     *
     * Deliberately does NOT wait 150-250ms before navigating, despite that
     * being the originally requested pattern: that delay exists to protect
     * an in-flight analytics beacon from a same-tab page unload, which
     * doesn't apply here since both entry points open the calendar in a
     * NEW tab (window.open / target="_blank") — this tab is never
     * unloaded, so the push completes normally with zero race condition.
     * Browsers (Safari in particular, including all iOS browsers, which
     * are Safari under the hood) only treat window.open() as a genuine
     * user-initiated popup when it's called synchronously inside the click
     * handler — wrapping it in a setTimeout, even a couple hundred ms, is a
     * well-documented way to have it silently blocked. Pushing first and
     * opening in the same synchronous handler satisfies the actual
     * requirement (tracked before navigation) without risking the button
     * silently stopping working for a meaningful share of visitors. */
    function trackScheduleClick() {
      try {
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({
          event: 'chatbot_schedule_click',
          lead_source: 'chatbot',
          page: location.pathname,
          page_name: document.title
        });
      } catch (e) { /* tracking must never block navigation */ }
    }

    /* Capture-time visibility (Andrew's feedback): a dataLayer ping the
     * moment a phone/email lands in the lead object. Previously GTM saw
     * nothing until the visitor clicked a CTA button, so a visitor who
     * shared contact details and left produced zero events. Field value
     * itself is NOT included — the full contact set rides on the
     * formSubmission event; this one just marks that/when capture happened. */
    function trackContactCaptured(field) {
      try {
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({
          event: 'chatbot_contact_captured',
          field: field,
          lead_source: 'chatbot',
          page: location.pathname,
          page_name: document.title
        });
      } catch (e) { /* tracking must never interrupt the conversation */ }
    }

    function handleCTA(choice) {
      // Synchronous guard, checked before any other work — removing #cb-cta
      // from the DOM does NOT stop multiple synchronous clicks on the same
      // button reference from each running this handler to completion in
      // the same tick (e.g. a rapid double-click, or two pointer events
      // firing back to back), which without this would fire submitLead()
      // and the SendGrid request multiple times for one lead.
      if (ctaHandled) return;
      ctaHandled = true;
      var d = document.getElementById('cb-cta'); if (d) d.remove();
      addUserMsg(choice); lead.cta_choice = choice;
      inputEl.disabled = true; inputEl.placeholder = 'Chat complete';
      var sendBtn = document.querySelector('#cb-input-bar button');
      if (sendBtn) sendBtn.disabled = true;
      botReply(choice === 'Book a Google Meet'
        ? "Great! We're opening the calendar now. Pick a time that works for you." + (lead.email ? ' A confirmation will also be sent to ' + lead.email + '!' : '')
        : 'Perfect! We\'ll send everything over to ' + lead.email + ' shortly. Talk soon!');
      submitLead();
      /* Conversation reached its natural end (lead captured) — nothing
       * left to resume, so don't keep resurrecting this session on a
       * later visit. */
      clearSession();
    }

    /* ── SUBMIT ── */
    var DEBUG = /(^|[?&])cb_debug=1\b/.test(location.search);
    function logDebug() {
      if (!DEBUG) return;
      var args = ['[Demski Chatbot]'].concat(Array.prototype.slice.call(arguments));
      console.log.apply(console, args);
    }

    var LEAD_URL = (function () {
      if (API_BASE_OVERRIDE) return API_BASE_OVERRIDE + '/api/send-lead';
      try {
        var base = new URL(SCRIPT_EL.src, location.href).href.replace(/\/[^/]*$/, '/');
        return base + 'api/send-lead';
      } catch (e) {
        return '/api/send-lead';
      }
    })();

    /* Conversion tracking (Cosmoforge): pushed once per captured lead —
     * primarily at showFinalCTA (capture time), with a post-send-lead
     * safety-net call for any path that reaches submission without passing
     * through showFinalCTA. Same {event, inputs, formName}
     * shape as the site's forms (mirroring the old Elementor-form event) so
     * the GTM-W476LNT container's existing triggers fire unchanged, with
     * formName 'chatbot' to distinguish the source. Reads fbc/fbp/ga from
     * the _fbc/_fbp/_ga cookies (set by the pixels GTM loads); utm fields
     * and gclid come from the widget's own capture, gbraid from the same
     * URL-param store. Never throws, never blocks the conversation. */
    var leadTracked = false;
    function trackLeadConversion() {
      if (leadTracked) return;
      leadTracked = true;
      try {
        function cbCookie(cname) {
          try {
            var m = document.cookie.match(new RegExp('(?:^|; )' + cname + '=([^;]*)'));
            return m ? decodeURIComponent(m[1]) : '';
          } catch (e) { return ''; }
        }
        var t = (typeof window.__dgTracking === 'function' && window.__dgTracking()) || {};
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({
          event: 'formSubmission',
          formName: 'chatbot',
          inputs: {
            name: lead.name || '', email: lead.email || '', phone: lead.phone || '',
            company: lead.company || '',
            intent: lead.intent || '', intent_detail: lead.intent_detail || '',
            budget: lead.budget || '', project_notes: lead.project_notes || '',
            cta_choice: lead.cta_choice || '',
            page: lead.page || '', page_name: lead.page_name || '',
            gclid: lead.gclid || t.gclid || '',
            gbraid: fp.gbraid || t.gbraid || '',
            wbraid: t.wbraid || '',
            utm_campaign: lead.utm_campaign || t.utm_campaign || '',
            utm_medium: lead.utm_medium || t.utm_medium || '',
            utm_source: lead.utm_source || t.utm_source || '',
            utm_content: lead.utm_content || t.utm_content || '',
            utm_term: lead.utm_term || t.utm_term || '',
            fbclid: t.fbclid || '',
            fbc: t.fbc || cbCookie('_fbc') || '',
            fbp: t.fbp || cbCookie('_fbp') || '',
            ga: t.ga || cbCookie('_ga') || '',
            landing_page: t.landing_page || '',
            referrer: t.referrer || '',
            page_url: t.page_url || lead.page || ''
          }
        });
        logDebug('trackLeadConversion: dataLayer event pushed');
      } catch (e) { logDebug('trackLeadConversion failed (non-blocking):', e); }
    }

    var leadSubmitted = false;
    function submitLead() {
      /* One submission per session: the gated schedule bar and handleCTA
       * can both legitimately reach this for the same lead (bar click
       * with details on file, then a CTA button click) — without this
       * guard that meant duplicate notification/confirmation emails and a
       * duplicate Zapier event for one visitor. */
      if (leadSubmitted) return;
      leadSubmitted = true;
      /* gbraid/fbc/fbp/ga ride along in the lead payload so the server can
       * forward the full attribution set to the Zapier webhook. Same sources
       * as trackLeadConversion above: the site's __dgTracking helper when
       * present, falling back to the widget's own URL-param store (gbraid)
       * and the _fbc/_fbp/_ga cookies. Always strings, never throws. */
      var trk = {};
      try { trk = (typeof window.__dgTracking === 'function' && window.__dgTracking()) || {}; } catch (e) { trk = {}; }
      function leadCookie(cname) {
        try {
          var m = document.cookie.match(new RegExp('(?:^|; )' + cname + '=([^;]*)'));
          return m ? decodeURIComponent(m[1]) : '';
        } catch (e) { return ''; }
      }
      var p = {
        intent: lead.intent, intent_detail: lead.intent_detail,
        budget: lead.budget,
        project_notes: lead.project_notes,
        name: lead.name, phone: lead.phone, email: lead.email, company: lead.company, cta_choice: lead.cta_choice,
        page: lead.page, page_name: lead.page_name,
        utm_source: lead.utm_source, utm_campaign: lead.utm_campaign,
        utm_medium: lead.utm_medium, utm_term: lead.utm_term,
        utm_content: lead.utm_content, gclid: lead.gclid,
        gbraid: fp.gbraid || trk.gbraid || '',
        wbraid: trk.wbraid || '',
        fbclid: trk.fbclid || '',
        fbc: trk.fbc || leadCookie('_fbc') || '',
        fbp: trk.fbp || leadCookie('_fbp') || '',
        ga: trk.ga || leadCookie('_ga') || '',
        landing_page: trk.landing_page || '',
        referrer: trk.referrer || '',
        page_url: trk.page_url || lead.page || ''
      };
      logDebug('submitLead: POSTing payload to', LEAD_URL, p);
      fetch(LEAD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p)
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok || !data.ok) {
            throw new Error('Lead API responded ' + res.status + ': ' + (data.error ? JSON.stringify(data.error) : 'unknown error'));
          }
          logDebug('submitLead: success', data);
          trackLeadConversion();
        });
      }).catch(function (e) {
        console.warn('[Demski Chatbot] Lead send failed:', e.message || e);
        logDebug('submitLead: failure detail', e);
        botReply("Hmm, we couldn't confirm that email went through. Don't worry though, please call us at 406-936-3049 or email contact@demskigroup.com directly and we'll take care of you right away.");
      });
    }

    /* ── INPUT HANDLER ── */
    function handleInput() {
      if (aiRequestInFlight || handleInputInFlight) return;
      var val = inputEl.value.trim(); if (!val) return;
      /* Synchronous re-entrancy lock, separate from aiRequestInFlight
       * (which askAI sets later, after addUserMsg already ran). Enter
       * keypress + a Send-button click landing in the same tick — or a
       * user mashing Enter — would otherwise both pass the check above
       * and double-submit the same message before askAI ever sets its own
       * flag. Cleared once askAI's request actually starts (or immediately
       * if this submission never reaches askAI, e.g. step 4-7 free text). */
      handleInputInFlight = true;
      setTimeout(function () { handleInputInFlight = false; }, 0);
      inputEl.value = '';
      cancelTeaserFlow();
      cancelPendingMcqReveal();
      addUserMsg(val); resetIdleTimer();

      /* Layer 1 of exit-signal handling — fires BEFORE any AI call, ahead
       * of every other branch below, so a deferral ("I'll talk about it
       * later") never has a chance to reach the qualification-step
       * fallback logic that would otherwise re-append the current project
       * question right after acknowledging the visitor wants to stop. Only
       * applies while still in the qualification phase (step < 4) —
       * steps 4-6 have their own equivalent check alongside
       * looksLikeContactRefusal further down. */
      if (step < 4 && looksLikeExitSignal(val)) {
        chatHistory.push({ role: 'user', content: val });
        enterGracefulExitFlow();
        return;
      }

      /* LLM-first: every typed message on an MCQ step is sent straight to
       * the real AI with stepContext describing the current question and
       * its option shortcuts. The model answers/acknowledges what the user
       * actually said, then signals back whether that message already
       * answered the question (stepAnswered) and which option it maps to
       * (matchedOption, if any). Buttons are only re-shown when the
       * question is still genuinely unanswered AND the AI's own reply
       * didn't just ask its own new question (redirected) — never stacking
       * the original MCQ on top of a different question that needs an
       * answer first. */
      var noFollowUpDiv = document.getElementById('cb-no-followup');
      if (noFollowUpDiv) {
        var nfLocalMatch = localExactOptionMatch(val, NO_FOLLOWUP_OPTS);
        if (nfLocalMatch) { noFollowUpDiv.remove(); selectNoFollowUp(nfLocalMatch); return; }
        noFollowUpDiv.remove();
        askAI(val, false, function (reply, stepAnswered, matchedOption, redirected, collectContact, refused, needsOptions) {
          if (stepAnswered) {
            selectNoFollowUp(matchedOption || val);
          } else if (!redirected) {
            resumeStillOpen(reply, needsOptions, "What's one thing in your business that feels harder than it should be?", renderNoFollowUpButtons);
          }
          /* redirected: the AI's own reply already asked something new and
           * specific (e.g. for a name) — show no buttons, just wait for the
           * next typed message instead of stacking a second question.
           * collectContact/readyForContact are handled centrally inside
           * askAI's own response handler (before this callback ever runs),
           * which hands off to enterContactFlow() itself in that case. */
        }, { question: "What's one thing in your business that feels harder than it should be?", options: NO_FOLLOWUP_OPTS });
        return;
      }

      if (step === 0) {
        var s1existing = document.getElementById('cb-step1'); if (s1existing) s1existing.remove();
        var step0Opts = ['New startup or app idea', 'Software for my business', 'Digital marketing help', 'Just exploring'];
        var step0LocalMatch = localExactOptionMatch(val, step0Opts);
        if (step0LocalMatch) { step1Handler(step0LocalMatch, true); return; }
        askAI(val, false, function (reply, stepAnswered, matchedOption, redirected, collectContact, refused, needsOptions) {
          if (stepAnswered) {
            step1Handler(matchedOption || val, true);
          } else if (lead.intent) {
            /* Inference (applyInferredLeadInfo, run inside askAI before this
             * callback fires) independently set intent — resume wherever
             * the qualification flow should now be instead of asking for
             * something we already have. */
            advanceQualificationStep();
          } else if (!redirected) {
            resumeStillOpen(reply, needsOptions, 'What kind of project do you need help bringing to life?', renderStep0Buttons);
          }
        }, { question: 'What kind of project do you need help bringing to life?', options: step0Opts, hint: tentativeHints.intent || undefined });
        return;
      }

      if (step === 1) {
        var el = document.getElementById('cb-intent'); if (el) el.remove();
        var intentDetailOpts = INTENT_OPTIONS[lead.intent] || ['Mobile App', 'Web App', 'Something else'];
        var step1LocalMatch = localExactOptionMatch(val, intentDetailOpts);
        if (step1LocalMatch) { lead.intent_detail = step1LocalMatch; chatHistory.push({ role: 'user', content: val }); advanceQualificationStep(); return; }
        askAI(val, false, function (reply, stepAnswered, matchedOption, redirected, collectContact, refused, needsOptions) {
          if (stepAnswered) {
            lead.intent_detail = matchedOption || val; advanceQualificationStep();
          } else if (lead.intent_detail || lead.budget) {
            advanceQualificationStep();
          } else if (!redirected) {
            resumeStillOpen(reply, needsOptions, 'Can you tell me a bit more about what kind of ' + (lead.intent || 'project') + ' you need?', function () { showIntentOptions(lead.intent); });
          }
        }, { question: 'Can you tell me a bit more about what kind of ' + (lead.intent || 'project') + ' you need?', options: intentDetailOpts, hint: tentativeHints.intent || undefined });
        return;
      }

      if (step === 2) {
        var elB = document.getElementById('cb-budget'); if (elB) elB.remove();
        var budgetOpts = BUDGET_OPTIONS;
        var step2LocalMatch = localExactOptionMatch(val, budgetOpts);
        if (step2LocalMatch) { lead.budget = step2LocalMatch; chatHistory.push({ role: 'user', content: val }); showNotesStep(); return; }
        askAI(val, false, function (reply, stepAnswered, matchedOption, redirected, collectContact, refused, needsOptions) {
          if (stepAnswered) {
            lead.budget = matchedOption || val; showNotesStep();
          } else if (lead.budget) {
            showNotesStep();
          } else if (!redirected) {
            resumeStillOpen(reply, needsOptions, BUDGET_QUESTION, renderBudgetButtons);
          }
        }, { question: BUDGET_QUESTION, options: budgetOpts, hint: tentativeHints.budget || undefined });
        return;
      }

      /* Step 3: optional notes free text. Previously this step treated
       * EVERY typed message as project-notes content and advanced
       * immediately, with no detour handling at all — unlike steps 0-2,
       * which are LLM-first. That's exactly why a genuine question typed
       * here ("I want to know about andrew", "what services do you
       * offer?") got silently swallowed into lead.project_notes and the
       * flow advanced straight to "What's your name?" without ever
       * answering it: the question was never even sent to the AI. Now
       * LLM-first like steps 0-2: the model answers/acknowledges what was
       * actually typed, then signals via stepAnswered whether that message
       * was genuine project-notes content (free text, so there's no fixed
       * option list to map to, hence no local-exact-option-match pre-check
       * the way steps 0-2 have) or something else entirely that still
       * needs a real answer before this step can advance. */
      if (step === 3) {
        var elS = document.getElementById('cb-notes-skip'); if (elS) elS.remove();
        askAI(val, false, function (reply, stepAnswered, matchedOption, redirected, collectContact) {
          if (collectContact) {
            enterContactFlow();
          } else if (stepAnswered) {
            /* The user's own description of their project/pain points —
             * exactly the kind of detail that should be remembered and
             * referenced later. askAI already pushed val into chatHistory
             * (silent=false), so only lead.project_notes needs setting
             * here. introMsg is '' (not the old fixed "Thanks, this helps
             * a lot!"): the AI's own reply just acknowledged the notes
             * content naturally, and goToContactStep('') is the same
             * no-redundant-intro convention enterContactFlow already uses
             * for "AI already replied, now ask the next required field". */
            lead.project_notes = val;
            goToContactStep('');
          } else if (!redirected) {
            /* Not notes content, and the AI's own reply didn't ask a new
             * question of its own (e.g. it just answered a factual
             * question like "who is andrew") — resume this same step by
             * re-showing the Skip button, without re-asking the notes
             * question itself or advancing the state machine. */
            renderNotesSkipButton();
          }
          /* redirected: the AI's own reply already asked something new and
           * specific — show no buttons, just wait for the next typed
           * message, same convention as steps 0-2. */
        }, { question: NOTES_QUESTION });
        return;
      }

      /* An explicit name refusal or hostile dismissal ("shut up") is
       * checked BEFORE the shape-based detour below, same as phone/email —
       * without this, a refusal phrased in more than 4 words (e.g. "I don't
       * want to mention it") never reaches isValidName at all (it fails
       * looksLikeNameAttempt's word-count gate first) and instead loops
       * through the blind AI detour forever, and a SHORT hostile dismissal
       * ("shut up") was passing every shape check and getting accepted as
       * the literal name. */
      /* looksLikeExitSignal is treated the same as a refusal here — "I have
       * to go" while being asked for a name should skip/fall back exactly
       * like "I won't tell you my name" would, not re-ask the question. */
      if (step === 4 && (looksLikeContactRefusal(val) || looksLikeExitSignal(val))) {
        chatHistory.push({ role: 'user', content: val });
        resolveNameRefusal();
        return;
      }
      /* Step 4 (name) now uses the same shape-based detour check as
       * phone/email (looksLikeNameAttempt) instead of isOffTopic's narrow
       * keyword denylist — a real question like "who is andrew" contains
       * none of isOffTopic's keywords (price/cost/services/help/contact),
       * so it used to fall straight through into isValidName() and got
       * flatly rejected as a refusal, with the actual question never
       * answered. Now any message that isn't name-shaped (a question, a
       * multi-clause sentence, "I have one question before I tell you my
       * name who is andrew") is answered by the AI first, then the name
       * prompt resumes in the same bubble.
       *
       * stepContext is passed here (and on the phone/email detours below)
       * specifically so the AI can return [[REFUSED]] for refusal/hostile
       * phrasing the local looksLikeContactRefusal() regex doesn't
       * recognize — a second, language-understanding line of defense
       * behind a necessarily finite local pattern list, instead of relying
       * on that list alone to anticipate every possible phrasing. */
      if (step === 4 && !looksLikeNameAttempt(val)) {
        askAI(val, false, function (reply, stepAnswered, matchedOption, redirected, collectContact, refused) {
          if (reply === null) return; /* error path already showed a message */
          if (refused) { resolveNameRefusal(reply); return; }
          /* The name may have been volunteered inside this very detour
           * message (e.g. "I'm Akash, quick question first...") and already
           * captured by applyInferredLeadInfo inside askAI, above — resume
           * with whatever's still actually needed instead of asking for a
           * name we already have. */
          if (lead.name) { advanceFromContactStep(reply); return; }
          var nameQ = nameQuestion();
          if (!appendResumeLineToLastBotMsg(reply, nameQ)) botReply(nameQ);
        }, { question: "What's your name?" });
        return;
      }
      /* An explicit refusal ("I don't want to give my phone number") is
       * checked BEFORE the generic detour branch below — without this it
       * fell into that branch, the AI acknowledged the refusal, and the
       * widget then steered back to the still-open phone step exactly like
       * any other detour, re-asking for the very thing just refused. A
       * refusal instead skips the field outright (lead.phone stays empty)
       * and advances straight to the next field in the series, the same
       * way a valid answer would, just with nothing recorded. */
      if (step === 5 && (looksLikeContactRefusal(val) || looksLikeExitSignal(val))) {
        chatHistory.push({ role: 'user', content: val });
        resolvePhoneRefusal();
        return;
      }
      if (step === 5 && !looksLikePhoneAttempt(val)) {
        /* Doesn't look like a phone number at all — treat as a genuine
         * conversational detour (a question, "wait", etc.) rather than
         * validating it as one. Answer naturally via the AI, then return
         * to the still-active phone step instead of re-asking immediately
         * with no acknowledgment of what was just said. Always appended to
         * the SAME bubble as the AI's answer (one consultant voice
         * continuing its own sentence) rather than opening a second,
         * disconnected bot message. */
        askAI(val, false, function (reply, stepAnswered, matchedOption, redirected, collectContact, refused) {
          if (reply === null) return;
          if (refused) { resolvePhoneRefusal(reply); return; }
          if (lead.phone) { advanceFromContactStep(reply); return; }
          appendResumeLineToLastBotMsg(reply, phoneQuestion());
        }, { question: "What's the best phone number to reach you?" });
        return;
      }
      /* Same refusal short-circuit for email. Unlike phone, email can't
       * just be silently skipped: it's the only contact channel send-lead.js
       * requires to deliver the lead at all (api/send-lead.js still rejects
       * a submission with no email), so this offers the next-best
       * alternative instead of repeating the question — a phone callback
       * if a phone number is already on file, or direct contact info if
       * not — then moves on to the final step rather than looping. */
      if (step === 6 && (looksLikeContactRefusal(val) || looksLikeExitSignal(val))) {
        chatHistory.push({ role: 'user', content: val });
        resolveEmailRefusal();
        return;
      }
      if (step === 6 && !looksLikeEmailAttempt(val)) {
        askAI(val, false, function (reply, stepAnswered, matchedOption, redirected, collectContact, refused) {
          if (reply === null) return;
          if (refused) { resolveEmailRefusal(reply); return; }
          if (lead.email) { advanceFromContactStep(reply); return; }
          appendResumeLineToLastBotMsg(reply, emailQuestion());
        }, { question: "What's the best email address to reach you?" });
        return;
      }
      if (step === 4) {
        if (!isValidName(val)) {
          /* A refusal-shaped message that slipped past looksLikeContactRefusal
           * above (e.g. one of isValidName's own refusal phrases that isn't
           * also in looksLikeContactRefusal's list) still gets routed through
           * the same acknowledge-then-fallback flow instead of repeating
           * this generic rejection forever — anything else invalid (a typo,
           * an email/phone typed into the name field) just gets asked again,
           * since that's a format problem the user can correct, not a
           * refusal that needs a fallback. */
          if (looksLikeContactRefusal(val)) { resolveNameRefusal(); return; }
          botReply("That's completely fine. We usually ask for a name so our team knows who they're speaking with. If you'd prefer not to share it, you can provide a first name, nickname, or business name instead.");
          return; /* stays on step 4 — never advances to phone on an invalid/refused name */
        }
        lead.name = val;
        /* Pushed into chatHistory (not just lead.name) so the AI actually
         * has this fact available on every later request — without this,
         * the model has no way to know the user's name even though the
         * widget's own lead object does, producing exactly the "I don't
         * have any information about you" bug when later asked "do you
         * know me?". Same reasoning applies to phone/email/notes below. */
        chatHistory.push({ role: 'user', content: val });
        /* Phone/email may already be on file from an earlier detour that
         * volunteered them (applyInferredLeadInfo) — ask only whatever's
         * actually still missing instead of always assuming phone is next. */
        if (lead.phone && lead.email) {
          step = 7;
          var nameReplyDone = 'Nice to meet you, ' + val + "! I've already got the rest of your details, let's get you booked in.";
          chatHistory.push({ role: 'assistant', content: nameReplyDone });
          botReply(nameReplyDone, function () { showFinalCTA(true); });
        } else {
          step = lead.phone ? 6 : 5;
          var nextQ = lead.phone ? emailQuestion() : phoneQuestion();
          var nameReply = 'Nice to meet you, ' + val + '! ' + nextQ;
          chatHistory.push({ role: 'assistant', content: nameReply });
          botReply(nameReply);
        }
        return;
      }
      if (step === 5) {
        var digits = val.replace(/\D/g, '');
        if (digits.length < 7) { botReply("That doesn't look like a valid phone number. Could you double-check?"); return; }
        lead.phone = val;
        trackContactCaptured('phone');
        chatHistory.push({ role: 'user', content: val });
        if (lead.email) {
          step = 7;
          var phoneReplyDone = "Got it! I've already got your email on file too, let's get you booked in.";
          chatHistory.push({ role: 'assistant', content: phoneReplyDone });
          botReply(phoneReplyDone, function () { showFinalCTA(true); });
        } else {
          step = 6;
          var phoneReply = "Got it! " + emailQuestion();
          chatHistory.push({ role: 'assistant', content: phoneReply });
          botReply(phoneReply);
        }
        return;
      }
      if (step === 6) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) { botReply("That doesn't look right. Could you double-check your email address?"); return; }
        lead.email = val;
        trackContactCaptured('email');
        chatHistory.push({ role: 'user', content: val });
        showFinalCTA(); return;
      }

      /* Step 7: lead already fully captured, CTA buttons are showing. The
       * user can still type here (the input bar is never hidden), so a
       * message like "I forgot to enter my actual email" must be handled
       * as a correction to the data already on file, not fed into normal
       * qualification/AI chat — there's no qualification question left to
       * answer, and restarting one would be exactly the bug this fixes.
       * submitLead() itself isn't re-called here: it only ever fires once
       * the user clicks a CTA button (handleCTA), and the input is
       * disabled the instant that happens, so any correction necessarily
       * happens before that real submission and is picked up by it. */
      if (step === 7) {
        if (correctingField && correctingField !== 'pending-field-name') {
          var field = correctingField;
          if (field === 'email') {
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) { botReply("That doesn't look right. Could you double-check your email address?"); return; }
            lead.email = val;
          } else if (field === 'phone') {
            var correctedDigits = val.replace(/\D/g, '');
            if (correctedDigits.length < 7) { botReply("That doesn't look like a valid phone number. Could you double-check?"); return; }
            lead.phone = val;
          } else if (field === 'name') {
            if (!isValidName(val)) { botReply("That's completely fine. We usually ask for a name so our team knows who they're speaking with. If you'd prefer not to share it, you can provide a first name, nickname, or business name instead."); return; }
            lead.name = val;
          }
          correctingField = null;
          var fieldLabel = field === 'email' ? 'email' : field === 'phone' ? 'phone number' : 'name';
          botReply("Perfect, I've updated your " + fieldLabel + " to " + val + ". Our team will use that going forward.");
          return;
        }

        var correctionTarget = detectContactCorrection(val);
        if (correctionTarget !== null) {
          if (correctionTarget === '') {
            /* Correction intent detected but no field named — ask which one,
             * and remember we're now waiting on that answer specifically
             * (not a free-text field name, an explicit follow-up choice). */
            correctingField = 'pending-field-name';
            botReply('No problem! Which detail would you like to update: your name, phone number, or email?');
            return;
          }
          correctingField = correctionTarget;
          var askLabel = correctionTarget === 'email' ? 'email address' : correctionTarget === 'phone' ? 'phone number' : 'name';
          botReply('No problem. What\'s the correct ' + askLabel + " you'd like us to use?");
          return;
        }

        /* Already mid-correction-flow waiting on which field, and the
         * model-free keyword check above didn't catch a direct field
         * mention (e.g. user just replied "email") - check once more on
         * its own here so "Which detail..." -> "email" works naturally. */
        if (correctingField === 'pending-field-name') {
          var lowerVal = val.toLowerCase();
          if (/email/.test(lowerVal)) { correctingField = 'email'; botReply("Got it. What's the correct email address you'd like us to use?"); return; }
          if (/phone|number/.test(lowerVal)) { correctingField = 'phone'; botReply("Got it. What's the correct phone number you'd like us to use?"); return; }
          if (/name/.test(lowerVal)) { correctingField = 'name'; botReply("Got it. What's the correct name you'd like us to use?"); return; }
          botReply('Just to confirm, would you like to update your name, phone number, or email?');
          return;
        }

        /* No correction intent recognized — the lead is already captured,
         * so there's no qualification question left to advance (unlike
         * steps 0-2) and therefore no stepContext to send. Without
         * stepContext, formatStepContext appends no marker instructions, so
         * the server never asks for one and the model just replies in
         * plain natural text. This is the same shape as the free-chat call
         * after the teaser's typed-text path (openFromTeaser's
         * `askAI(prefillText, false)`), reused here for the same reason:
         * a normal conversational turn with no qualification step
         * attached. SYSTEM_PROMPT's own "never ask for name/phone/email
         * yourself" rule (api/chat.js) already prevents the model from
         * re-collecting contact info on this path same as every other
         * step, and the model can see the lead's name/phone/email already
         * sitting in chatHistory from when each was originally collected.
         * askAI renders the reply itself via addBotMsg, so nothing further
         * is needed after the call. This replaces the old hardcoded
         * "Thanks for the message..." fallback that fired identically for
         * every message regardless of content, the bug reported in QA. */
        askAI(val, false);
        return;
      }
    }

    /* ── RESTART / RESET ──
     * QA feedback (Aditya Tupe report): once a visitor got stuck deep in
     * the conversation (or past lead capture), there was no way to start
     * over short of scrolling back up or reloading the whole host page.
     * This clears everything qualification-related (step, lead answers,
     * chatHistory, transcript, in-flight correction/refusal state, the
     * ctaHandled guard) and re-renders the exact same intro bubble + step-0
     * buttons the widget shows on a first-ever load, then persists that
     * fresh state as a new session so a refresh afterward resumes the NEW
     * conversation, not the cleared one. UTM/page attribution on `lead` is
     * intentionally left untouched, only the visitor's own answers reset,
     * since that data describes how they arrived, not what they've said. */
    function resetConversation() {
      if (!window.confirm('Start a new conversation? This will clear your current chat.')) return;
      clearSession();
      clearTimeout(idleTimer);
      awaitingIdleResponse = false;
      idleReminderShown = false;
      correctingField = null;
      nameRefusalAcknowledged = false;
      contactFlowTone = 'default';
      tentativeHints.intent = ''; tentativeHints.budget = '';
      ctaHandled = false;
      aiRequestInFlight = false;
      handleInputInFlight = false;
      step = 0;
      chatHistory = [];
      transcript = [];
      lead.intent = ''; lead.intent_detail = ''; lead.budget = ''; lead.project_notes = '';
      lead.name = ''; lead.phone = ''; lead.email = ''; lead.company = ''; lead.cta_choice = '';

      msgs.innerHTML = '';
      addBotMsg('Hello! What kind of project do you need help bringing to life?');
      renderStep0Buttons();

      inputEl.disabled = false;
      inputEl.placeholder = 'Type your answer...';
      var sendBtn = document.querySelector('#cb-input-bar button');
      if (sendBtn) sendBtn.disabled = false;
      showInputBar();
      resetIdleTimer();
    }

    /* ── WIRE UP DOM EVENTS ── */
    document.getElementById('cb-close-compact').onclick  = toggleBot;
    document.getElementById('cb-close-expanded').onclick = toggleBot;
    document.getElementById('cb-restart-compact').onclick  = resetConversation;
    document.getElementById('cb-restart-expanded').onclick = resetConversation;
    document.getElementById('bot-launcher').onclick      = launcherClick;
    document.getElementById('bot-launcher').onkeydown    = function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); launcherClick(); }
    };
    document.getElementById('cb-backdrop').onclick       = toggleBot;
    document.getElementById('cb-send').onclick           = handleInput;
    inputEl.addEventListener('keypress', function (e) { if (e.key === 'Enter') handleInput(); });

    var s1btns = document.querySelectorAll('#cb-step1 [data-step1]');
    for (var i = 0; i < s1btns.length; i++) {
      (function (btn) {
        btn.onclick = function () { step1Handler(btn.getAttribute('data-step1')); };
      })(s1btns[i]);
    }

    /* Restore a prior session (if any) before the launcher/teaser flow
     * decides what to show — must run before launch() so a returning
     * mid-conversation visitor never sees the teaser card flash in. */
    restoreSession();

    /* ── LAUNCH ── */
    function launch() {
      var launcher = document.getElementById('bot-launcher');
      launcher.style.display = 'flex';
      setTimeout(function () { if (!expanded) showGreetingCard(); }, 800);
      setTimeout(function () {
        launcher.classList.add('cb-launcher-visible');
      }, 1800);
    }

    // Use DOMContentLoaded so the launcher appears fast (~1.5s total),
    // without waiting for all images/fonts to finish loading.
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { setTimeout(launch, 700); });
    } else {
      setTimeout(launch, 700);
    }
  }

  if (document.body) {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();
