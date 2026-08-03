(() => {
  "use strict";

  const LOCAL_KEY = "monthly-operations-todo-tracker-v2";
  const LEGACY_KEY = "monthly-operations-todo-tracker-v1";
  const SYNC_META_KEY = "monthly-operations-todo-sync-v2";
  const TABLE = "tracker_profiles";
  const config = window.TRACKER_CONFIG;
  const defaults = window.DEFAULT_TASKS;
  const cloudConfig = window.CLOUD_CONFIG ?? {};
  const validSchedules = new Set(config.schedules.map((item) => item.id));
  const $ = (selector) => document.querySelector(selector);

  const ui = {
    period: $("#periodPicker"), ring: $("#progressRing"), percent: $("#progressPercent"),
    completed: $("#completedCount"), total: $("#totalCount"),
    completedMetric: $("#completedMetric"), completedNote: $("#completedNote"),
    pendingMetric: $("#pendingMetric"), pendingNote: $("#pendingNote"), groupMetric: $("#groupMetric"),
    visibleCount: $("#visibleCount"), allCount: $("#allFilterCount"), pendingCount: $("#pendingFilterCount"),
    completedFilterCount: $("#completedFilterCount"), groups: $("#taskGroups"), empty: $("#emptyState"),
    search: $("#searchInput"), scheduleFilter: $("#scheduleFilter"), statusFilters: $("#statusFilters"),
    clearFilters: $("#clearFiltersButton"), add: $("#addTaskButton"), dialog: $("#taskDialog"),
    form: $("#taskForm"), dialogTitle: $("#dialogTitle"), taskId: $("#taskId"), title: $("#taskTitle"),
    taskSchedule: $("#taskSchedule"), note: $("#taskNote"), taskCompleted: $("#taskCompleted"),
    titleCount: $("#titleCount"), closeDialog: $("#closeDialogButton"), cancelDialog: $("#cancelDialogButton"),
    export: $("#exportButton"), import: $("#importButton"), importFile: $("#importFile"), reset: $("#resetButton"),
    downloadPng: $("#downloadPngButton"), downloadJpg: $("#downloadJpgButton"),
    print: $("#printButton"), help: $("#keyboardHelpButton"), shortcutDialog: $("#shortcutDialog"),
    closeShortcut: $("#closeShortcutButton"), saveState: $("#saveState"), toast: $("#toast"),
    accountButton: $("#accountButton"), accountButtonText: $("#accountButtonText"), authDialog: $("#authDialog"),
    closeAuth: $("#closeAuthButton"), authDialogTitle: $("#authDialogTitle"), syncIntro: $("#syncIntro"),
    setupNotice: $("#setupNotice"), authForm: $("#authForm"), authEmail: $("#authEmail"),
    authPassword: $("#authPassword"), authMessage: $("#authMessage"), authSubmit: $("#authSubmitButton"),
    switchAuthMode: $("#switchAuthModeButton"), accountPanel: $("#accountPanel"), accountEmail: $("#accountEmail"),
    accountSyncStatus: $("#accountSyncStatus"), syncNow: $("#syncNowButton"), signOut: $("#signOutButton"),
  };

  const cloud = {
    client: null,
    session: null,
    channel: null,
    pollTimer: null,
    saveTimer: null,
    saving: false,
    saveAgain: false,
    dirty: false,
    configured: false,
    lastUpdatedAt: "",
    activeUserId: "",
  };

  let filters = { status: "all", schedule: "all", query: "" };
  let storageAvailable = true;
  let toastTimer;
  let authMode = "signin";
  let tracker = loadLocal();

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function id() {
    return crypto.randomUUID?.() ?? `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function normalize(task, index = 0) {
    if (!task || typeof task.title !== "string" || !task.title.trim()) return null;
    return {
      id: typeof task.id === "string" && task.id ? task.id : `import-${index}-${id()}`,
      schedule: validSchedules.has(task.schedule) ? task.schedule : "day-1",
      title: task.title.trim().slice(0, 240),
      note: typeof task.note === "string" ? task.note.trim().slice(0, 300) : "",
      completed: Boolean(task.completed),
      completedAt: typeof task.completedAt === "string" ? task.completedAt : null,
      createdAt: typeof task.createdAt === "string" ? task.createdAt : null,
    };
  }

  function freshTracker() {
    return {
      version: config.version,
      selectedPeriod: config.initialPeriod,
      periods: { [config.initialPeriod]: clone(defaults).map(normalize).filter(Boolean) },
    };
  }

  function sanitizeTracker(value) {
    if (!value?.periods || typeof value.periods !== "object") return null;
    const periods = {};
    Object.entries(value.periods).forEach(([period, taskList]) => {
      if (/^\d{4}-\d{2}$/.test(period) && Array.isArray(taskList)) {
        periods[period] = taskList.map(normalize).filter(Boolean);
      }
    });
    const keys = Object.keys(periods);
    if (!keys.length) return null;
    const selectedPeriod = periods[value.selectedPeriod] ? value.selectedPeriod : keys.sort().at(-1);
    return { version: config.version, selectedPeriod, periods };
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(LOCAL_KEY) ?? localStorage.getItem(LEGACY_KEY);
      if (!raw) return freshTracker();
      const parsed = sanitizeTracker(JSON.parse(raw));
      if (!parsed) return freshTracker();
      localStorage.setItem(LOCAL_KEY, JSON.stringify(parsed));
      return parsed;
    } catch (error) {
      console.warn("Could not load saved tracker data.", error);
      storageAvailable = false;
      return freshTracker();
    }
  }

  function saveLocal() {
    if (!storageAvailable) return false;
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(tracker));
      return true;
    } catch (error) {
      console.warn("Could not save tracker data.", error);
      storageAvailable = false;
      setSaveState("Browser saving unavailable", "error");
      return false;
    }
  }

  function hasPendingSync(userId) {
    if (!storageAvailable || !userId) return false;
    try {
      const value = JSON.parse(localStorage.getItem(SYNC_META_KEY) ?? "null");
      return value?.userId === userId && value?.dirty === true;
    } catch (error) {
      console.warn("Could not read cloud sync status.", error);
      return false;
    }
  }

  function rememberPendingSync(userId, dirty) {
    if (!storageAvailable || !userId) return;
    try {
      localStorage.setItem(SYNC_META_KEY, JSON.stringify({ userId, dirty, changedAt: new Date().toISOString() }));
    } catch (error) {
      console.warn("Could not remember cloud sync status.", error);
    }
  }

  function save({ sync = true } = {}) {
    const saved = saveLocal();
    if (!saved) return;
    if (sync && cloud.session) {
      cloud.dirty = true;
      rememberPendingSync(cloud.session.user.id, true);
      queueCloudSave();
    } else if (!cloud.session) {
      setSaveState(cloud.configured ? "Saved locally · Sign in to sync" : "Saved locally · Set up cloud sync", "local");
    }
  }

  function setSaveState(text, status = "saved") {
    ui.saveState.classList.toggle("is-saving", status === "saving");
    ui.saveState.classList.toggle("is-error", status === "error");
    ui.saveState.classList.toggle("is-synced", status === "synced");
    ui.saveState.classList.toggle("is-local", status === "local");
    ui.saveState.querySelector("span").textContent = text;
    if (cloud.session) ui.accountSyncStatus.textContent = text;
  }

  function tasks() {
    return tracker.periods[tracker.selectedPeriod] ?? [];
  }

  function schedule(idValue) {
    return config.schedules.find((item) => item.id === idValue) ?? config.schedules[0];
  }

  function periodLabel(period) {
    const [year, month] = period.split("-").map(Number);
    return new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
  }

  function esc(value) {
    return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }

  function matches(task) {
    if (filters.status === "pending" && task.completed) return false;
    if (filters.status === "completed" && !task.completed) return false;
    if (filters.schedule !== "all" && task.schedule !== filters.schedule) return false;
    return !filters.query || `${task.title} ${task.note}`.toLocaleLowerCase().includes(filters.query);
  }

  function render() {
    const all = tasks();
    const done = all.filter((task) => task.completed).length;
    const pending = all.length - done;
    const percent = all.length ? Math.round((done / all.length) * 100) : 0;
    const visible = all.filter(matches);

    ui.period.value = tracker.selectedPeriod;
    ui.ring.style.setProperty("--progress", percent);
    ui.percent.textContent = `${percent}%`;
    ui.completed.textContent = done;
    ui.total.textContent = all.length;
    ui.completedMetric.textContent = done;
    ui.completedNote.textContent = `${percent}% of monthly tasks`;
    ui.pendingMetric.textContent = pending;
    ui.pendingNote.textContent = `${100 - percent}% still to complete`;
    ui.groupMetric.textContent = new Set(all.map((task) => task.schedule)).size;
    ui.allCount.textContent = all.length;
    ui.pendingCount.textContent = pending;
    ui.completedFilterCount.textContent = done;
    ui.visibleCount.textContent = visible.length === all.length ? `Showing all ${all.length} tasks` : `Showing ${visible.length} of ${all.length} tasks`;
    document.title = `${periodLabel(tracker.selectedPeriod)} · Monthly To-Do Tracker`;

    ui.groups.innerHTML = config.schedules
      .map((item) => ({ item, tasks: visible.filter((task) => task.schedule === item.id) }))
      .filter((group) => group.tasks.length)
      .map(renderGroup)
      .join("");
    ui.empty.hidden = visible.length > 0;
  }

  function renderGroup(group) {
    const done = group.tasks.filter((task) => task.completed).length;
    const percent = Math.round((done / group.tasks.length) * 100);
    return `<section class="task-group" aria-labelledby="group-${group.item.id}">
      <header class="task-group__head"><div class="group-title"><i class="dot dot--${group.item.tone}"></i><div><h3 id="group-${group.item.id}">${esc(group.item.label)}</h3><p>${done} of ${group.tasks.length} completed</p></div></div>
      <div class="mini-progress"><span><i style="width:${percent}%"></i></span><b>${percent}%</b></div></header>
      <div class="task-list" role="list">${group.tasks.map((task, index) => renderTask(task, index)).join("")}</div></section>`;
  }

  function renderTask(task, index) {
    const item = schedule(task.schedule);
    return `<article class="task-row${task.completed ? " is-completed" : ""}" role="listitem">
      <button class="task-check" data-action="toggle" data-id="${esc(task.id)}" aria-label="${task.completed ? "Mark as pending" : "Mark as completed"}: ${esc(task.title)}" aria-pressed="${task.completed}"><svg viewBox="0 0 24 24"><path d="m6.5 12.5 3.3 3.3 7.7-8" /></svg></button>
      <span class="task-number">${String(index + 1).padStart(2, "0")}</span>
      <div class="task-copy"><h4>${esc(task.title)}</h4>${task.note ? `<p>${esc(task.note)}</p>` : ""}</div>
      <span class="status status--${task.completed ? "done" : "pending"}">${task.completed ? "Completed" : "Pending"}</span>
      <span class="schedule-pill schedule-pill--${item.tone}">${esc(item.short)}</span>
      <div class="task-actions"><button class="icon-button" data-action="edit" data-id="${esc(task.id)}" aria-label="Edit ${esc(task.title)}" title="Edit"><svg viewBox="0 0 24 24"><path d="m14 5 5 5M4 20l3.5-.7L19 7.8a2.1 2.1 0 0 0-3-3L4.7 16.3 4 20Z" /></svg></button>
      <button class="icon-button icon-button--danger" data-action="delete" data-id="${esc(task.id)}" aria-label="Delete ${esc(task.title)}" title="Delete"><svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V4h6v3M8 10v8M12 10v8M16 10v8M7 7l1 14h8l1-14" /></svg></button></div>
    </article>`;
  }

  function findTask(taskId) {
    return tasks().find((task) => task.id === taskId);
  }

  function toggle(taskId) {
    const task = findTask(taskId);
    if (!task) return;
    task.completed = !task.completed;
    task.completedAt = task.completed ? new Date().toISOString() : null;
    save();
    render();
    toast(task.completed ? "Task marked as completed." : "Task moved back to pending.", task.completed ? "success" : "neutral");
  }

  function openDialog(taskId = "") {
    ui.form.reset();
    ui.taskId.value = taskId;
    if (taskId) {
      const task = findTask(taskId);
      if (!task) return;
      ui.dialogTitle.textContent = "Edit task";
      ui.title.value = task.title;
      ui.taskSchedule.value = task.schedule;
      ui.note.value = task.note;
      ui.taskCompleted.checked = task.completed;
    } else {
      ui.dialogTitle.textContent = "Add a task";
      ui.taskSchedule.value = filters.schedule === "all" ? "day-1" : filters.schedule;
    }
    ui.titleCount.textContent = ui.title.value.length;
    ui.dialog.showModal();
    setTimeout(() => ui.title.focus(), 25);
  }

  function saveTask() {
    const title = ui.title.value.trim();
    if (!title) return ui.title.focus();
    const taskId = ui.taskId.value;
    const completed = ui.taskCompleted.checked;
    if (taskId) {
      const task = findTask(taskId);
      if (!task) return;
      const wasDone = task.completed;
      Object.assign(task, {
        title,
        schedule: ui.taskSchedule.value,
        note: ui.note.value.trim(),
        completed,
        completedAt: completed ? (wasDone ? task.completedAt : new Date().toISOString()) : null,
      });
      toast("Task updated.", "success");
    } else {
      tasks().push({
        id: id(),
        title,
        schedule: ui.taskSchedule.value,
        note: ui.note.value.trim(),
        completed,
        completedAt: completed ? new Date().toISOString() : null,
        createdAt: new Date().toISOString(),
      });
      toast("Task added.", "success");
    }
    save();
    render();
    ui.dialog.close();
  }

  function remove(taskId) {
    const task = findTask(taskId);
    if (!task || !confirm(`Delete “${task.title}”? This cannot be undone.`)) return;
    tracker.periods[tracker.selectedPeriod] = tasks().filter((item) => item.id !== taskId);
    save();
    render();
    toast("Task deleted.");
  }

  function resetFilters() {
    filters = { status: "all", schedule: "all", query: "" };
    ui.search.value = "";
    ui.scheduleFilter.value = "all";
    ui.statusFilters.querySelectorAll("button").forEach((button) => {
      const active = button.dataset.status === "all";
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active);
    });
  }

  function changePeriod(period) {
    if (!/^\d{4}-\d{2}$/.test(period)) return;
    tracker.selectedPeriod = period;
    if (!tracker.periods[period]) {
      tracker.periods[period] = clone(defaults).map((task, index) => normalize({
        ...task,
        id: `${task.id}-${period}-${index}`,
        completed: false,
        completedAt: null,
        createdAt: new Date().toISOString(),
      }, index));
      toast(`${periodLabel(period)} created with fresh tasks.`, "success");
    } else {
      toast(`${periodLabel(period)} opened.`);
    }
    resetFilters();
    save();
    render();
  }

  function setStatus(status) {
    filters.status = status;
    ui.statusFilters.querySelectorAll("button").forEach((button) => {
      const active = button.dataset.status === status;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active);
    });
    render();
  }

  function exportBackup() {
    const data = {
      app: "Monthly To-Do Tracker",
      version: config.version,
      exportedAt: new Date().toISOString(),
      selectedPeriod: tracker.selectedPeriod,
      periods: tracker.periods,
    };
    downloadBlob(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      `monthly-todo-backup-${new Date().toISOString().slice(0, 10)}.json`,
    );
    toast("Backup exported.", "success");
  }

  async function importBackup(file) {
    try {
      const imported = sanitizeTracker(JSON.parse(await file.text()));
      if (!imported) throw new Error("Invalid backup");
      tracker = imported;
      resetFilters();
      save();
      render();
      toast("Backup imported and queued for sync.", "success");
    } catch (error) {
      console.warn("Import failed.", error);
      toast("That file is not a valid tracker backup.", "error");
    } finally {
      ui.importFile.value = "";
    }
  }

  function resetMonth() {
    const label = periodLabel(tracker.selectedPeriod);
    if (!confirm(`Reset every task in ${label} to pending? Task names will be kept.`)) return;
    tasks().forEach((task) => {
      task.completed = false;
      task.completedAt = null;
    });
    save();
    render();
    toast(`${label} has been reset.`);
  }

  function toast(message, tone = "neutral") {
    clearTimeout(toastTimer);
    ui.toast.textContent = message;
    ui.toast.dataset.tone = tone;
    ui.toast.classList.add("is-visible");
    toastTimer = setTimeout(() => ui.toast.classList.remove("is-visible"), 3000);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement("a"), { href: url, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function roundedRect(ctx, x, y, width, height, radius, fill, stroke = "") {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  }

  function fitLines(ctx, text, maxWidth, maxLines = 2) {
    const words = String(text).replace(/\s+/g, " ").trim().split(" ");
    const lines = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
      } else if (!line) {
        let clipped = word;
        while (clipped.length > 1 && ctx.measureText(`${clipped}…`).width > maxWidth) clipped = clipped.slice(0, -1);
        lines.push(`${clipped}…`);
      } else {
        lines.push(line);
        line = word;
      }
      if (lines.length === maxLines) break;
    }
    if (lines.length < maxLines && line) lines.push(line);
    const usedWords = lines.join(" ").replace(/…/g, "").split(" ").length;
    if (usedWords < words.length && lines.length) {
      let last = lines[lines.length - 1];
      while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
      lines[lines.length - 1] = `${last.replace(/[.,;:]$/, "")}…`;
    }
    return lines.slice(0, maxLines);
  }

  function drawCheck(ctx, x, y, completed, color) {
    roundedRect(ctx, x, y, 30, 30, 8, completed ? color : "#ffffff", completed ? "" : "#b8c5d1");
    if (completed) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(x + 7, y + 15);
      ctx.lineTo(x + 13, y + 21);
      ctx.lineTo(x + 24, y + 9);
      ctx.stroke();
    }
  }

  function drawCardGroup(ctx, group, x, y, width, allTasks, tone) {
    const list = allTasks.filter((task) => task.schedule === group.id);
    const completed = list.filter((task) => task.completed).length;
    const headerHeight = 72;
    const rowHeight = 64;
    const height = headerHeight + (list.length * rowHeight) + 18;

    ctx.save();
    ctx.shadowColor = "rgba(9, 31, 55, .10)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
    roundedRect(ctx, x, y, width, height, 24, "#ffffff");
    ctx.restore();

    roundedRect(ctx, x, y, width, headerHeight, 24, "#f8fafc");
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(x, y + 36, width, 36);
    roundedRect(ctx, x + 22, y + 23, 12, 26, 6, tone);
    ctx.fillStyle = "#0c2340";
    ctx.font = "700 22px Arial, sans-serif";
    ctx.fillText(group.label, x + 50, y + 40);
    ctx.fillStyle = "#718196";
    ctx.font = "600 15px Arial, sans-serif";
    ctx.fillText(`${completed} of ${list.length} completed`, x + 50, y + 60);

    const percent = list.length ? Math.round((completed / list.length) * 100) : 0;
    roundedRect(ctx, x + width - 122, y + 24, 86, 31, 15, `${tone}18`);
    ctx.fillStyle = tone;
    ctx.font = "700 15px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`${percent}%`, x + width - 79, y + 45);
    ctx.textAlign = "left";

    list.forEach((task, index) => {
      const rowY = y + headerHeight + (index * rowHeight);
      if (index > 0) {
        ctx.strokeStyle = "#e8edf2";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 22, rowY);
        ctx.lineTo(x + width - 22, rowY);
        ctx.stroke();
      }
      drawCheck(ctx, x + 22, rowY + 17, task.completed, "#11966a");
      ctx.fillStyle = task.completed ? "#7b8b9d" : "#223b55";
      ctx.font = "600 17px Arial, sans-serif";
      const lines = fitLines(ctx, task.title, width - 150, 2);
      const firstBaseline = rowY + (lines.length === 1 ? 38 : 29);
      lines.forEach((line, lineIndex) => ctx.fillText(line, x + 68, firstBaseline + (lineIndex * 21)));
      ctx.fillStyle = task.completed ? "#0b7954" : "#9a6500";
      ctx.font = "700 11px Arial, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(task.completed ? "DONE" : "PENDING", x + width - 22, rowY + 38);
      ctx.textAlign = "left";
    });

    return height;
  }

  function createTaskCardCanvas() {
    const canvas = document.createElement("canvas");
    canvas.width = 1350;
    canvas.height = 1688;
    const ctx = canvas.getContext("2d");
    const all = tasks();
    const done = all.filter((task) => task.completed).length;
    const pending = all.length - done;
    const percent = all.length ? Math.round((done / all.length) * 100) : 0;
    const tones = { blue: "#2d6fbe", violet: "#7858b5", amber: "#d78a12", green: "#11966a" };

    ctx.fillStyle = "#edf3f8";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const headerGradient = ctx.createLinearGradient(0, 0, 1350, 300);
    headerGradient.addColorStop(0, "#07182d");
    headerGradient.addColorStop(0.65, "#123e68");
    headerGradient.addColorStop(1, "#1f5d91");
    ctx.fillStyle = headerGradient;
    ctx.fillRect(0, 0, 1350, 330);

    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    [120, 190, 260].forEach((radius) => {
      ctx.beginPath();
      ctx.arc(1240, 55, radius, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.restore();

    roundedRect(ctx, 62, 48, 52, 52, 15, "#11966a");
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(76, 73);
    ctx.lineTo(86, 83);
    ctx.lineTo(103, 64);
    ctx.stroke();
    ctx.fillStyle = "#8fe0c2";
    ctx.font = "700 18px Arial, sans-serif";
    ctx.letterSpacing = "2px";
    ctx.fillText("OPERATIONS CONTROL", 132, 80);
    ctx.letterSpacing = "0px";

    ctx.fillStyle = "#ffffff";
    ctx.font = "700 56px Arial, sans-serif";
    ctx.fillText("Monthly To-Do Tracker", 62, 162);
    ctx.fillStyle = "#c9d8e7";
    ctx.font = "400 24px Arial, sans-serif";
    ctx.fillText(`${periodLabel(tracker.selectedPeriod)} · Live monthly task status`, 64, 205);

    roundedRect(ctx, 1030, 116, 255, 92, 22, "rgba(5, 24, 45, .54)", "rgba(255, 255, 255, .16)");
    ctx.fillStyle = "#8fe0c2";
    ctx.font = "700 15px Arial, sans-serif";
    ctx.fillText("OVERALL PROGRESS", 1060, 148);
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 38px Arial, sans-serif";
    ctx.fillText(`${percent}%`, 1060, 190);
    ctx.fillStyle = "#c9d8e7";
    ctx.font = "600 16px Arial, sans-serif";
    ctx.fillText(`${done}/${all.length} complete`, 1160, 187);

    ctx.save();
    ctx.shadowColor = "rgba(9, 31, 55, .13)";
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 10;
    roundedRect(ctx, 60, 250, 1230, 160, 26, "#ffffff");
    ctx.restore();

    ctx.lineWidth = 18;
    ctx.strokeStyle = "#e5ebf1";
    ctx.beginPath();
    ctx.arc(164, 330, 55, -Math.PI / 2, (Math.PI * 3) / 2);
    ctx.stroke();
    ctx.strokeStyle = "#11966a";
    ctx.beginPath();
    ctx.arc(164, 330, 55, -Math.PI / 2, -Math.PI / 2 + ((Math.PI * 2 * percent) / 100));
    ctx.stroke();
    ctx.fillStyle = "#0c2340";
    ctx.font = "700 28px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`${percent}%`, 164, 339);
    ctx.textAlign = "left";
    ctx.fillStyle = "#718196";
    ctx.font = "700 13px Arial, sans-serif";
    ctx.fillText("MONTHLY COMPLETION", 250, 312);

    ctx.strokeStyle = "#e6ebf0";
    ctx.beginPath();
    ctx.moveTo(750, 280);
    ctx.lineTo(750, 380);
    ctx.moveTo(1010, 280);
    ctx.lineTo(1010, 380);
    ctx.stroke();

    [[done, "COMPLETED", "#11966a", 810], [pending, "PENDING", "#d78a12", 1070]].forEach(([value, label, color, x]) => {
      ctx.fillStyle = color;
      ctx.font = "700 48px Arial, sans-serif";
      ctx.fillText(String(value), x, 337);
      ctx.fillStyle = "#718196";
      ctx.font = "700 13px Arial, sans-serif";
      ctx.fillText(label, x, 365);
    });

    const leftX = 60;
    const rightX = 690;
    const columnWidth = 600;
    const topY = 450;
    const groupById = (groupId) => config.schedules.find((item) => item.id === groupId);

    const dayOne = groupById("day-1");
    const recurring = groupById("every-2-days");
    const dayTwo = groupById("day-2-5");
    const dayFive = groupById("day-5-10");
    const dayOneHeight = drawCardGroup(ctx, dayOne, leftX, topY, columnWidth, all, tones[dayOne.tone]);
    drawCardGroup(ctx, recurring, leftX, topY + dayOneHeight + 24, columnWidth, all, tones[recurring.tone]);
    const dayTwoHeight = drawCardGroup(ctx, dayTwo, rightX, topY, columnWidth, all, tones[dayTwo.tone]);
    drawCardGroup(ctx, dayFive, rightX, topY + dayTwoHeight + 24, columnWidth, all, tones[dayFive.tone]);

    ctx.fillStyle = "#718196";
    ctx.font = "600 15px Arial, sans-serif";
    ctx.fillText("Generated from the current live tracker", 62, 1625);
    ctx.textAlign = "right";
    ctx.fillText(new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date()), 1288, 1625);
    ctx.textAlign = "left";

    return canvas;
  }

  function downloadTaskCard(format) {
    try {
      const canvas = createTaskCardCanvas();
      const mime = format === "jpg" ? "image/jpeg" : "image/png";
      const extension = format === "jpg" ? "jpg" : "png";
      canvas.toBlob((blob) => {
        if (!blob) return toast("Could not create the image. Please try again.", "error");
        downloadBlob(blob, `monthly-todo-card-${tracker.selectedPeriod}.${extension}`);
        toast(`${extension.toUpperCase()} task card downloaded.`, "success");
      }, mime, format === "jpg" ? 0.94 : undefined);
    } catch (error) {
      console.warn("Task-card generation failed.", error);
      toast("Could not create the image. Please try again.", "error");
    }
  }

  function getSupabaseProjectUrl() {
    const value = String(cloudConfig.supabaseUrl ?? "").trim();
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co")) return "";
      if (/^\/rest\/v1\/?$/i.test(url.pathname)) url.pathname = "/";
      if (url.pathname.replace(/\/+$/, "")) return "";
      return url.origin;
    } catch {
      return "";
    }
  }

  function cloudIsConfigured() {
    const url = getSupabaseProjectUrl();
    const key = String(cloudConfig.supabaseAnonKey ?? "").trim();
    return Boolean(url) && key.length > 25 && !key.includes("YOUR_");
  }

  function queueCloudSave() {
    clearTimeout(cloud.saveTimer);
    setSaveState("Saving to cloud…", "saving");
    cloud.saveTimer = setTimeout(() => pushCloud(), 550);
  }

  async function pushCloud({ notify = false } = {}) {
    if (!cloud.client || !cloud.session) return;
    if (cloud.saving) {
      cloud.saveAgain = true;
      return;
    }
    cloud.saving = true;
    cloud.saveAgain = false;
    setSaveState("Saving to cloud…", "saving");
    const updatedAt = new Date().toISOString();
    try {
      const { data, error } = await cloud.client
        .from(TABLE)
        .upsert({ user_id: cloud.session.user.id, tracker_data: tracker, updated_at: updatedAt }, { onConflict: "user_id" })
        .select("updated_at")
        .single();
      if (error) throw error;
      cloud.lastUpdatedAt = data?.updated_at ?? updatedAt;
      cloud.dirty = false;
      rememberPendingSync(cloud.session.user.id, false);
      setSaveState("Synced to all devices", "synced");
      if (notify) toast("Tracker synced to all devices.", "success");
    } catch (error) {
      console.warn("Cloud save failed.", error);
      cloud.dirty = true;
      setSaveState("Saved locally · Cloud retry needed", "error");
      if (notify) toast("Saved locally. Cloud sync will retry when connected.", "error");
    } finally {
      cloud.saving = false;
      if (cloud.saveAgain) {
        cloud.saveAgain = false;
        pushCloud();
      }
    }
  }

  function sameTracker(first, second) {
    return JSON.stringify(first) === JSON.stringify(second);
  }

  async function pullCloud({ notify = false } = {}) {
    if (!cloud.client || !cloud.session) return;
    setSaveState("Checking cloud…", "saving");
    try {
      const { data, error } = await cloud.client
        .from(TABLE)
        .select("tracker_data, updated_at")
        .eq("user_id", cloud.session.user.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        await pushCloud({ notify });
        if (!notify) toast("Your existing tracker is now synced.", "success");
        return;
      }
      const remote = sanitizeTracker(data.tracker_data);
      if (!remote) throw new Error("Cloud tracker data is invalid.");
      cloud.lastUpdatedAt = data.updated_at ?? "";
      if (!sameTracker(remote, tracker)) {
        tracker = remote;
        resetFilters();
        saveLocal();
        render();
        if (!notify) toast("Updated from another device.", "success");
      }
      cloud.dirty = false;
      setSaveState("Synced to all devices", "synced");
      if (notify) toast("Tracker is up to date on all devices.", "success");
    } catch (error) {
      console.warn("Cloud refresh failed.", error);
      setSaveState("Saved locally · Cloud unavailable", "error");
      if (notify) toast("Cloud is unavailable right now. Your local copy is safe.", "error");
    }
  }

  function applyRealtimePayload(payload) {
    if (!payload?.new || payload.new.user_id !== cloud.session?.user.id) return;
    if (cloud.dirty) return;
    const remote = sanitizeTracker(payload.new.tracker_data);
    if (!remote) return;
    cloud.lastUpdatedAt = payload.new.updated_at ?? "";
    if (sameTracker(remote, tracker)) {
      cloud.dirty = false;
      setSaveState("Synced to all devices", "synced");
      return;
    }
    tracker = remote;
    cloud.dirty = false;
    resetFilters();
    saveLocal();
    render();
    setSaveState("Synced to all devices", "synced");
    toast("Tracker refreshed from another device.", "success");
  }

  function startRealtime() {
    if (!cloud.client || !cloud.session) return;
    if (cloud.channel) cloud.client.removeChannel(cloud.channel);
    cloud.channel = cloud.client
      .channel(`tracker-${cloud.session.user.id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: TABLE,
        filter: `user_id=eq.${cloud.session.user.id}`,
      }, applyRealtimePayload)
      .subscribe();
    clearInterval(cloud.pollTimer);
    cloud.pollTimer = setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine && !cloud.dirty) pullCloud();
    }, 30000);
  }

  function stopRealtime() {
    clearInterval(cloud.pollTimer);
    clearTimeout(cloud.saveTimer);
    if (cloud.channel && cloud.client) cloud.client.removeChannel(cloud.channel);
    cloud.channel = null;
    cloud.pollTimer = null;
  }

  function updateAccountUi() {
    const signedIn = Boolean(cloud.session);
    ui.accountButton.classList.toggle("is-signed-in", signedIn);
    ui.accountButtonText.textContent = signedIn ? (cloud.session.user.email?.split("@")[0] ?? "Account") : (cloud.configured ? "Sign in" : "Set up sync");
    ui.authForm.hidden = signedIn || !cloud.configured;
    ui.accountPanel.hidden = !signedIn;
    ui.setupNotice.hidden = cloud.configured;
    if (signedIn) ui.accountEmail.textContent = cloud.session.user.email ?? "Signed-in account";
  }

  async function applySession(session) {
    const nextUserId = session?.user?.id ?? "";
    if (nextUserId && nextUserId === cloud.activeUserId) {
      cloud.session = session;
      updateAccountUi();
      return;
    }
    stopRealtime();
    cloud.session = session;
    cloud.activeUserId = nextUserId;
    cloud.lastUpdatedAt = "";
    cloud.dirty = Boolean(session && hasPendingSync(nextUserId));
    updateAccountUi();
    if (!session) {
      setSaveState(cloud.configured ? "Saved locally · Sign in to sync" : "Saved locally · Set up cloud sync", "local");
      return;
    }
    if (cloud.dirty) await pushCloud();
    else await pullCloud();
    startRealtime();
  }

  async function initCloud() {
    cloud.configured = cloudIsConfigured();
    updateAccountUi();
    if (!cloud.configured) {
      setSaveState("Saved locally · Set up cloud sync", "local");
      return;
    }
    if (!window.supabase?.createClient) {
      setSaveState("Saved locally · Cloud library unavailable", "error");
      return;
    }
    try {
      cloud.client = window.supabase.createClient(getSupabaseProjectUrl(), cloudConfig.supabaseAnonKey.trim(), {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
      const { data, error } = await cloud.client.auth.getSession();
      if (error) throw error;
      await applySession(data.session);
      cloud.client.auth.onAuthStateChange((_event, session) => {
        setTimeout(() => applySession(session), 0);
      });
    } catch (error) {
      console.warn("Cloud initialization failed.", error);
      setSaveState("Saved locally · Cloud setup error", "error");
    }
  }

  function setAuthMode(mode) {
    authMode = mode;
    const creating = mode === "signup";
    ui.authDialogTitle.textContent = creating ? "Create your sync account" : "Sync to all devices";
    ui.authSubmit.textContent = creating ? "Create account & sync" : "Sign in & sync";
    ui.switchAuthMode.textContent = creating ? "Already have an account? Sign in" : "New here? Create an account";
    ui.authPassword.autocomplete = creating ? "new-password" : "current-password";
    ui.authMessage.textContent = "";
  }

  function openAuthDialog() {
    updateAccountUi();
    setAuthMode("signin");
    ui.authDialog.showModal();
    if (!cloud.session && cloud.configured) setTimeout(() => ui.authEmail.focus(), 25);
  }

  async function submitAuth(event) {
    event.preventDefault();
    if (!cloud.client) return;
    const email = ui.authEmail.value.trim();
    const password = ui.authPassword.value;
    ui.authSubmit.disabled = true;
    ui.authMessage.classList.remove("is-error", "is-success");
    ui.authMessage.textContent = authMode === "signup" ? "Creating your account…" : "Signing in…";
    try {
      if (authMode === "signup") {
        const redirectTo = new URL(".", window.location.href).href;
        const { data, error } = await cloud.client.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
        if (error) throw error;
        if (data.session) {
          await applySession(data.session);
          ui.authDialog.close();
          toast("Account created. Your tracker is syncing.", "success");
        } else {
          setAuthMode("signin");
          ui.authMessage.classList.add("is-success");
          ui.authMessage.textContent = "Check your email to confirm the account, then return here and sign in.";
        }
      } else {
        const { data, error } = await cloud.client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await applySession(data.session);
        ui.authDialog.close();
        toast("Signed in. Syncing your tracker…", "success");
      }
    } catch (error) {
      console.warn("Authentication failed.", error);
      ui.authMessage.classList.add("is-error");
      ui.authMessage.textContent = error?.message || "Could not complete sign-in. Please check your details.";
    } finally {
      ui.authSubmit.disabled = false;
    }
  }

  async function signOut() {
    if (!cloud.client) return;
    ui.signOut.disabled = true;
    try {
      const { error } = await cloud.client.auth.signOut();
      if (error) throw error;
      await applySession(null);
      ui.authDialog.close();
      toast("Signed out. This device keeps a local copy.");
    } catch (error) {
      console.warn("Sign-out failed.", error);
      toast("Could not sign out right now.", "error");
    } finally {
      ui.signOut.disabled = false;
    }
  }

  ui.groups.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    if (button.dataset.action === "toggle") toggle(button.dataset.id);
    if (button.dataset.action === "edit") openDialog(button.dataset.id);
    if (button.dataset.action === "delete") remove(button.dataset.id);
  });
  ui.statusFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-status]");
    if (button) setStatus(button.dataset.status);
  });
  ui.search.addEventListener("input", () => {
    filters.query = ui.search.value.trim().toLocaleLowerCase();
    render();
  });
  ui.scheduleFilter.addEventListener("change", () => {
    filters.schedule = ui.scheduleFilter.value;
    render();
  });
  ui.period.addEventListener("change", () => changePeriod(ui.period.value));
  ui.clearFilters.addEventListener("click", () => {
    resetFilters();
    render();
  });
  ui.add.addEventListener("click", () => openDialog());
  ui.closeDialog.addEventListener("click", () => ui.dialog.close());
  ui.cancelDialog.addEventListener("click", () => ui.dialog.close());
  ui.title.addEventListener("input", () => {
    ui.titleCount.textContent = ui.title.value.length;
  });
  ui.form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveTask();
  });
  ui.dialog.addEventListener("click", (event) => {
    if (event.target === ui.dialog) ui.dialog.close();
  });
  ui.export.addEventListener("click", exportBackup);
  ui.import.addEventListener("click", () => ui.importFile.click());
  ui.importFile.addEventListener("change", () => {
    if (ui.importFile.files[0]) importBackup(ui.importFile.files[0]);
  });
  ui.reset.addEventListener("click", resetMonth);
  ui.downloadPng.addEventListener("click", () => downloadTaskCard("png"));
  ui.downloadJpg.addEventListener("click", () => downloadTaskCard("jpg"));
  ui.print.addEventListener("click", () => print());
  ui.help.addEventListener("click", () => ui.shortcutDialog.showModal());
  ui.closeShortcut.addEventListener("click", () => ui.shortcutDialog.close());
  ui.shortcutDialog.addEventListener("click", (event) => {
    if (event.target === ui.shortcutDialog) ui.shortcutDialog.close();
  });
  ui.accountButton.addEventListener("click", openAuthDialog);
  ui.closeAuth.addEventListener("click", () => ui.authDialog.close());
  ui.authDialog.addEventListener("click", (event) => {
    if (event.target === ui.authDialog) ui.authDialog.close();
  });
  ui.authForm.addEventListener("submit", submitAuth);
  ui.switchAuthMode.addEventListener("click", () => setAuthMode(authMode === "signin" ? "signup" : "signin"));
  ui.syncNow.addEventListener("click", async () => {
    ui.syncNow.disabled = true;
    if (cloud.dirty) await pushCloud({ notify: true });
    else await pullCloud({ notify: true });
    ui.syncNow.disabled = false;
  });
  ui.signOut.addEventListener("click", signOut);
  window.addEventListener("online", () => {
    if (!cloud.session) return;
    if (cloud.dirty) pushCloud();
    else pullCloud();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && cloud.session && navigator.onLine) {
      if (cloud.dirty) pushCloud();
      else pullCloud();
    }
  });
  document.addEventListener("keydown", (event) => {
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
    const dialogOpen = ui.dialog.open || ui.shortcutDialog.open || ui.authDialog.open;
    if (event.key === "/" && !typing && !dialogOpen) {
      event.preventDefault();
      ui.search.focus();
    }
    if (event.key.toLocaleLowerCase() === "n" && !typing && !dialogOpen) {
      event.preventDefault();
      openDialog();
    }
  });

  render();
  saveLocal();
  initCloud();
})();
