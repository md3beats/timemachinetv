const state = {
  category: "all",
  lastEra: "",
  lastFocused: null,
  previousFocus: null,
  currentVideoIndex: -1,
  autoSearchTimer: null,
  results: []
};

const SEARCH_ENDPOINTS = [
  "https://inv.thepixora.com/api/v1/search"
];

const els = {
  form: document.getElementById("search-form"),
  eraInput: document.getElementById("era-input"),
  screen: document.getElementById("tv-screen"),
  screenContent: document.getElementById("screen-content"),
  resultsGrid: document.getElementById("results-grid"),
  resultMeta: document.getElementById("result-meta"),
  filters: Array.from(document.querySelectorAll(".filter-btn")),
  videoModal: document.getElementById("video-modal"),
  videoTitle: document.getElementById("video-modal-title"),
  embedScreen: document.getElementById("embed-screen"),
  closeVideo: document.getElementById("close-video"),
  toast: document.getElementById("toast"),
  dial: document.getElementById("channel-dial")
};

const categoryThemes = {
  tv: "TV show episode sitcom variety show television",
  music: "music video hit song live performance",
  news: "news broadcast documentary current events",
  movies: "movie trailer cinema clip film",
  commercials: "commercial advertisement TV ad",
  all: "TV show music video commercial news cartoon movie popular culture"
};

document.addEventListener("DOMContentLoaded", init);

function init() {
  bindEvents();
  renderWelcome();
  els.eraInput.focus();
}

function bindEvents() {
  els.eraInput.addEventListener("input", () => {
    const era = els.eraInput.value.trim();
    state.currentVideoIndex = -1;
    window.clearTimeout(state.autoSearchTimer);

    if (era) {
      renderEraPreview(era);
      state.autoSearchTimer = window.setTimeout(() => {
        state.lastEra = era;
        runSearch(era, { autoPlay: true });
      }, 900);
    } else {
      state.lastEra = "";
      state.results = [];
      els.resultsGrid.innerHTML = "";
      els.resultMeta.textContent = "Tune an era to begin.";
      renderWelcome();
    }
  });

  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    const era = els.eraInput.value.trim();
    if (!era) return;
    window.clearTimeout(state.autoSearchTimer);
    state.lastEra = era;
    runSearch(era, { autoPlay: true });
  });

  els.filters.forEach((button) => {
    button.addEventListener("click", () => {
      state.category = button.dataset.category;
      els.filters.forEach((item) => item.classList.toggle("is-active", item === button));
      if (state.lastEra) {
        runSearch(state.lastEra);
      }
    });
  });

  els.closeVideo.addEventListener("click", closeVideoModal);

  els.videoModal.addEventListener("click", (event) => {
    if (event.target === els.videoModal) closeVideoModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.videoModal.classList.contains("hidden")) {
      closeVideoModal();
    }
  });

  document.addEventListener("click", (event) => {
    const watch = event.target.closest("[data-watch]");
    const copy = event.target.closest("[data-copy]");
    const tune = event.target.closest("[data-tune]");

    if (watch) {
      tuneVideoById(watch.dataset.watch);
    }

    if (copy) {
      copyToClipboard(copy.dataset.copy);
    }

    if (tune) {
      changeBroadcast(tune.dataset.tune);
    }
  });

  els.dial.addEventListener("click", () => {
    els.dial.classList.remove("spin");
    void els.dial.offsetWidth;
    els.dial.classList.add("spin");
  });
}

async function runSearch(era, options = {}) {
  setScreenLoading();
  els.resultMeta.textContent = "Searching the archive...";
  els.resultsGrid.innerHTML = "";

  try {
    const query = buildQuery(era, state.category);
    const searchData = await searchVideos(query);
    const videos = searchData
      .filter((item) => item.type === "video" && item.videoId)
      .slice(0, 12);

    if (!videos.length) {
      state.results = [];
      renderResults([]);
      setNoSignal();
      return;
    }

    state.results = videos.map(normalizeVideo);
    state.currentVideoIndex = -1;

    renderResults(state.results);
    if (options.autoPlay) {
      tuneVideo(0);
    } else {
      setScreenSuccess(era, state.results.length);
    }
  } catch (error) {
    console.error(error);
    if (error.isArchiveError) {
      setChannelNotFound(error.message);
      els.resultMeta.textContent = "The archive signal is unavailable right now. Try again in a moment.";
    } else {
      setChannelNotFound("Signal interrupted. Try again.");
      els.resultMeta.textContent = "Something interrupted the broadcast.";
    }
    state.results = [];
    state.currentVideoIndex = -1;
    els.resultsGrid.innerHTML = "";
  }
}

async function searchVideos(query) {
  let lastError = null;

  for (const endpoint of SEARCH_ENDPOINTS) {
    try {
      const searchUrl = new URL(endpoint);
      searchUrl.search = new URLSearchParams({
        q: query,
        type: "video",
        page: "1"
      }).toString();

      const response = await fetch(searchUrl, {
        headers: { accept: "application/json" }
      });
      return await parseArchiveResponse(response);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Archive signal unavailable.");
}

async function parseArchiveResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error?.message || data.error || "Archive signal unavailable.");
    error.isArchiveError = true;
    throw error;
  }
  return data;
}

function normalizeVideo(item) {
  return {
    id: item.videoId,
    title: decodeEntities(item.title || "Untitled broadcast"),
    channel: decodeEntities(item.author || "Unknown Channel"),
    publishedAt: item.published ? new Date(item.published * 1000).toISOString() : "",
    publishedText: item.publishedText || "",
    thumbnail: `https://i.ytimg.com/vi/${encodeURIComponent(item.videoId)}/hqdefault.jpg`,
    duration: formatSeconds(item.lengthSeconds)
  };
}

function buildQuery(input, category) {
  const era = parseEra(input);
  return `${era.query} ${categoryThemes[category] || categoryThemes.all} ${era.modifier}`.replace(/\s+/g, " ").trim();
}

function parseEra(value) {
  const input = value.toLowerCase().trim().replace(/^the\s+/, "");
  const yearMatch = input.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatch) {
    return { query: yearMatch[1], modifier: "archival footage" };
  }

  const decadeMatch = input.match(/\b(early|mid|late)?\s*'?(\d{2})s\b/);
  if (decadeMatch) {
    const period = decadeMatch[1] || "";
    const decadeNumber = Number(decadeMatch[2]);
    const century = decadeNumber <= 26 ? "20" : "19";
    const decade = `${century}${decadeMatch[2]}s`;
    const modifier = period ? `${period} ${decade} popular culture` : `${decade} popular culture`;
    return { query: decade, modifier };
  }

  const longDecade = input.match(/\b(19\d0|20\d0)s\b/);
  if (longDecade) {
    return { query: longDecade[0], modifier: "popular culture archive" };
  }

  return { query: value, modifier: "retro archive popular culture" };
}

function renderResults(videos) {
  if (!videos.length) {
    els.resultsGrid.innerHTML = '<p class="empty-results">No listings found in this broadcast window.</p>';
    els.resultMeta.textContent = "No results. Try another era or category.";
    return;
  }

  els.resultMeta.textContent = `${videos.length} broadcasts tuned for ${state.lastEra}.`;
  els.resultsGrid.innerHTML = videos.map((video) => {
    const url = youtubeUrl(video.id);
    return `
      <article class="video-card">
        <div class="thumb-wrap">
          <img src="${escapeHtml(video.thumbnail)}" alt="">
          <span class="duration-badge">${escapeHtml(video.duration)}</span>
        </div>
        <div class="card-body">
          <h3>${escapeHtml(video.title)}</h3>
          <p class="card-meta">
            <span>${escapeHtml(video.channel)}</span>
            <span>${formatDate(video.publishedAt, video.publishedText)}</span>
          </p>
        </div>
        <div class="card-actions">
          <button class="action-btn" type="button" data-watch="${escapeHtml(video.id)}">▶ WATCH</button>
          <a class="action-btn" href="${url}" target="_blank" rel="noopener noreferrer">🔗 VIEW ON YOUTUBE</a>
          <button class="action-btn copy-btn" type="button" data-copy="${url}" aria-label="Copy YouTube link">⧉</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderWelcome() {
  els.screen.classList.remove("static-mode");
  els.screenContent.className = "screen-content";
  els.screenContent.innerHTML = `
    <p class="screen-kicker">CHANNEL 00</p>
    <p class="screen-title">ENTER AN ERA</p>
    <p class="screen-copy">Tune the archive to 1985, the 70s, early 90s...</p>
  `;
}

function renderEraPreview(era) {
  els.screen.classList.remove("static-mode");
  els.screenContent.className = "screen-content";
  els.screenContent.innerHTML = `
    <p class="screen-kicker">TUNING ERA</p>
    <p class="screen-title">${escapeHtml(era).toUpperCase()}</p>
    <p class="screen-copy">PRESS CHANNEL SEARCH TO LOAD BROADCASTS</p>
  `;
}

function setScreenLoading() {
  els.screen.classList.add("static-mode");
  els.screenContent.className = "screen-content";
  els.screenContent.innerHTML = `
    <p class="screen-kicker">PLEASE STAND BY</p>
    <p class="screen-title">SEARCHING</p>
    <p class="screen-copy">SEARCHING THE ARCHIVES...</p>
  `;
}

function setScreenSuccess(era, count) {
  els.screen.classList.remove("static-mode");
  els.screenContent.className = "screen-content";
  els.screenContent.innerHTML = `
    <p class="screen-kicker">SIGNAL LOCKED</p>
    <p class="screen-title">${escapeHtml(String(era)).toUpperCase()}</p>
    <p class="screen-copy">${count} BROADCASTS FOUND</p>
  `;
}

function tuneVideoById(videoId) {
  const index = state.results.findIndex((item) => item.id === videoId);
  if (index === -1) return;
  tuneVideo(index);
}

function tuneVideo(index) {
  if (!state.results.length) return;
  const nextIndex = (index + state.results.length) % state.results.length;
  const video = state.results[nextIndex];
  const url = youtubeUrl(video.id);
  state.currentVideoIndex = nextIndex;

  els.screen.classList.remove("static-mode");
  els.screenContent.className = "screen-content player-mode";
  els.screenContent.innerHTML = `
    <iframe
      class="main-tv-embed"
      title="${escapeHtml(video.title)}"
      src="https://www.youtube.com/embed/${encodeURIComponent(video.id)}?autoplay=1&rel=0"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowfullscreen>
    </iframe>
    <div class="broadcast-overlay">
      <p class="broadcast-label">NOW PLAYING CH ${String(nextIndex + 1).padStart(2, "0")}</p>
      <h2>${escapeHtml(video.title)}</h2>
      <div class="broadcast-actions">
        <button type="button" data-tune="prev">◀ CHANNEL</button>
        <a href="${url}" target="_blank" rel="noopener noreferrer">OPEN ON YOUTUBE</a>
        <button type="button" data-tune="next">CHANGE BROADCAST ▶</button>
      </div>
    </div>
  `;

  els.resultMeta.textContent = `Now playing channel ${nextIndex + 1} of ${state.results.length}.`;
  els.screen.scrollIntoView({ behavior: "smooth", block: "center" });
}

function changeBroadcast(direction) {
  if (state.currentVideoIndex === -1 || !state.results.length) return;
  const delta = direction === "prev" ? -1 : 1;
  tuneVideo(state.currentVideoIndex + delta);
}

function setNoSignal() {
  els.screen.classList.remove("static-mode");
  els.screenContent.className = "screen-content";
  els.screenContent.innerHTML = `
    <div class="no-signal" aria-label="No signal">
      <span>NO SIGNAL</span>
    </div>
  `;
}

function setChannelNotFound(message) {
  els.screen.classList.remove("static-mode");
  els.screenContent.className = "screen-content error";
  els.screenContent.innerHTML = `
    <p class="screen-kicker">ERROR</p>
    <p class="screen-title">CHANNEL NOT FOUND</p>
    <p class="screen-copy">${escapeHtml(message)}</p>
  `;
}

function openVideoModal(video) {
  state.previousFocus = document.activeElement;
  els.videoTitle.textContent = video.title;
  els.embedScreen.innerHTML = `
    <iframe
      title="${escapeHtml(video.title)}"
      src="https://www.youtube.com/embed/${encodeURIComponent(video.id)}?autoplay=1&rel=0"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowfullscreen>
    </iframe>
  `;
  openModal(els.videoModal, els.closeVideo);
}

function closeVideoModal() {
  els.embedScreen.innerHTML = "";
  closeModal(els.videoModal);
}

function openModal(modal, focusTarget) {
  state.previousFocus = document.activeElement;
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  focusTarget?.focus();
  modal.addEventListener("keydown", trapFocus);
}

function closeModal(modal) {
  modal.classList.add("hidden");
  document.body.style.overflow = "";
  modal.removeEventListener("keydown", trapFocus);
  if (state.previousFocus && typeof state.previousFocus.focus === "function") {
    state.previousFocus.focus();
  }
}

function trapFocus(event) {
  if (event.key !== "Tab") return;
  const modal = event.currentTarget;
  const focusable = Array.from(modal.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'))
    .filter((item) => item.offsetParent !== null);
  if (!focusable.length) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("COPIED!");
  } catch {
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.left = "-9999px";
    document.body.appendChild(helper);
    helper.select();
    document.execCommand("copy");
    helper.remove();
    showToast("COPIED!");
  }
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => {
    els.toast.classList.remove("show");
  }, 1600);
}

function youtubeUrl(videoId) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

function formatSeconds(value) {
  const total = Number(value || 0);
  if (!total) return "VHS";
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const parts = hours ? [hours, minutes, seconds] : [minutes, seconds];
  return parts.map((part, index) => index === 0 ? String(part) : String(part).padStart(2, "0")).join(":");
}

function formatDate(value, fallback) {
  if (!value) return (fallback || "AIR DATE UNKNOWN").toUpperCase();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return (fallback || "AIR DATE UNKNOWN").toUpperCase();
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }).toUpperCase();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function decodeEntities(value) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}
