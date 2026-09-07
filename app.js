// Slug generation for app deep links
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/\+/g, 'plus')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// DOM Elements
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const themeToggle = document.getElementById('theme-toggle');
const statsSection = document.getElementById('stats-section');
const resultsSection = document.getElementById('results-section');
const resultsGrid = document.getElementById('results');
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const errorMessage = document.getElementById('error-message');
const welcomeEl = document.getElementById('welcome');
const noResultsEl = document.getElementById('no-results');
const retryBtn = document.getElementById('retry-btn');
const adBanner = document.getElementById('ad-banner');
const mobileStickyAd = document.getElementById('mobile-sticky-ad');

// Filter elements
const filterType = document.getElementById('filter-type');
const trustOfficial = document.getElementById('trust-official');
const trustDeveloper = document.getElementById('trust-developer');
const trustCommunity = document.getElementById('trust-community');
const filterPal = document.getElementById('filter-pal');
const filterSize = document.getElementById('filter-size');
const filterDate = document.getElementById('filter-date');
const filterSort = document.getElementById('filter-sort');
const clearFiltersBtn = document.getElementById('clear-filters');

// Ad insertion interval (show ad after every N cards)
// DISABLED: Set to 0 to disable in-feed ads until AdSense is approved
const AD_INTERVAL = 0; // Change to 8 to enable

// Stats elements
const statSources = document.getElementById('stat-sources');
const statApps = document.getElementById('stat-apps');
const statMatches = document.getElementById('stat-matches');
const statTime = document.getElementById('stat-time');

// Anonymous client ID for per-user trending dedup (no personal data)
function getSearchId() {
  let id = localStorage.getItem('search_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('search_id', id);
  }
  return id;
}
const searchId = getSearchId();

// State
let currentQuery = '';
let searchTimeout = null;
let lastResults = []; // Store results for re-filtering
let currentPage = 1;
let totalPages = 1;
let isLoading = false;

// Client-side search index
let searchIndex = null;
let searchIndexLoading = false;

async function loadSearchIndex() {
  if (searchIndex) return searchIndex;
  if (searchIndexLoading) {
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (searchIndex) { clearInterval(check); resolve(searchIndex); }
      }, 100);
    });
  }
  searchIndexLoading = true;

  const manifestResp = await fetch('https://ipasearch.xyz/search-index.json');
  if (!manifestResp.ok) throw new Error(`Failed to load search index manifest: ${manifestResp.status}`);
  const manifest = await manifestResp.json();

  const chunkPromises = [];
  for (let i = 0; i < manifest.chunks; i++) {
    chunkPromises.push(
      fetch(`https://ipasearch.xyz/search-index-${i}.json`).then(r => r.json())
    );
  }

  const chunks = await Promise.all(chunkPromises);
  searchIndex = chunks.flat();
  searchIndexLoading = false;

  return searchIndex;
}

function localSearch(query) {
  const apps = searchIndex || [];
  const queryLower = query ? query.toLowerCase() : '';
  const queryNoSpaces = queryLower.replace(/\s+/g, '');

  if (!queryLower) return apps.map(a => ({ ...a, _matchType: 'exact' }));

  const results = [];
  for (const app of apps) {
    const name = (app.name || '').toLowerCase();
    const bundleId = (app.bundleIdentifier || app.bundleID || '').toLowerCase();
    const description = (app.localizedDescription || app.description || '').toLowerCase();
    const developer = (app.developerName || app.developer || '').toLowerCase();
    const subtitle = (app.subtitle || '').toLowerCase();

    const exactMatch =
      name.includes(queryLower) ||
      bundleId.includes(queryLower) ||
      description.includes(queryLower) ||
      developer.includes(queryLower) ||
      subtitle.includes(queryLower);

    const nameNoSpaces = name.replace(/\s+/g, '');
    const normalizedMatch = !exactMatch && (
      nameNoSpaces.includes(queryNoSpaces) ||
      bundleId.replace(/\s+/g, '').includes(queryNoSpaces)
    );

    if (exactMatch || normalizedMatch) {
      results.push({
        ...app,
        _matchType: exactMatch ? 'exact' : 'normalized'
      });
    }
  }
  return results;
}

// Theme Management
function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  if (savedTheme) {
    document.documentElement.setAttribute('data-theme', savedTheme);
  } else if (prefersDark) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
}

// Search Functions
async function performSearch(query, page = 1, { track = false } = {}) {
  if (isLoading) return;

  currentQuery = query ? query.trim() : '';
  currentPage = page;
  isLoading = true;
  showLoading();

  const startTime = performance.now();

  try {
    if (!searchIndex) {
      showLoading();
      await loadSearchIndex();
      showLoading();
    }

    let allResults = localSearch(currentQuery);

    // Apply trust filter
    const trustLevels = [];
    if (trustOfficial?.checked) trustLevels.push('official');
    if (trustDeveloper?.checked) trustLevels.push('developer');
    if (trustCommunity?.checked) trustLevels.push('community');
    if (trustLevels.length > 0) {
      allResults = allResults.filter(app => {
        const appTrust = app._source?.trust?.tier;
        return appTrust && trustLevels.includes(appTrust);
      });
    }

    // Apply PAL filter
    if (filterPal?.checked) {
      allResults = allResults.filter(app => app._source?.pal);
    }

    // Sort by relevance
    allResults = sortResults(allResults, currentQuery);

    const endTime = performance.now();
    const searchTime = Math.round(endTime - startTime);

    // Pagination
    const limit = 50;
    const totalResults = allResults.length;
    const newTotalPages = Math.ceil(totalResults / limit);
    totalPages = newTotalPages;
    const startIndex = (page - 1) * limit;
    const paginatedResults = allResults.slice(startIndex, startIndex + limit);

    // Update stats
    updateStats({
      totalApps: searchIndex ? searchIndex.length : 0,
      matchedApps: totalResults
    }, searchTime);

    // Display results
    if (paginatedResults.length > 0) {
      displayResults(paginatedResults);
      updatePagination({
        page,
        totalPages: newTotalPages,
        totalResults
      });
    } else {
      showNoResults();
      hidePagination();
    }

    // Track search query (fire-and-forget, only on explicit user actions)
    if (track && query && query.length >= 2) {
      fetch('https://ipasearch.xyz/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, clientId: searchId })
      }).catch(() => {});
    }

  } catch (error) {
    console.error('Search error:', error);
    showError(error.message);
  } finally {
    isLoading = false;
  }
}

// Sort results by relevance + trust boost
function sortResults(results, query) {
  const q = query ? query.toLowerCase() : '';
  const qNoSpaces = q.replace(/\s+/g, '');

  const getAppDate = (app) => {
    let dateStr = app.versionDate || app.date;
    if (!dateStr && app.versions && app.versions.length > 0) {
      dateStr = app.versions[0].date || app.versions[0].versionDate;
    }
    return dateStr ? new Date(dateStr) : null;
  };

  const getTrustBoost = (app) => {
    switch (app._source?.trust?.tier) {
      case 'official': return 15;
      case 'developer': return 10;
      case 'community': return 5;
      default: return 0;
    }
  };

  const getRelevance = (app) => {
    if (!q) return getTrustBoost(app);
    const name = (app.name || '').toLowerCase();
    const nameNoSpaces = name.replace(/\s+/g, '');
    const bundleId = (app.bundleIdentifier || app.bundleID || '').toLowerCase();
    const description = (app.localizedDescription || app.description || '').toLowerCase();

    let score = 0;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 90;
    else if (name.includes(q)) score = 80;
    else if (bundleId.includes(q)) score = 70;
    else if (description.includes(q)) score = 40;
    else if (nameNoSpaces === qNoSpaces) score = 60;
    else if (nameNoSpaces.startsWith(qNoSpaces)) score = 50;
    else if (nameNoSpaces.includes(qNoSpaces)) score = 35;
    return score + getTrustBoost(app);
  };

  return results.sort((a, b) => {
    const scoreA = getRelevance(a);
    const scoreB = getRelevance(b);
    if (scoreB !== scoreA) return scoreB - scoreA;
    const dateA = getAppDate(a);
    const dateB = getAppDate(b);
    if (!dateA && !dateB) return 0;
    if (!dateA) return 1;
    if (!dateB) return -1;
    return dateB - dateA;
  });
}

function updateStats(stats, searchTime) {
  statsSection.classList.remove('hidden');
  statSources.textContent = searchIndex ? searchIndex.length.toLocaleString() : '...';
  statApps.textContent = stats.totalApps.toLocaleString();
  statMatches.textContent = stats.matchedApps.toLocaleString();
  statTime.textContent = `${searchTime}ms`;
}

function displayResults(results, isFiltered = false) {
  hideAllStates();
  resultsGrid.innerHTML = '';

  // Store original results for re-filtering (only if not already filtered)
  if (!isFiltered) {
    lastResults = results;
  }

  // Apply filters
  const filteredResults = applyFilters(results);

  if (filteredResults.length === 0) {
    showNoResults();
    return;
  }

  // Update stats to show filtered count (only if filters are actually active)
  if (statMatches && isFiltered) {
    const filters = getActiveFilters();
    const hasActiveFilters = filters.type || filters.trust.length > 0 || filters.pal || filters.size || filters.date;
    if (hasActiveFilters) {
      statMatches.textContent = `${filteredResults.length} (filtered)`;
    } else {
      statMatches.textContent = filteredResults.length.toLocaleString();
    }
  }

  filteredResults.forEach((app, index) => {
    const card = createAppCard(app);
    resultsGrid.appendChild(card);

    // Insert in-feed ad after every AD_INTERVAL cards (but not after last batch)
    // Only if AD_INTERVAL > 0 (ads are enabled)
    if (AD_INTERVAL > 0 && (index + 1) % AD_INTERVAL === 0 && index < filteredResults.length - 1) {
      const adElement = createInFeedAd();
      resultsGrid.appendChild(adElement);
    }
  });

  resultsGrid.classList.remove('hidden');

  // Show bottom ad banner
  if (adBanner) adBanner.classList.remove('hidden');

  // Show mobile sticky ad
  showMobileStickyAd();
}

function createInFeedAd() {
  const adDiv = document.createElement('div');
  adDiv.className = 'ad-in-feed';
  adDiv.innerHTML = `
    <div class="ad-placeholder">
      <ins class="adsbygoogle"
           style="display:inline-block;width:728px;height:90px"
           data-ad-client="ca-pub-XXXXXXXXXXXXXXXX"
           data-ad-slot="XXXXXXXXXX"></ins>
      <span class="ad-label">Advertisement</span>
    </div>
  `;
  // Try to load the ad (won't work without real AdSense)
  try {
    (adsbygoogle = window.adsbygoogle || []).push({});
  } catch (e) {}
  return adDiv;
}

function showMobileStickyAd() {
  if (mobileStickyAd && window.innerWidth <= 768) {
    mobileStickyAd.classList.remove('hidden');
    document.body.classList.add('has-sticky-ad');
  }
}

function closeStickyAd() {
  if (mobileStickyAd) {
    mobileStickyAd.classList.add('hidden');
    document.body.classList.remove('has-sticky-ad');
  }
}

// Make closeStickyAd available globally
window.closeStickyAd = closeStickyAd;

function createAppCard(app) {
  const card = document.createElement('div');
  card.className = 'app-card';
  card.style.cursor = 'pointer';

  // Store app data for modal
  card.addEventListener('click', (e) => {
    // Don't open modal if clicking on buttons/links/arrow
    if (e.target.closest('.download-btn') || e.target.closest('.copy-btn') || e.target.closest('.card-detail-arrow')) return;
    openModal(app);
  });

  const defaultIcon = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23667" width="100" height="100" rx="22"/><text x="50" y="65" text-anchor="middle" font-size="36" fill="white">?</text></svg>';
  const iconUrl = sanitizeUrl(app.iconURL || app.icon) || defaultIcon;
  const name = escapeHtml(app.name || 'Unknown App');
  const developer = escapeHtml(app.developerName || app.developer || '');
  const version = app.version ? escapeHtml(app.version) : null;
  const rawDescription = app.localizedDescription || app.description || app.subtitle || '';
  const description = escapeHtml(cleanDescription(rawDescription));
  const bundleId = escapeHtml(app.bundleIdentifier || app.bundleID || '');
  const sourceName = escapeHtml(app._source?.name || 'Unknown Source');
  // Get download URL (check top-level and versions array)
  let downloadUrl = app.downloadURL || app.download;
  if (!downloadUrl && app.versions && app.versions.length > 0) {
    downloadUrl = app.versions[0].downloadURL || app.versions[0].download;
  }
  downloadUrl = sanitizeUrl(downloadUrl) || '#';
  const appType = app._detectedType || detectAppType(app);
  const typeBadge = getTypeBadgeHtml(appType);
  const trustInfo = app._source?.trust;
  const trustBadge = getTrustBadgeHtml(trustInfo);
  const palBadge = app._source?.pal ? '<span class="trust-badge trust-pal" title="Available via AltStore PAL (EU)">PAL</span>' : '';

  // Get date (check versions array too)
  let dateStr = app.versionDate || app.date;
  if (!dateStr && app.versions && app.versions.length > 0) {
    dateStr = app.versions[0].date || app.versions[0].versionDate;
  }
  const dateDisplay = dateStr ? formatDate(dateStr) : null;

  // Get size
  let sizeBytes = app.size;
  if (!sizeBytes && app.versions && app.versions.length > 0) {
    sizeBytes = app.versions[0].size;
  }
  const sizeDisplay = sizeBytes ? formatSize(sizeBytes) : null;

  // Highlight matching text
  const highlightedName = highlightText(name, currentQuery);
  const highlightedDescription = description ? highlightText(description, currentQuery) : '';

  // Build meta info line
  const metaItems = [];
  if (version) metaItems.push(`<span class="meta-item meta-version">v${version}</span>`);
  if (dateDisplay) metaItems.push(`<span class="meta-item">${dateDisplay}</span>`);
  if (sizeDisplay) metaItems.push(`<span class="meta-item">${sizeDisplay}</span>`);
  const metaInfoHtml = metaItems.length > 0 ? `<div class="app-meta-info">${metaItems.join('<span class="meta-sep">•</span>')}</div>` : '';

  // Prefer name-based slug for clean URLs; bundleId slug registered as fallback in Redis
  const appSlug = slugify(app.name || '') || slugify(app.bundleIdentifier || app.bundleID || '');
  const appPageUrl = appSlug ? `/app/${appSlug}` : '#';

  const safeSourceUrl = escapeAttr(sanitizeUrl(app._source?.url) || '');

  card.innerHTML = `
    <a href="${escapeAttr(appPageUrl)}" class="card-detail-arrow" target="_blank" rel="noopener noreferrer" title="Open full page">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M4 1.5h8.5V10M12.5 1.5L1.5 12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </a>
    <div class="app-header">
      <img class="app-icon" src="${escapeAttr(iconUrl)}" alt="${escapeAttr(name)}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23667%22 width=%22100%22 height=%22100%22 rx=%2222%22/><text x=%2250%22 y=%2265%22 text-anchor=%22middle%22 font-size=%2236%22 fill=%22white%22>?</text></svg>'">
      <div class="app-info">
        <div class="app-name"><a href="${escapeAttr(appPageUrl)}" class="app-name-link" title="View app page">${highlightedName}</a>${typeBadge}</div>
        ${developer ? `<div class="app-developer">${developer}</div>` : ''}
        ${metaInfoHtml}
      </div>
    </div>
    ${highlightedDescription ? `<p class="app-description">${highlightedDescription}</p>` : ''}
    <div class="app-meta">
      ${bundleId ? `<div class="app-bundle">${bundleId}</div>` : ''}
      <div class="app-source">${sourceName}${trustBadge}${palBadge}</div>
      <div class="app-actions">
        <a href="${escapeAttr(downloadUrl)}" class="download-btn" target="_blank" rel="noopener noreferrer">Download</a>
        <button class="copy-btn" data-copy-url="${safeSourceUrl}" title="Copy Source URL">Copy Source</button>
      </div>
    </div>
  `;

  const downloadBtn = card.querySelector('.download-btn');
  const copyBtn = card.querySelector('.copy-btn');

  downloadBtn.addEventListener('click', (e) => {
    e.stopPropagation();

    if (downloadBtn.getAttribute('href') === '#') {
      e.preventDefault();
      showButtonFeedback(downloadBtn, 'Unavailable', 1400);
      return;
    }

    showButtonFeedback(downloadBtn, 'Opening...', 900);
  });

  copyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    copyToClipboard(e.currentTarget.dataset.copyUrl, e.currentTarget);
  });

  // App name click opens modal (href kept for right-click/middle-click)
  card.querySelector('.app-name-link').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openModal(app);
  });

  return card;
}

function cleanDescription(text) {
  if (!text) return '';
  // Remove "from @username | ----" patterns
  let cleaned = text.replace(/^from\s+@[\w]+\s*\|\s*[-]+\s*/gi, '');
  // Remove leading dashes and newlines
  cleaned = cleaned.replace(/^[-\s\n]+/, '');
  // Remove markdown-style headers
  cleaned = cleaned.replace(/^#+\s*/gm, '');
  // Collapse multiple newlines
  cleaned = cleaned.replace(/\n{2,}/g, ' ');
  // Collapse multiple spaces
  cleaned = cleaned.replace(/\s{2,}/g, ' ');
  return cleaned.trim();
}

function formatDate(dateStr) {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return null;
  }
}

function formatSize(bytes) {
  if (!bytes || bytes <= 0) return null;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1000) {
    return (mb / 1024).toFixed(1) + ' GB';
  }
  return mb.toFixed(1) + ' MB';
}

function highlightText(text, query) {
  if (!query || query.length < 2) return text;

  const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
  return text.replace(regex, '<span class="highlight">$1</span>');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sanitizeUrl(url) {
  if (!url) return '';
  const str = String(url).trim();
  if (str.startsWith('data:image/')) return str;
  try {
    const parsed = new URL(str);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return str;
  } catch {}
  return '';
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// App Type Detection
function detectAppType(app) {
  const name = (app.name || '').toLowerCase();
  const bundleId = (app.bundleIdentifier || app.bundleID || '').toLowerCase();
  const description = (app.localizedDescription || app.description || '').toLowerCase();
  const category = (app.category || '').toLowerCase();
  const combined = `${name} ${bundleId} ${description} ${category}`;

  // Tweaked apps (++ suffix)
  if (name.includes('++') || name.includes('plus plus') || name.includes('tweaked') || name.includes('modded')) {
    return 'tweaked';
  }

  // Emulators
  const emulatorKeywords = ['emulator', 'retroarch', 'ppsspp', 'delta', 'provenance', 'dolphin', 'igba', 'gba4ios', 'nds4ios', 'ines', 'snes'];
  if (emulatorKeywords.some(kw => combined.includes(kw))) {
    return 'emulator';
  }

  // Jailbreak tools
  const jailbreakKeywords = ['jailbreak', 'unc0ver', 'chimera', 'odyssey', 'checkra1n', 'dopamine', 'taurine', 'electra', 'phoenix', 'pangu'];
  if (jailbreakKeywords.some(kw => combined.includes(kw))) {
    return 'jailbreak';
  }

  // Streaming/Movies
  const streamingKeywords = ['flix', 'stream', 'movie', 'tv show', 'cinema', 'stremio', 'kodi', 'plex', 'infuse', 'vlc', 'iptv'];
  if (streamingKeywords.some(kw => combined.includes(kw)) || category === 'entertainment') {
    return 'streaming';
  }

  // Social Media
  const socialKeywords = ['instagram', 'twitter', 'facebook', 'tiktok', 'snapchat', 'whatsapp', 'telegram', 'discord', 'reddit', 'tumblr'];
  const socialBundleIds = ['com.burbn.instagram', 'com.atebits.tweetie', 'com.facebook', 'com.zhiliaoapp.musically', 'com.toyopagroup.picaboo'];
  if (socialKeywords.some(kw => combined.includes(kw)) || socialBundleIds.some(id => bundleId.includes(id)) || category === 'social') {
    return 'social';
  }

  // Games
  const gameKeywords = ['game', 'arcade', 'puzzle', 'racing', 'rpg', 'adventure', 'strategy'];
  if (gameKeywords.some(kw => category.includes(kw)) || category === 'games') {
    return 'games';
  }

  // Utilities
  const utilityKeywords = ['utility', 'tools', 'file manager', 'filza', 'ifile', 'terminal', 'ssh'];
  if (utilityKeywords.some(kw => combined.includes(kw)) || category === 'utilities') {
    return 'utilities';
  }

  return null;
}

function getTypeBadgeHtml(type) {
  if (!type) return '';
  const labels = {
    tweaked: 'Tweaked',
    emulator: 'Emulator',
    streaming: 'Streaming',
    jailbreak: 'Jailbreak',
    social: 'Social',
    games: 'Game',
    utilities: 'Utility'
  };
  return `<span class="app-type-badge badge-${type}">${labels[type] || type}</span>`;
}

function getTrustBadgeHtml(trustInfo) {
  if (!trustInfo) {
    return '<span class="trust-badge trust-unverified" title="This source has not been verified">Unverified</span>';
  }
  const icons = {
    official: '✓',
    developer: '★',
    community: '♦'
  };
  const icon = icons[trustInfo.tier] || '•';
  return `<span class="trust-badge trust-${trustInfo.tier}" title="${trustInfo.description}">${icon} ${trustInfo.label}</span>`;
}

// Filter Functions
function getActiveFilters() {
  // Get selected trust levels as an array
  const trustLevels = [];
  if (trustOfficial?.checked) trustLevels.push('official');
  if (trustDeveloper?.checked) trustLevels.push('developer');
  if (trustCommunity?.checked) trustLevels.push('community');

  return {
    type: filterType?.value || '',
    trust: trustLevels,
    pal: filterPal?.checked || false,
    size: filterSize?.value || '',
    date: filterDate?.value || '',
    sort: filterSort?.value || 'relevance'
  };
}


function applyFilters(results) {
  const filters = getActiveFilters();
  let filtered = [...results];

  // Add detected type to each app
  filtered = filtered.map(app => ({
    ...app,
    _detectedType: detectAppType(app)
  }));

  // Filter by type
  if (filters.type) {
    filtered = filtered.filter(app => app._detectedType === filters.type);
  }

  // Filter by trust level (multi-select)
  if (filters.trust.length > 0) {
    filtered = filtered.filter(app => {
      const trust = app._source?.trust;
      if (!trust) return false; // No trust info = not in selected tiers
      return filters.trust.includes(trust.tier);
    });
  }

  // Filter by PAL (client-side fallback)
  if (filters.pal) {
    filtered = filtered.filter(app => app._source?.pal);
  }

  // Filter by size
  if (filters.size) {
    filtered = filtered.filter(app => {
      const size = app.size || 0;
      const sizeMB = size / (1024 * 1024);
      switch (filters.size) {
        case 'small': return sizeMB < 25;
        case 'medium': return sizeMB >= 25 && sizeMB < 100;
        case 'large': return sizeMB >= 100;
        default: return true;
      }
    });
  }

  // Filter by date
  if (filters.date) {
    const now = new Date();
    const getAppDate = (app) => {
      // Check top-level date fields
      let dateStr = app.versionDate || app.date;
      // Check versions array if no top-level date
      if (!dateStr && app.versions && app.versions.length > 0) {
        dateStr = app.versions[0].date || app.versions[0].versionDate;
      }
      return dateStr;
    };

    // Separate apps with and without dates
    const withDates = [];
    const withoutDates = [];

    filtered.forEach(app => {
      const dateStr = getAppDate(app);
      if (!dateStr) {
        withoutDates.push(app);
        return;
      }
      const appDate = new Date(dateStr);
      if (isNaN(appDate.getTime())) {
        withoutDates.push(app);
        return;
      }

      const diffDays = (now - appDate) / (1000 * 60 * 60 * 24);
      let matches = false;
      switch (filters.date) {
        case 'week': matches = diffDays <= 7; break;
        case 'month': matches = diffDays <= 30; break;
        case 'quarter': matches = diffDays <= 90; break;
        case 'year': matches = diffDays <= 365; break;
        default: matches = true;
      }
      if (matches) withDates.push(app);
    });

    // Apps with matching dates first, then apps without dates
    filtered = [...withDates, ...withoutDates];
  }

  // Helper to get app date (checks versions array too)
  const getAppDate = (app) => {
    let dateStr = app.versionDate || app.date;
    if (!dateStr && app.versions && app.versions.length > 0) {
      dateStr = app.versions[0].date || app.versions[0].versionDate;
    }
    return dateStr ? new Date(dateStr) : null;
  };

  // Trust boost: prefer verified sources
  const getTrustBoost = (app) => {
    const tier = app._source?.trust?.tier;
    switch (tier) {
      case 'official': return 15;
      case 'developer': return 10;
      case 'community': return 5;
      default: return 0; // unverified
    }
  };

  // Relevance scoring function
  const getRelevanceScore = (app, query) => {
    if (!query) return getTrustBoost(app); // Even without query, sort by trust
    const q = query.toLowerCase();
    const qNoSpaces = q.replace(/\s+/g, '');
    const name = (app.name || '').toLowerCase();
    const nameNoSpaces = name.replace(/\s+/g, '');
    const bundleId = (app.bundleIdentifier || app.bundleID || '').toLowerCase();
    const description = (app.localizedDescription || app.description || '').toLowerCase();

    // Higher score = more relevant
    // Priority: exact matches first, then space-normalized matches
    let baseScore = 0;

    // Exact matches (with spaces preserved)
    if (name === q) baseScore = 100;                    // Exact name match
    else if (name.startsWith(q)) baseScore = 90;        // Name starts with query
    else if (name.includes(q)) baseScore = 80;          // Name contains query
    else if (bundleId.includes(q)) baseScore = 70;      // Bundle ID contains query
    else if (description.includes(q)) baseScore = 40;   // Description contains query
    // Space-normalized matches (lower priority)
    else if (nameNoSpaces === qNoSpaces) baseScore = 60;     // Exact name match (normalized)
    else if (nameNoSpaces.startsWith(qNoSpaces)) baseScore = 50; // Name starts with (normalized)
    else if (nameNoSpaces.includes(qNoSpaces)) baseScore = 35;   // Name contains (normalized)

    // Add trust boost so verified sources rank higher within same match tier
    return baseScore + getTrustBoost(app);
  };

  // Sort results
  if (filters.sort) {
    switch (filters.sort) {
      case 'relevance':
        // Sort by relevance score, then by recency (most recent first)
        filtered.sort((a, b) => {
          const scoreA = getRelevanceScore(a, currentQuery);
          const scoreB = getRelevanceScore(b, currentQuery);
          if (scoreB !== scoreA) return scoreB - scoreA;
          // Secondary sort: most recent first
          const dateA = getAppDate(a);
          const dateB = getAppDate(b);
          if (!dateA && !dateB) return 0;
          if (!dateA) return 1;
          if (!dateB) return -1;
          return dateB - dateA;
        });
        break;
      case 'name':
        filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        break;
      case 'date':
        filtered.sort((a, b) => {
          const dateA = getAppDate(a);
          const dateB = getAppDate(b);
          // Apps without dates go to the end
          if (!dateA && !dateB) return 0;
          if (!dateA) return 1;
          if (!dateB) return -1;
          return dateB - dateA;
        });
        break;
      case 'size-asc':
        filtered.sort((a, b) => (a.size || 0) - (b.size || 0));
        break;
      case 'size-desc':
        filtered.sort((a, b) => (b.size || 0) - (a.size || 0));
        break;
    }
  }

  return filtered;
}

function clearFilters() {
  if (filterType) filterType.value = '';
  if (trustOfficial) trustOfficial.checked = false;
  if (trustDeveloper) trustDeveloper.checked = false;
  if (trustCommunity) trustCommunity.checked = false;
  if (filterPal) filterPal.checked = false;
  if (filterSize) filterSize.value = '';
  if (filterDate) filterDate.value = '';
  if (filterSort) filterSort.value = 'relevance';

  // Re-run search with current query (all filters now client-side)
  currentPage = 1;
  performSearch(currentQuery, 1);
}

// Reset to home state
function resetToHome() {
  // Clear search input
  searchInput.value = '';
  currentQuery = '';
  currentPage = 1;
  totalPages = 1;
  lastResults = [];

  // Clear filters
  if (filterType) filterType.value = '';
  if (trustOfficial) trustOfficial.checked = false;
  if (trustDeveloper) trustDeveloper.checked = false;
  if (trustCommunity) trustCommunity.checked = false;
  if (filterPal) filterPal.checked = false;
  if (filterSize) filterSize.value = '';
  if (filterDate) filterDate.value = '';
  if (filterSort) filterSort.value = 'relevance';

  // Hide stats and pagination
  statsSection.classList.add('hidden');
  hidePagination();

  // Show welcome screen
  showWelcome();

  // Clear URL params
  window.history.replaceState({}, '', window.location.pathname);
}

// UI State Functions
function showLoading() {
  hideAllStates();
  loadingEl.classList.remove('hidden');
}

function showError(message) {
  hideAllStates();
  errorMessage.textContent = message || 'An error occurred while searching';
  errorEl.classList.remove('hidden');
}

function showWelcome() {
  hideAllStates();
  statsSection.classList.add('hidden');
  welcomeEl.classList.remove('hidden');
}

function showNoResults() {
  hideAllStates();
  noResultsEl.classList.remove('hidden');
}

function hideAllStates() {
  loadingEl.classList.add('hidden');
  errorEl.classList.add('hidden');
  welcomeEl.classList.add('hidden');
  noResultsEl.classList.add('hidden');
  resultsGrid.classList.add('hidden');
  if (adBanner) adBanner.classList.add('hidden');
  if (mobileStickyAd) {
    mobileStickyAd.classList.add('hidden');
    document.body.classList.remove('has-sticky-ad');
  }
}

// Pagination Functions
function updatePagination(pagination) {
  let paginationEl = document.getElementById('pagination');
  if (!paginationEl) {
    paginationEl = document.createElement('div');
    paginationEl.id = 'pagination';
    paginationEl.className = 'pagination';
    resultsSection.appendChild(paginationEl);
  }

  if (!pagination || pagination.totalPages <= 1) {
    paginationEl.classList.add('hidden');
    return;
  }

  const { page, totalPages, totalResults } = pagination;

  let html = `<div class="pagination-info">Page ${page} of ${totalPages} (${totalResults.toLocaleString()} results)</div>`;
  html += '<div class="pagination-buttons">';

  // Previous button
  html += `<button class="page-btn" ${page <= 1 ? 'disabled' : ''} onclick="goToPage(${page - 1})">Previous</button>`;

  // Page numbers
  const maxVisible = 5;
  let startPage = Math.max(1, page - Math.floor(maxVisible / 2));
  let endPage = Math.min(totalPages, startPage + maxVisible - 1);
  if (endPage - startPage < maxVisible - 1) {
    startPage = Math.max(1, endPage - maxVisible + 1);
  }

  if (startPage > 1) {
    html += `<button class="page-btn" onclick="goToPage(1)">1</button>`;
    if (startPage > 2) html += '<span class="page-ellipsis">...</span>';
  }

  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="page-btn ${i === page ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) html += '<span class="page-ellipsis">...</span>';
    html += `<button class="page-btn" onclick="goToPage(${totalPages})">${totalPages}</button>`;
  }

  // Next button
  html += `<button class="page-btn" ${page >= totalPages ? 'disabled' : ''} onclick="goToPage(${page + 1})">Next</button>`;
  html += '</div>';

  paginationEl.innerHTML = html;
  paginationEl.classList.remove('hidden');
}

function hidePagination() {
  const paginationEl = document.getElementById('pagination');
  if (paginationEl) {
    paginationEl.classList.add('hidden');
  }
}

function goToPage(page) {
  if (page < 1 || page > totalPages || isLoading) return;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  performSearch(currentQuery, page);
}

// Make goToPage globally available
window.goToPage = goToPage;

// Utility Functions
const buttonFeedbackTimers = new WeakMap();

function clearButtonFeedback(button) {
  if (!button) return;

  const timer = buttonFeedbackTimers.get(button);
  if (timer) {
    clearTimeout(timer);
    buttonFeedbackTimers.delete(button);
  }

  if (button.dataset.defaultLabel) {
    button.textContent = button.dataset.defaultLabel;
  }

  button.classList.remove('is-feedback');
}

function showButtonFeedback(button, label, duration = 1200) {
  if (!button) return;

  if (!button.dataset.defaultLabel) {
    button.dataset.defaultLabel = button.textContent.trim();
  }

  clearButtonFeedback(button);
  button.textContent = label;
  button.classList.add('is-feedback');

  const timer = setTimeout(() => {
    if (button.isConnected && button.dataset.defaultLabel) {
      button.textContent = button.dataset.defaultLabel;
    }

    button.classList.remove('is-feedback');
    buttonFeedbackTimers.delete(button);
  }, duration);

  buttonFeedbackTimers.set(button, timer);
}

function copyToClipboard(text, button, getshtuff=false) {
  if (!text) {
    showButtonFeedback(button, 'No Source', 1400);
    return;
  }

  if (!navigator.clipboard?.writeText) {
    showButtonFeedback(button, 'Copy failed', 1400);
    return;
  }
  if (getshtuff = true) {
    window.open(`sidestore://source?url=${text}`, "_blank")
  };
  navigator.clipboard.writeText(text).then(() => {
    showButtonFeedback(button, `Copied!`);
  }).catch(err => {
    console.error('Copy failed:', err);
    showButtonFeedback(button, 'Copy failed', 1400);
  });
}

// Debounced search
function debounceSearch(query) {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    currentPage = 1; // Reset to first page on new search
    performSearch(query, 1);
  }, 400);
}

// Event Listeners
searchInput.addEventListener('input', (e) => {
  debounceSearch(e.target.value);
});

searchInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    clearTimeout(searchTimeout);
    currentPage = 1;
    performSearch(searchInput.value, 1, { track: true });
  }
});

searchBtn.addEventListener('click', () => {
  clearTimeout(searchTimeout);
  currentPage = 1;
  performSearch(searchInput.value, 1, { track: true });
});

themeToggle.addEventListener('click', toggleTheme);

retryBtn.addEventListener('click', () => {
  performSearch(currentQuery);
});

// Filter event listeners: re-apply filters when any filter changes
const filterElements = [filterType, filterSize, filterDate, filterSort];
filterElements.forEach(el => {
  if (el) {
    el.addEventListener('change', () => {
      if (lastResults.length > 0) {
        displayResults(lastResults, true);
      }
    });
  }
});

// Trust and PAL checkbox listeners: trigger a new search because filtering is server-side
const trustCheckboxes = [trustOfficial, trustDeveloper, trustCommunity, filterPal];
trustCheckboxes.forEach(el => {
  if (el) {
    el.addEventListener('change', () => {
      // Reset to page 1 and perform new search with trust filter
      currentPage = 1;
      performSearch(currentQuery, 1);
    });
  }
});

if (clearFiltersBtn) {
  clearFiltersBtn.addEventListener('click', clearFilters);
}

// Hint buttons
document.querySelectorAll('.hint-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const query = btn.getAttribute('data-query');
    searchInput.value = query;
    performSearch(query, 1, { track: true });
  });
});

// URL parameter handling
function handleUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const query = params.get('q');
  if (query) {
    searchInput.value = query;
    performSearch(query);
  }
}

// Update URL on search
function updateUrl(query) {
  const url = new URL(window.location);
  if (query) {
    url.searchParams.set('q', query);
  } else {
    url.searchParams.delete('q');
  }
  window.history.replaceState({}, '', url);
}

// Header click to reset to home
const headerContent = document.querySelector('.header-content h1');
if (headerContent) {
  headerContent.style.cursor = 'pointer';
  headerContent.addEventListener('click', resetToHome);
}

// Mobile filters toggle
const filtersSection = document.getElementById('filters-section');
const filtersToggle = document.getElementById('filters-toggle');

if (filtersToggle && filtersSection) {
  filtersToggle.addEventListener('click', () => {
    filtersSection.classList.toggle('expanded');
  });
}

// Trending Searches
const trendingSection = document.getElementById('trending-section');
const trendingChips = document.getElementById('trending-chips');
let currentTrendingPeriod = 'day';

async function fetchTrending(period) {
  try {
    const response = await fetch(`https://ipasearch.xyz/api/trending?period=${period}&limit=10`);
    if (!response.ok) return;
    const data = await response.json();

    if (data.queries && data.queries.length > 0) {
      trendingChips.innerHTML = data.queries.map(item =>
        `<button class="trending-chip" data-query="${escapeHtml(item.query).replace("porn", "p##n")}">${escapeHtml(item.query).replace("porn", "p##n")}<span class="trending-count">${item.count}</span></button>`
      ).join('');

      // Add click handlers
      trendingChips.querySelectorAll('.trending-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const query = chip.getAttribute('data-query');
          searchInput.value = query;
          performSearch(query, 1, { track: true });
        });
      });

      trendingSection.classList.remove('hidden');
    } else {
      trendingSection.classList.add('hidden');
    }
  } catch (err) {
    // Silently fail because trending is non-critical
  }
}

// Trending tab clicks
document.querySelectorAll('.trending-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.trending-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTrendingPeriod = tab.getAttribute('data-period');
    fetchTrending(currentTrendingPeriod);
  });
});

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  handleUrlParams();
  fetchTrending(currentTrendingPeriod);
});

// Make copyToClipboard available globally
window.copyToClipboard = copyToClipboard;

// Modal functionality
const modal = document.getElementById('app-modal');
let currentModalApp = null;

function openModal(app) {
  currentModalApp = app;

  // Get values with fallbacks
  const iconUrl = app.iconURL || app.icon || '';
  const name = app.name || 'Unknown App';
  const subtitle = app.subtitle || '';
  const developer = app.developerName || app.developer || '';
  const version = app.version || '';
  const bundleId = app.bundleIdentifier || app.bundleID || '';
  const sourceUrl = sanitizeUrl(app._source?.url) || '';

  // Get date
  let dateStr = app.versionDate || app.date;
  if (!dateStr && app.versions && app.versions.length > 0) {
    dateStr = app.versions[0].date || app.versions[0].versionDate;
  }

  // Get size
  let sizeBytes = app.size;
  if (!sizeBytes && app.versions && app.versions.length > 0) {
    sizeBytes = app.versions[0].size;
  }

  // Get download URL
  let downloadUrl = app.downloadURL || app.download;
  if (!downloadUrl && app.versions && app.versions.length > 0) {
    downloadUrl = app.versions[0].downloadURL || app.versions[0].download;
  }

  // Get description
  const description = app.localizedDescription || app.description || '';

  // Populate modal
  const modalDefaultIcon = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23667" width="100" height="100" rx="22"/><text x="50" y="65" text-anchor="middle" font-size="36" fill="white">?</text></svg>';
  document.getElementById('modal-icon').src = sanitizeUrl(iconUrl) || modalDefaultIcon;
  document.getElementById('modal-icon').alt = name;
  document.getElementById('modal-name').textContent = name;
  document.getElementById('modal-subtitle').textContent = subtitle;
  document.getElementById('modal-subtitle').classList.toggle('hidden', !subtitle);
  document.getElementById('modal-developer').textContent = developer;
  document.getElementById('modal-version').textContent = version ? `v${version}` : '';
  document.getElementById('modal-date').textContent = dateStr ? formatDate(dateStr) : '';
  document.getElementById('modal-size').textContent = sizeBytes ? formatSize(sizeBytes) : '';
  const modalDownloadBtn = document.getElementById('modal-download');
  const modalCopyBtn = document.getElementById('modal-copy-source');
  const safeDownloadUrl = sanitizeUrl(downloadUrl) || '#';

  clearButtonFeedback(modalDownloadBtn);
  clearButtonFeedback(modalCopyBtn);
  modalDownloadBtn.href = safeDownloadUrl;
  modalDownloadBtn.onclick = (e) => {
    if (safeDownloadUrl === '#') {
      e.preventDefault();
      showButtonFeedback(modalDownloadBtn, 'Unavailable', 1400);
      return;
    }

    showButtonFeedback(modalDownloadBtn, 'Opening...', 900);
  };

  // Description with truncation
  const descEl = document.getElementById('modal-description');
  const readMoreEl = document.getElementById('modal-read-more');
  descEl.textContent = cleanDescription(description) || 'No description available.';

  const modalSlug = slugify(name) || slugify(bundleId);

  // Show "Read more" if description is clamped (CSS -webkit-line-clamp: 4)
  requestAnimationFrame(() => {
    if (descEl.scrollHeight > descEl.clientHeight && modalSlug) {
      readMoreEl.href = `/app/${modalSlug}`;
      readMoreEl.classList.remove('hidden');
    } else {
      readMoreEl.classList.add('hidden');
    }
  });

  // Badges
  const badgesEl = document.getElementById('modal-badges');
  let badgesHtml = '';
  const appType = detectAppType(app);
  if (appType) badgesHtml += getTypeBadgeHtml(appType);
  badgesHtml += getTrustBadgeHtml(app._source?.trust);
  if (app.beta) badgesHtml += '<span class="app-type-badge badge-tweaked">Beta</span>';
  badgesEl.innerHTML = badgesHtml;

  // Copy source button
  modalCopyBtn.onclick = () => {
    copyToClipboard(sourceUrl, modalCopyBtn, true);
  };

  // View full details link (always visible if slug exists)
  const viewPageLink = document.getElementById('modal-view-page');
  viewPageLink.href = modalSlug ? `/app/${modalSlug}` : '#';
  viewPageLink.style.display = modalSlug ? '' : 'none';

  // Show modal and lock body scroll
  modal.classList.remove('hidden');
  modal.scrollPosition = window.scrollY;
  document.body.style.overflow = 'hidden';
  document.body.style.position = 'fixed';
  document.body.style.top = `-${modal.scrollPosition}px`;
  document.body.style.width = '100%';
}

function closeModal() {
  modal.classList.add('hidden');
  // Restore body scroll
  document.body.style.overflow = '';
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.width = '';
  window.scrollTo(0, modal.scrollPosition || 0);
  currentModalApp = null;
}

// Close on escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
    closeModal();
  }
});

window.openModal = openModal;
window.closeModal = closeModal;
