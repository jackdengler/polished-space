(() => {
  const REPO_OWNER = "jackdengler";
  const REPO_NAME = "polished-space";
  const DATA_PATH = "chores.json";
  const BRANCH = "main";
  const API_BASE = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${DATA_PATH}`;
  const POLL_INTERVAL_MS = 30_000;

  const LS_TOKEN = "ps.token";
  const LS_WHOAMI = "ps.whoami";

  const defaultData = () => ({
    users: [
      { id: "u1", name: "Me", color: "#7c5cff" },
      { id: "u2", name: "Partner", color: "#ff6b9d" },
    ],
    chores: [],
  });

  // --- State ---
  let state = {
    token: localStorage.getItem(LS_TOKEN) || "",
    whoami: localStorage.getItem(LS_WHOAMI) || "",
    data: defaultData(),
    sha: null,
    filter: "today",
    lastSync: 0,
  };

  // --- DOM refs ---
  const $ = (id) => document.getElementById(id);
  const el = {
    setup: $("setup"),
    setupForm: $("setup-form"),
    tokenInput: $("token-input"),
    whoamiSelect: $("whoami-select"),
    setupError: $("setup-error"),

    main: $("main"),
    scoreboard: $("scoreboard"),
    tabs: $("tabs"),
    list: $("chore-list"),
    addBtn: $("add-btn"),
    syncIndicator: $("sync-indicator"),
    settingsBtn: $("settings-btn"),

    modal: $("modal"),
    modalTitle: $("modal-title"),
    choreForm: $("chore-form"),
    choreId: $("chore-id"),
    choreTitle: $("chore-title"),
    choreAssignee: $("chore-assignee"),
    choreRecurrence: $("chore-recurrence"),
    chorePoints: $("chore-points"),
    choreDelete: $("chore-delete"),
    choreCancel: $("chore-cancel"),

    settingsModal: $("settings-modal"),
    settingsForm: $("settings-form"),
    settingsMyName: $("settings-my-name"),
    settingsPartnerName: $("settings-partner-name"),
    settingsWhoami: $("settings-whoami"),
    settingsCancel: $("settings-cancel"),
    settingsLogout: $("settings-logout"),
  };

  // --- Utils ---
  const uid = () =>
    "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const b64encode = (str) =>
    btoa(unescape(encodeURIComponent(str)));
  const b64decode = (str) =>
    decodeURIComponent(escape(atob(str.replace(/\s/g, ""))));

  const startOfToday = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };

  const msAgo = (ms) => Date.now() - ms;

  const isChoreDone = (chore) => {
    if (!chore.lastCompletedAt) return false;
    if (chore.recurrence === "none") return true;
    if (chore.recurrence === "daily")
      return chore.lastCompletedAt >= startOfToday();
    if (chore.recurrence === "weekly")
      return msAgo(chore.lastCompletedAt) < 7 * 86400e3;
    return false;
  };

  const setSync = (status) => {
    el.syncIndicator.classList.remove("ok", "syncing", "err");
    if (status) el.syncIndicator.classList.add(status);
  };

  const userById = (id) => state.data.users.find((u) => u.id === id);

  // --- GitHub API ---
  async function ghFetch(url, opts = {}) {
    const res = await fetch(url, {
      ...opts,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: `Bearer ${state.token}`,
        ...(opts.headers || {}),
      },
    });
    return res;
  }

  async function loadRemote() {
    setSync("syncing");
    try {
      const res = await ghFetch(`${API_BASE}?ref=${BRANCH}`);
      if (res.status === 404) {
        state.data = defaultData();
        state.sha = null;
        setSync("ok");
        return { created: false };
      }
      if (!res.ok) throw new Error(`GET ${res.status}`);
      const json = await res.json();
      const raw = b64decode(json.content);
      const parsed = JSON.parse(raw);
      state.data = {
        users: parsed.users || defaultData().users,
        chores: parsed.chores || [],
      };
      state.sha = json.sha;
      state.lastSync = Date.now();
      setSync("ok");
      return { created: false };
    } catch (err) {
      console.error("loadRemote", err);
      setSync("err");
      throw err;
    }
  }

  async function saveRemote(message) {
    setSync("syncing");
    const body = {
      message: message || "update chores",
      content: b64encode(JSON.stringify(state.data, null, 2) + "\n"),
      branch: BRANCH,
    };
    if (state.sha) body.sha = state.sha;
    let res = await ghFetch(API_BASE, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    // Handle stale sha — refetch, reapply not trivially possible, so just refresh and retry once
    if (res.status === 409 || res.status === 422) {
      await loadRemote();
      body.sha = state.sha;
      res = await ghFetch(API_BASE, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    if (!res.ok) {
      setSync("err");
      const txt = await res.text();
      let hint = "";
      if (res.status === 401) hint = " — token is invalid or expired.";
      else if (res.status === 403) hint = " — token is missing Contents: Write permission on this repo.";
      else if (res.status === 404) hint = " — repo or branch not found (is this repo private with no access?).";
      throw new Error(`Save failed (HTTP ${res.status})${hint}\n\n${txt.slice(0, 300)}`);
    }
    const json = await res.json();
    state.sha = json.content.sha;
    state.lastSync = Date.now();
    setSync("ok");
  }

  // --- Setup flow ---
  function showSetup() {
    el.setup.classList.remove("hidden");
    el.main.classList.add("hidden");
    renderWhoamiOptions(el.whoamiSelect);
  }

  function showMain() {
    el.setup.classList.add("hidden");
    el.main.classList.remove("hidden");
    render();
  }

  function renderWhoamiOptions(selectEl, selected) {
    selectEl.innerHTML = "";
    for (const u of state.data.users) {
      const opt = document.createElement("option");
      opt.value = u.id;
      opt.textContent = u.name;
      if ((selected ?? state.whoami) === u.id) opt.selected = true;
      selectEl.appendChild(opt);
    }
  }

  el.setupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    el.setupError.textContent = "";
    const token = el.tokenInput.value.trim();
    const whoami = el.whoamiSelect.value;
    state.token = token;
    try {
      await loadRemote();
      // If first run and chores.json was 404, create it now
      if (state.sha === null) {
        await saveRemote("init chores.json");
      }
      state.whoami = whoami;
      localStorage.setItem(LS_TOKEN, token);
      localStorage.setItem(LS_WHOAMI, whoami);
      showMain();
      startPolling();
    } catch (err) {
      el.setupError.textContent =
        "Could not connect. Check the token has Contents: Read & Write on this repo.";
    }
  });

  // --- Rendering ---
  function render() {
    renderScoreboard();
    renderList();
  }

  function renderScoreboard() {
    const weekAgo = Date.now() - 7 * 86400e3;
    const scores = Object.fromEntries(state.data.users.map((u) => [u.id, 0]));
    for (const c of state.data.chores) {
      const hist = c.history || [];
      for (const h of hist) {
        if (h.at >= weekAgo && scores[h.userId] != null) {
          scores[h.userId] += c.points || 1;
        }
      }
    }
    const max = Math.max(...Object.values(scores), 0);
    el.scoreboard.innerHTML = "";
    for (const u of state.data.users) {
      const leader = max > 0 && scores[u.id] === max;
      const div = document.createElement("div");
      div.className = "score-card" + (leader ? " leader" : "");
      div.innerHTML = `
        <div class="name"><span class="dot" style="background:${escapeAttr(
          u.color
        )}"></span>${escapeHtml(u.name)}</div>
        <div class="score">${scores[u.id]}</div>
        <div class="sub">pts this week</div>
      `;
      el.scoreboard.appendChild(div);
    }
  }

  function renderList() {
    const filter = state.filter;
    const chores = state.data.chores
      .slice()
      .sort((a, b) => {
        const ad = isChoreDone(a), bd = isChoreDone(b);
        if (ad !== bd) return ad ? 1 : -1;
        return a.title.localeCompare(b.title);
      })
      .filter((c) => {
        const done = isChoreDone(c);
        if (filter === "done") return done;
        if (filter === "today") return !done || c.lastCompletedAt >= startOfToday();
        return true;
      });

    el.list.innerHTML = "";
    if (chores.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.innerHTML = `<span class="big">🌱</span>${
        filter === "done" ? "Nothing finished yet." : "No chores here — add one!"
      }`;
      el.list.appendChild(empty);
      return;
    }

    for (const c of chores) {
      const done = isChoreDone(c);
      const assignee = userById(c.assignedTo);
      const row = document.createElement("div");
      row.className = "chore" + (done ? " done" : "");
      row.innerHTML = `
        <button class="check" aria-label="${done ? "Mark not done" : "Mark done"}"></button>
        <div class="body">
          <div class="title"></div>
          <div class="meta">
            <span class="assignee-pill">
              <span class="dot" style="background:${escapeAttr(
                assignee ? assignee.color : "#aaa"
              )}"></span>
              <span class="assignee-name"></span>
            </span>
            <span class="recurrence"></span>
            <span class="points">+${c.points || 1} pt${
              (c.points || 1) === 1 ? "" : "s"
            }</span>
          </div>
        </div>
      `;
      row.querySelector(".title").textContent = c.title;
      row.querySelector(".assignee-name").textContent = assignee ? assignee.name : "Unassigned";
      row.querySelector(".recurrence").textContent = labelForRecurrence(c.recurrence);
      row.querySelector(".check").addEventListener("click", (e) => {
        e.stopPropagation();
        toggleChore(c.id);
      });
      row.querySelector(".body").addEventListener("click", () => openEditChore(c.id));
      el.list.appendChild(row);
    }
  }

  function labelForRecurrence(r) {
    if (r === "daily") return "Daily";
    if (r === "weekly") return "Weekly";
    return "One time";
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // --- Chore actions ---
  async function toggleChore(id) {
    const c = state.data.chores.find((x) => x.id === id);
    if (!c) return;
    const wasDone = isChoreDone(c);
    if (wasDone) {
      // Undo latest completion
      c.history = (c.history || []).filter(
        (h) => h.at !== c.lastCompletedAt
      );
      const remaining = (c.history || []).filter((h) => h.userId != null);
      c.lastCompletedAt = remaining.length
        ? Math.max(...remaining.map((h) => h.at))
        : null;
    } else {
      const now = Date.now();
      c.history = c.history || [];
      c.history.push({ userId: state.whoami, at: now });
      c.lastCompletedAt = now;
    }
    render();
    try {
      await saveRemote(`${wasDone ? "undo" : "done"}: ${c.title}`);
    } catch (err) {
      alert(err.message || "Sync failed — please refresh.");
    }
  }

  function openAddChore() {
    el.modalTitle.textContent = "New chore";
    el.choreId.value = "";
    el.choreTitle.value = "";
    el.choreRecurrence.value = "daily";
    el.chorePoints.value = "1";
    renderWhoamiOptions(el.choreAssignee, state.whoami);
    el.choreDelete.classList.add("hidden");
    el.modal.classList.remove("hidden");
    setTimeout(() => el.choreTitle.focus(), 50);
  }

  function openEditChore(id) {
    const c = state.data.chores.find((x) => x.id === id);
    if (!c) return;
    el.modalTitle.textContent = "Edit chore";
    el.choreId.value = c.id;
    el.choreTitle.value = c.title;
    el.choreRecurrence.value = c.recurrence || "none";
    el.chorePoints.value = c.points || 1;
    renderWhoamiOptions(el.choreAssignee, c.assignedTo);
    el.choreDelete.classList.remove("hidden");
    el.modal.classList.remove("hidden");
    setTimeout(() => el.choreTitle.focus(), 50);
  }

  el.addBtn.addEventListener("click", openAddChore);
  el.choreCancel.addEventListener("click", () => el.modal.classList.add("hidden"));
  el.modal.addEventListener("click", (e) => {
    if (e.target === el.modal) el.modal.classList.add("hidden");
  });

  el.choreForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = el.choreId.value;
    const payload = {
      title: el.choreTitle.value.trim(),
      assignedTo: el.choreAssignee.value,
      recurrence: el.choreRecurrence.value,
      points: parseInt(el.chorePoints.value, 10) || 1,
    };
    if (!payload.title) return;

    if (id) {
      const c = state.data.chores.find((x) => x.id === id);
      if (c) Object.assign(c, payload);
    } else {
      state.data.chores.push({
        id: uid(),
        ...payload,
        lastCompletedAt: null,
        history: [],
      });
    }
    el.modal.classList.add("hidden");
    render();
    try {
      await saveRemote(id ? `edit: ${payload.title}` : `add: ${payload.title}`);
    } catch (err) {
      alert(err.message || "Sync failed — please refresh.");
    }
  });

  el.choreDelete.addEventListener("click", async () => {
    const id = el.choreId.value;
    if (!id) return;
    if (!confirm("Delete this chore?")) return;
    const c = state.data.chores.find((x) => x.id === id);
    const title = c ? c.title : "chore";
    state.data.chores = state.data.chores.filter((x) => x.id !== id);
    el.modal.classList.add("hidden");
    render();
    try {
      await saveRemote(`delete: ${title}`);
    } catch (err) {
      alert(err.message || "Sync failed — please refresh.");
    }
  });

  // --- Tabs ---
  el.tabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    state.filter = btn.dataset.filter;
    for (const t of el.tabs.querySelectorAll(".tab")) {
      t.classList.toggle("active", t === btn);
    }
    renderList();
  });

  // --- Settings ---
  el.settingsBtn.addEventListener("click", () => {
    el.settingsMyName.value = state.data.users[0].name;
    el.settingsPartnerName.value = state.data.users[1].name;
    renderWhoamiOptions(el.settingsWhoami, state.whoami);
    el.settingsModal.classList.remove("hidden");
  });

  el.settingsCancel.addEventListener("click", () =>
    el.settingsModal.classList.add("hidden")
  );

  el.settingsModal.addEventListener("click", (e) => {
    if (e.target === el.settingsModal) el.settingsModal.classList.add("hidden");
  });

  el.settingsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const myName = el.settingsMyName.value.trim();
    const partnerName = el.settingsPartnerName.value.trim();
    if (!myName || !partnerName) return;
    state.data.users[0].name = myName;
    state.data.users[1].name = partnerName;
    state.whoami = el.settingsWhoami.value;
    localStorage.setItem(LS_WHOAMI, state.whoami);
    el.settingsModal.classList.add("hidden");
    render();
    try {
      await saveRemote("update names");
    } catch (err) {
      alert(err.message || "Sync failed — please refresh.");
    }
  });

  el.settingsLogout.addEventListener("click", () => {
    if (!confirm("Log out and clear your token on this device?")) return;
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_WHOAMI);
    state.token = "";
    state.whoami = "";
    el.settingsModal.classList.add("hidden");
    stopPolling();
    showSetup();
  });

  // --- Polling for remote updates ---
  let pollTimer = null;
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
      if (document.hidden) return;
      try {
        const prevSha = state.sha;
        await loadRemote();
        if (state.sha !== prevSha) render();
      } catch {}
    }, POLL_INTERVAL_MS);
  }
  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.token) {
      loadRemote().then(render).catch(() => {});
    }
  });

  // --- Boot ---
  (async function boot() {
    if (!state.token) {
      showSetup();
      return;
    }
    try {
      await loadRemote();
      if (!state.whoami || !userById(state.whoami)) {
        showSetup();
        return;
      }
      showMain();
      startPolling();
    } catch (err) {
      showSetup();
      el.setupError.textContent =
        "Saved token didn't work. Please paste a new one.";
    }
  })();
})();
