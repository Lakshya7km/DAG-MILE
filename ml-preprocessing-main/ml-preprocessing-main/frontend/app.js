function resolveApiBase() {
  if (window.DAG_MILE_API) return window.DAG_MILE_API;
  if (typeof window !== "undefined" && window.location) {
    // Gateway-served pages, including Render, should call the same origin.
    if (window.location.port !== "8000") {
      return "";
    }
    // If the page was loaded directly from the Python backend on port 8000
    if (window.location.port === "8000") {
      const host = window.location.hostname || "127.0.0.1";
      return `${window.location.protocol}//${host}:4000`;
    }
  }
  return "http://127.0.0.1:4000";
}

const API_BASE = resolveApiBase();
const AUTH_BASE = resolveApiBase();

const state = {
  sessionId: null,
  pendingFiles: [],      // File objects, before upload
  uploadedFiles: [],     // [{filename, rows, cols, columns}]
  relationships: [],
  resolutions: {},       // key -> decision label, for UI state
  currentPreprocessFile: null,
  suggestions: null,
  baselineSuggestions: {}, // filename -> baseline suggestions before preprocessing
  comparisons: {},         // filename -> comparison diff object
  userEmail: null,
  currentProjectId: null,
  currentProjectName: null,
};

let qualityChartInstance = null;

// ---------------------------------------------------------------- Toast Notifications
function showToast(message, type = "info", duration = 4000) {
  const container = $("#toastContainer");
  if (!container) return;

  const icons = {
    success: "✅",
    error: "❌",
    warning: "⚠️",
    info: "ℹ️"
  };

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || "ℹ️"}</span>
    <span class="toast-msg">${message}</span>
    <button class="toast-close" type="button">✕</button>
  `;

  const closeBtn = toast.querySelector(".toast-close");
  const removeToast = () => {
    toast.classList.add("toast-hiding");
    setTimeout(() => toast.remove(), 250);
  };

  closeBtn.addEventListener("click", removeToast);
  container.appendChild(toast);

  if (duration > 0) {
    setTimeout(removeToast, duration);
  }
}

// ---------------------------------------------------------------- helpers
function $(sel) { return document.querySelector(sel); }
function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

function updateProjectContext() {
  const context = $("#projectContext");
  if (!context) return;
  if (!state.currentProjectName) {
    context.classList.add("hidden");
    return;
  }
  $("#projectContextName").textContent = state.currentProjectName;
  $("#projectContextMeta").textContent = state.sessionId
    ? "Saved session restored · latest dataset ready to review"
    : "New workspace · upload a dataset to start the preparation flow";
  context.classList.remove("hidden");
}

async function api(path, options = {}) {
  let token = localStorage.getItem("dagMileAccessToken");
  const headers = { ...(options.headers || {}) };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch (netErr) {
    throw new Error("Unable to connect to the DAG-MILE Gateway (port 4000). Please ensure 'run_all.bat' is running.");
  }

  // Handle Token Expiry (401/403) with Silent Auto-Refresh
  if ((res.status === 401 || res.status === 403) && !path.startsWith("/api/v1/login") && !path.startsWith("/api/v1/refresh")) {
    const refreshToken = localStorage.getItem("dagMileRefreshToken");
    if (refreshToken) {
      try {
        const refreshRes = await fetch(`${AUTH_BASE}/api/v1/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
        if (refreshRes.ok) {
          const refreshData = await refreshRes.json();
          if (refreshData.accessToken) {
            localStorage.setItem("dagMileAccessToken", refreshData.accessToken);
            token = refreshData.accessToken;
            headers["Authorization"] = `Bearer ${token}`;
            // Retry the original request with the fresh access token
            res = await fetch(`${API_BASE}${path}`, { ...options, headers });
          }
        } else {
          leaveWorkspace();
          throw new Error("Session expired. Please log in again.");
        }
      } catch (e) {
        leaveWorkspace();
        throw new Error("Session expired. Please log in again.");
      }
    }
  }

  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = j.detail || j.message || j.error || msg; } catch (e) { }
    throw new Error(msg);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res;
}

async function authRequest(path, body) {
  let res;
  try {
    res = await fetch(`${AUTH_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (netErr) {
    throw new Error("Unable to connect to the DAG-MILE Gateway (port 4000). Please ensure 'run_all.bat' is running.");
  }
  let data = {};
  try { data = await res.json(); } catch (e) { }
  if (!res.ok) throw new Error(data.error || data.Error || data.message || res.statusText);
  return data;
}

function enterWorkspace(email) {
  state.userEmail = email || "User";
  localStorage.setItem("dagMileUser", state.userEmail);
  $("#authScreen").classList.add("hidden");
  $("#workspace").classList.remove("hidden");
  $("#stepNav").classList.remove("hidden");
  $("#publicSignInBtn").classList.add("hidden");
  $("#accountBar").classList.remove("hidden");
  $("#accountLabel").textContent = state.userEmail;
  const avatarEl = $("#userAvatar");
  if (avatarEl) {
    avatarEl.textContent = state.userEmail.charAt(0).toUpperCase();
  }
  loadUserProjects();
  showStep("dashboard");
}

async function loadUserProjects() {
  const tbody = $("#projectsTableBody");
  if (!tbody) return;
  try {
    const res = await api("/api/v1/projects");
    // Deleted projects remain in PostgreSQL for audit metadata, but they must
    // not appear in the user's active workspace.
    const projects = (res.projects || []).filter(project => project.status !== "deleted");
    const countEl = $("#totalProjectsCount");
    if (countEl) countEl.textContent = projects.length;

    if (projects.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 24px;" class="muted">No projects found. Click "+ Create New Project" above to get started!</td></tr>`;
      return;
    }
    tbody.innerHTML = projects.map(p => {
      const dateStr = new Date(p.created_at).toLocaleDateString();
      const statusBadge = `<span style="color: var(--teal-light); font-size: 11px; background: rgba(16, 185, 129, 0.12); padding: 3px 8px; border-radius: 4px; border: 1px solid rgba(16, 185, 129, 0.3);">🟢 Active</span>`;
      const actionBtn = `<div style="display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap;">
           <button class="btn primary compact" onclick="openProjectWorkspace('${p.id}', '${p.name.replace(/'/g, "\\'")}', '${p.py_session_id || ''}')">📂 Open Project</button>
           <button class="btn ghost compact" style="color: var(--red); border-color: rgba(244, 63, 94, 0.3);" onclick="handleDeleteProject('${p.id}', '${p.name.replace(/'/g, "\\'")}')">🗑️ Delete</button>
         </div>`;

      return `<tr>
        <td><strong>${p.name}</strong></td>
        <td>${statusBadge}</td>
        <td><span class="mono">${p.file_count || 0} files</span></td>
        <td><span class="muted" style="font-size: 12px;">${dateStr}</span></td>
        <td style="text-align: right;">${actionBtn}</td>
      </tr>`;
    }).join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--amber); padding: 20px;">Failed to load projects: ${err.message}</td></tr>`;
  }
}

window.openProjectWorkspace = async function (projectId, projectName, pySessionId) {
  state.currentProjectId = projectId;
  state.currentProjectName = projectName;
  state.sessionId = pySessionId && pySessionId !== 'null' ? pySessionId : null;

  if ($("#activeProjectNameDisplay")) $("#activeProjectNameDisplay").textContent = projectName;
  if ($("#activeProjectHint")) $("#activeProjectHint").textContent = "Project active for pipeline";
  if ($("#uploadProjectSubtitle")) $("#uploadProjectSubtitle").textContent = `Uploading datasets for: ${projectName}`;
  updateProjectContext();

  try {
    const detail = await api(`/api/v1/projects/${projectId}`);
    const project = detail.project;
    state.sessionId = project.py_session_id || state.sessionId;
    state.uploadedFiles = (project.files || []).map(file => ({
      filename: file.filename,
      rows: file.rows || 0,
      cols: file.cols || 0,
      columns: [],
    }));
    state.currentPreprocessFile = state.uploadedFiles.at(-1)?.filename || null;

    if (!state.sessionId) {
      showToast("This new project has no processed dataset yet. Upload a dataset to begin.", "info");
      showStep("upload");
      return;
    }

    showStep("final");
    await loadFinalPanel();
  } catch (err) {
    showToast(`Could not restore project data: ${err.message}`, "error");
    showStep("dashboard");
  }
};

window.handleDeleteProject = async function (projectId, projectName) {
  const confirmed = confirm(`Delete project "${projectName}"?`);
  if (!confirmed) return;

  try {
    await api(`/api/v1/projects/${projectId}`, { method: "DELETE" });
    if (state.currentProjectId === projectId) {
      state.currentProjectId = null;
      state.currentProjectName = null;
      state.sessionId = null;
      $("#activeProjectNameDisplay").textContent = "None Selected";
      $("#activeProjectHint").textContent = "Select or create a project below";
    }
    showToast(`Project "${projectName}" deleted successfully!`, "success");
    await loadUserProjects();
  } catch (err) {
    showToast("Error deleting project: " + err.message, "error");
  }
};

// Project creation handlers
const openNewProjBtn = $("#openNewProjectBtn");
const cancelNewProjBtn = $("#cancelNewProjectBtn");
const newProjCard = $("#newProjectCard");
const createProjForm = $("#createProjectForm");

if (openNewProjBtn) {
  openNewProjBtn.addEventListener("click", () => {
    newProjCard.classList.remove("hidden");
    $("#newProjectNameInput").focus();
  });
}

if (cancelNewProjBtn) {
  cancelNewProjBtn.addEventListener("click", () => {
    newProjCard.classList.add("hidden");
    $("#createProjectStatus").textContent = "";
  });
}

if (createProjForm) {
  createProjForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nameInput = $("#newProjectNameInput");
    const statusEl = $("#createProjectStatus");
    const name = nameInput.value.trim();
    if (!name) return;

    statusEl.textContent = "Creating project...";
    try {
      const res = await api("/api/v1/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      nameInput.value = "";
      newProjCard.classList.add("hidden");
      statusEl.textContent = "";
      showToast(`Project "${res.project.name}" created successfully!`, "success");
      await loadUserProjects();
      openProjectWorkspace(res.project.id, res.project.name, null);
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
      showToast("Could not create project: " + err.message, "error");
    }
  });
}

const refreshBtn = $("#refreshProjectsBtn");
if (refreshBtn) refreshBtn.addEventListener("click", loadUserProjects);

async function leaveWorkspace() {
  const refreshToken = localStorage.getItem("dagMileRefreshToken");
  if (refreshToken) {
    try {
      await fetch(`${AUTH_BASE}/api/v1/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
    } catch (e) { }
  }
  state.userEmail = null;
  state.sessionId = null;
  state.currentProjectId = null;
  state.currentProjectName = null;
  localStorage.removeItem("dagMileUser");
  localStorage.removeItem("dagMileAccessToken");
  localStorage.removeItem("dagMileRefreshToken");
  $("#workspace").classList.add("hidden");
  $("#stepNav").classList.add("hidden");
  $("#publicSignInBtn").classList.remove("hidden");
  $("#accountBar").classList.add("hidden");
  $("#authScreen").classList.remove("hidden");
  $("#authStatus").textContent = "";
  updateProjectContext();
}

function setAuthTab(tab) {
  $all("[data-auth-tab]").forEach(button => button.classList.toggle("active", button.dataset.authTab === tab));
  $("#loginForm").classList.toggle("hidden", tab !== "login");
  $("#registerForm").classList.toggle("hidden", tab !== "register");
  $("#authStatus").textContent = "";
}

$all("[data-auth-tab]").forEach(button => button.addEventListener("click", () => setAuthTab(button.dataset.authTab)));
$("#publicSignInBtn").addEventListener("click", () => {
  setAuthTab("login");
  $(".auth-card").scrollIntoView({ behavior: "smooth", block: "center" });
});

async function submitAuth(form, endpoint, successMessage) {
  const formData = new FormData(form);
  const email = formData.get("email");
  const password = formData.get("password");
  const submitButton = form.querySelector("button[type=submit]");
  submitButton.disabled = true;
  submitButton.textContent = "Authenticating…";
  $("#authStatus").textContent = "";
  try {
    const data = await authRequest(endpoint, { email, password });
    if (endpoint.endsWith("register")) {
      const loginData = await authRequest("/api/v1/login", { email, password });
      if (loginData.accessToken) {
        localStorage.setItem("dagMileAccessToken", loginData.accessToken);
        localStorage.setItem("dagMileRefreshToken", loginData.refreshToken);
      }
      showToast("Workspace account initialized! Welcome to DAG-MILE.", "success");
      enterWorkspace(email);
    } else {
      if (data.accessToken) {
        localStorage.setItem("dagMileAccessToken", data.accessToken);
        localStorage.setItem("dagMileRefreshToken", data.refreshToken);
      }
      showToast("Authenticated into workspace.", "success");
      enterWorkspace(email);
    }
  } catch (err) {
    $("#authStatus").textContent = err.message;
    showToast(err.message, "error");
    if (err.message.includes("create an account")) {
      const regEmail = $("#registerForm input[type=email]");
      if (regEmail && email) regEmail.value = email;
    }
    if (err.message.includes("already registered")) {
      const logEmail = $("#loginForm input[type=email]");
      if (logEmail && email) logEmail.value = email;
    }
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = endpoint.endsWith("register") ? "Create Workspace Account →" : "Enter Workspace →";
  }
}

$("#loginForm").addEventListener("submit", event => {
  event.preventDefault();
  submitAuth(event.currentTarget, "/api/v1/login", "Login failed");
});
$("#registerForm").addEventListener("submit", event => {
  event.preventDefault();
  submitAuth(event.currentTarget, "/api/v1/register", "Registration failed");
});
$("#logoutBtn").addEventListener("click", leaveWorkspace);
$("#returnToProjectsBtn").addEventListener("click", () => showStep("dashboard"));
$("#startPipelineBtn").addEventListener("click", () => {
  showStep("upload");
  $("#dropzone").scrollIntoView({ behavior: "smooth", block: "center" });
});

const savedUser = localStorage.getItem("dagMileUser");
const savedToken = localStorage.getItem("dagMileAccessToken");
if (savedUser && savedToken && savedUser !== "Local demo") {
  enterWorkspace(savedUser);
} else {
  leaveWorkspace();
}

function showStep(name) {
  $all(".panel").forEach(p => p.classList.add("hidden"));
  const panel = $(`#panel-${name}`);
  if (panel) panel.classList.remove("hidden");

  // Manage project context bar visibility (show during pipeline, hide on dashboard)
  const context = $("#projectContext");
  if (context) {
    if (name === "dashboard" || !state.currentProjectName) {
      context.classList.add("hidden");
    } else {
      context.classList.remove("hidden");
    }
  }

  const workflow = ["upload", "analysis", "schema", "preprocess", "final"];
  const currentIndex = workflow.indexOf(name);
  $all(".step-btn").forEach(s => {
    const isActive = s.dataset.step === name;
    const isComplete = currentIndex > workflow.indexOf(s.dataset.step) && workflow.includes(s.dataset.step);
    s.classList.toggle("active", isActive);
    s.classList.toggle("complete", isComplete);
    s.setAttribute("aria-current", isActive ? "step" : "false");
  });
}

async function navigateToStep(name) {
  if (name === "dashboard") {
    await loadUserProjects();
    showStep("dashboard");
    return;
  }

  if (name === "upload") {
    showStep("upload");
    return;
  }

  // Steps 2 through 5 require an active session
  if (!state.sessionId) {
    showToast("Please upload a dataset first to proceed to this pipeline stage.", "warning");
    showStep("upload");
    return;
  }

  if (name === "analysis") {
    if (!state.profiles || Object.keys(state.profiles).length === 0) {
      await runAnalysis();
    }
    showStep("analysis");
    return;
  }

  if (name === "schema") {
    renderConflicts();
    populateMergeSelectors();
    showStep("schema");
    return;
  }

  if (name === "preprocess") {
    fillSelect($("#preprocessFileSelect"), state.uploadedFiles.map(f => f.filename));
    if (!state.currentPreprocessFile && state.uploadedFiles.length) {
      state.currentPreprocessFile = state.uploadedFiles[0].filename;
    }
    if (state.currentPreprocessFile) {
      $("#preprocessFileSelect").value = state.currentPreprocessFile;
    }
    await loadSuggestions();
    showStep("preprocess");
    return;
  }

  if (name === "final") {
    await loadFinalPanel();
    showStep("final");
    return;
  }

  showStep(name);
}

$all("[data-back]").forEach(btn => {
  btn.addEventListener("click", () => navigateToStep(btn.dataset.back));
});

$all(".step-btn").forEach(step => {
  step.addEventListener("click", () => {
    if (step.dataset.step) navigateToStep(step.dataset.step);
  });
});

// ---------------------------------------------------------------- STEP 1: upload
const dropzone = $("#dropzone");
const fileInput = $("#fileInput");

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("dragover", e => { e.preventDefault(); dropzone.classList.add("dragover"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
dropzone.addEventListener("drop", e => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  addPendingFiles(e.dataTransfer.files);
});
fileInput.addEventListener("change", () => addPendingFiles(fileInput.files));

function addPendingFiles(fileList) {
  const allowed = [
    ".csv",
    ".tsv",
    ".xlsx",
    ".xls",
    ".xlsm",
    ".xlsb",
    ".json",
    ".ods"
  ];

  for (const f of fileList) {
    const name = f.name.toLowerCase();

    // Ignore Excel temporary/lock files
    if (name.startsWith("~$")) {
      continue;
    }

    if (allowed.some(ext => name.endsWith(ext))) {
      state.pendingFiles.push(f);
    }
  }

  renderPendingFiles();
}

function renderPendingFiles() {
  const ul = $("#pendingFiles");
  ul.innerHTML = "";
  state.pendingFiles.forEach((f, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${f.name}</span>`;
    const rm = document.createElement("button");
    rm.textContent = "✕";
    rm.addEventListener("click", () => {
      state.pendingFiles.splice(i, 1);
      renderPendingFiles();
    });
    li.appendChild(rm);
    ul.appendChild(li);
  });
  $("#analyzeBtn").disabled = state.pendingFiles.length === 0;
}

$("#analyzeBtn").addEventListener("click", async () => {
  const btn = $("#analyzeBtn");
  btn.disabled = true;
  btn.textContent = "Uploading…";
  try {
    const form = new FormData();
    if (state.sessionId) form.append("session_id", state.sessionId);
    if (state.currentProjectId) form.append("project_id", state.currentProjectId);
    state.pendingFiles.forEach(f => form.append("files", f));

    const uploadRes = await api("/api/upload", { method: "POST", body: form });
    state.sessionId = uploadRes.session_id;
    const newFiles = uploadRes.files || [];
    const fileMap = new Map((state.uploadedFiles || []).map(f => [f.filename, f]));
    newFiles.forEach(f => fileMap.set(f.filename, f));
    state.uploadedFiles = Array.from(fileMap.values());
    state.pendingFiles = [];
    renderPendingFiles();
    loadUserProjects();
    showToast(`Uploaded ${uploadRes.files.length} dataset file(s) to Cloud & ML Engine!`, "success");

    if (uploadRes.errors && uploadRes.errors.length) {
      showToast("Some files could not be read: " + uploadRes.errors.map(e => e.filename).join(", "), "warning");
    }

    await runAnalysis();
    showStep("analysis");
  } catch (err) {
    showToast("Upload failed: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Analyze & Upload →";
  }
});

// ---------------------------------------------------------------- Live Dataset Preview Modal
window.openPreviewModal = async function (filename) {
  const modal = $("#previewModal");
  const thead = $("#previewTableHead");
  const tbody = $("#previewTableBody");
  const title = $("#previewModalTitle");
  const subtitle = $("#previewModalSubtitle");

  if (!state.sessionId) {
    showToast("No active session found. Please upload a dataset first.", "warning");
    return;
  }

  title.textContent = `👁️ Dataset Preview: ${filename}`;
  subtitle.textContent = "Fetching first 10 rows from ML engine...";
  thead.innerHTML = "";
  tbody.innerHTML = `<tr><td style="text-align:center; padding: 24px;" class="muted">Loading dataset preview...</td></tr>`;
  modal.classList.remove("hidden");

  try {
    const previewData = await api(`/api/v1/preview/${encodeURIComponent(state.sessionId)}/${encodeURIComponent(filename)}`);
    subtitle.textContent = `Showing first ${previewData.previewRowCount || (previewData.rows ? previewData.rows.length : 0)} rows (${(previewData.columns || []).length} columns)`;

    // Render Table Header
    thead.innerHTML = `<tr>${(previewData.columns || []).map(col => `<th>${escapeHtml(col)}</th>`).join("")}</tr>`;

    // Render Table Rows
    if (!previewData.rows || previewData.rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${(previewData.columns || []).length || 1}" style="text-align:center;" class="muted">No data rows available in file.</td></tr>`;
    } else {
      tbody.innerHTML = previewData.rows.map(row => {
        return `<tr>${row.map(cell => `<td class="mono-cell">${cell !== null && cell !== undefined ? escapeHtml(cell) : '<span class="muted">null</span>'}</td>`).join("")}</tr>`;
      }).join("");
    }
  } catch (err) {
    subtitle.textContent = "Preview error";
    tbody.innerHTML = `<tr><td style="text-align:center; color: var(--red); padding: 20px;">Failed to load preview: ${escapeHtml(err.message)}</td></tr>`;
  }
};

function closePreviewModal() {
  const modal = $("#previewModal");
  if (modal) modal.classList.add("hidden");
}

const closePreviewModalBtn = $("#closePreviewModalBtn");
const closePreviewBtn = $("#closePreviewBtn");
const previewModalBackdrop = $("#previewModal");

if (closePreviewModalBtn) closePreviewModalBtn.addEventListener("click", closePreviewModal);
if (closePreviewBtn) closePreviewBtn.addEventListener("click", closePreviewModal);
if (previewModalBackdrop) {
  previewModalBackdrop.addEventListener("click", (e) => {
    if (e.target === previewModalBackdrop) closePreviewModal();
  });
}

// ---------------------------------------------------------------- Interactive Quality Chart
function renderQualityChart(profiles) {
  const canvas = document.getElementById("qualityChart");
  if (!canvas || typeof Chart === "undefined") return;

  if (qualityChartInstance) {
    qualityChartInstance.destroy();
    qualityChartInstance = null;
  }

  const fileNames = Object.keys(profiles);
  if (fileNames.length === 0) return;

  // Extract labels and metric arrays
  const labels = [];
  const missingPcts = [];
  const duplicatePcts = [];

  fileNames.forEach(fname => {
    const p = profiles[fname];
    labels.push(fname);
    missingPcts.push(parseFloat(p.missing_cells_pct) || 0);
    duplicatePcts.push(parseFloat(p.duplicate_pct) || 0);
  });

  const ctx = canvas.getContext("2d");
  qualityChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Missing Cells (%)",
          data: missingPcts,
          backgroundColor: "rgba(244, 63, 94, 0.75)",
          borderColor: "rgba(244, 63, 94, 1)",
          borderWidth: 1,
          borderRadius: 4,
        },
        {
          label: "Duplicate Rows (%)",
          data: duplicatePcts,
          backgroundColor: "rgba(245, 158, 11, 0.75)",
          borderColor: "rgba(245, 158, 11, 1)",
          borderWidth: 1,
          borderRadius: 4,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          ticks: {
            color: "#94a3b8",
            callback: (v) => v + "%",
          },
          grid: {
            color: "rgba(255, 255, 255, 0.06)",
          }
        },
        x: {
          ticks: {
            color: "#cbd5e1",
            font: { family: "'JetBrains Mono', monospace", size: 11 }
          },
          grid: { display: false }
        }
      },
      plugins: {
        legend: {
          labels: {
            color: "#f8fafc",
            font: { family: "'Plus Jakarta Sans', sans-serif", weight: 600 }
          }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${ctx.raw}%`
          }
        }
      }
    }
  });
}

// ---------------------------------------------------------------- STEP 2: analysis
async function runAnalysis() {
  const data = await api(`/api/analyze/${state.sessionId}`);
  state.relationships = data.relationships;
  state.profiles = data.profiles;

  $("#fileCount").textContent = Object.keys(data.profiles).length;
  const tbody = $("#fileTable tbody");
  tbody.innerHTML = "";
  for (const [fname, p] of Object.entries(data.profiles)) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="mono-cell"><strong>${fname}</strong></td>
      <td class="mono-cell">${p.n_rows.toLocaleString()} × ${p.n_cols}</td>
      <td>${p.missing_cells_pct}%</td>
      <td>${p.duplicate_rows} (${p.duplicate_pct}%)</td>
      <td>
        <button class="btn secondary compact" onclick="openPreviewModal('${fname.replace(/'/g, "\\'")}')">👁️ Preview</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  // Render Visual Quality Distribution Chart
  renderQualityChart(data.profiles);
}

$("#toSchemaBtn").addEventListener("click", () => {
  renderConflicts();
  populateMergeSelectors();
  showStep("schema");
});

// ---------------------------------------------------------------- STEP 3: schema matching
function renderConflicts() {
  const container = $("#conflictList");
  const empty = $("#noConflicts");
  container.innerHTML = "";

  if (!state.relationships.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  const summary = document.createElement("div");
  summary.className = "schema-summary";
  summary.textContent = `${state.relationships.length} meaningful schema relationship${state.relationships.length === 1 ? "" : "s"} found`;
  container.appendChild(summary);

  state.relationships.forEach((r, idx) => {
    const key = `${r.file_a}:${r.column_a}::${r.file_b}:${r.column_b}`;
    const card = document.createElement("div");
    const cls = r.relationship === "conflict" ? "" : r.relationship === "join_key" ? "join-key" : "same-feature";
    card.className = `conflict-card ${cls}`;

    const headlineText = r.relationship === "conflict" ? "⚠ POSSIBLE FEATURE CONFLICT"
      : r.relationship === "join_key" ? "🔗 POSSIBLE JOIN KEY"
        : "≈ POSSIBLY THE SAME FEATURE";

    card.innerHTML = `
      <div class="headline">${headlineText}</div>
      <div class="cols">${r.file_a} → ${r.column_a}  /  ${r.file_b} → ${r.column_b}${r.files_count > 2 ? ` · present in ${r.files_count} files` : ""}</div>
      <div class="note">${r.note}</div>
      <div class="confidence">Recommendation: <strong>${r.recommendation}</strong> · Confidence: ${Math.round(r.confidence * 100)}%</div>
      <div class="row-actions" data-key="${key}"></div>
    `;

    const actions = card.querySelector(".row-actions");
    if (r.relationship === "conflict") {
      addActionButton(actions, key, "keep_separate", "Keep Separate", r);
      addActionButton(actions, key, "rename_a", `Rename '${r.column_a}' in ${r.file_a}`, r);
      addActionButton(actions, key, "rename_b", `Rename '${r.column_b}' in ${r.file_b}`, r);
    } else {
      addActionButton(actions, key, "keep_separate", "Acknowledge", r);
    }
    container.appendChild(card);
  });
}

function addActionButton(container, key, decision, label, r) {
  const btn = document.createElement("button");
  btn.textContent = label;
  btn.addEventListener("click", async () => {
    let newName = null;
    if (decision.startsWith("rename")) {
      const current = decision === "rename_a" ? r.column_a : r.column_b;
      newName = prompt(`New name for '${current}':`, `${current}_${decision === "rename_a" ? r.file_a.split(".")[0] : r.file_b.split(".")[0]}`);
      if (!newName) return;
    }
    try {
      await api(`/api/resolve-conflict/${state.sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_a: r.file_a, column_a: r.column_a,
          file_b: r.file_b, column_b: r.column_b,
          decision, new_name: newName,
        }),
      });
      container.querySelectorAll("button").forEach(b => b.classList.remove("chosen"));
      btn.classList.add("chosen");
      showToast(`Conflict resolution applied: ${decision}`, "success");
      if (newName) refreshFileColumnsAfterRename();
    } catch (err) {
      showToast("Could not apply resolution: " + err.message, "error");
    }
  });
  container.appendChild(btn);
}

async function refreshFileColumnsAfterRename() {
  await runAnalysis();
}

function populateMergeSelectors() {
  const fileNames = state.uploadedFiles.map(f => f.filename);
  fillSelect($("#mergeFileA"), fileNames);
  fillSelect($("#mergeFileB"), fileNames.length > 1 ? [fileNames[1], ...fileNames.filter((_, i) => i !== 1)] : fileNames);
  updateMergeColumnOptions();
}

function fillSelect(select, options) {
  select.innerHTML = "";
  options.forEach(o => {
    const opt = document.createElement("option");
    opt.value = o; opt.textContent = o;
    select.appendChild(opt);
  });
}

function updateMergeColumnOptions() {
  const fa = state.uploadedFiles.find(f => f.filename === $("#mergeFileA").value);
  const fb = state.uploadedFiles.find(f => f.filename === $("#mergeFileB").value);
  fillSelect($("#mergeColA"), fa ? fa.columns : []);
  fillSelect($("#mergeColB"), fb ? fb.columns : []);
}
$("#mergeFileA").addEventListener("change", updateMergeColumnOptions);
$("#mergeFileB").addEventListener("change", updateMergeColumnOptions);
$("#mergeOp").addEventListener("change", () => {
  $("#joinKeysRow").classList.toggle("hidden", $("#mergeOp").value !== "join");
});

$("#mergeBtn").addEventListener("click", async () => {
  const op = $("#mergeOp").value;
  const fileA = $("#mergeFileA").value;
  const fileB = $("#mergeFileB").value;
  const newName = $("#mergeName").value.trim() || `merged_${Date.now()}.csv`;
  if (fileA === fileB) {
    showToast("Please choose two different files to merge.", "warning");
    return;
  }

  const body = { operation: op, file_a: fileA, file_b: fileB, new_name: newName };
  if (op === "join") {
    body.column_a = $("#mergeColA").value;
    body.column_b = $("#mergeColB").value;
    body.how = $("#mergeHow").value;
  }

  const status = $("#mergeStatus");
  status.textContent = "Merging…";
  try {
    const res = await api(`/api/merge/${state.sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    state.uploadedFiles.push(res.new_file);
    status.textContent = `✓ Created ${res.new_file.filename} (${res.new_file.rows} rows × ${res.new_file.cols} cols)`;
    showToast(`Merged files into "${res.new_file.filename}" successfully!`, "success");
    populateMergeSelectors();
    await runAnalysis();
  } catch (err) {
    status.textContent = "";
    showToast("Merge failed: " + err.message, "error");
  }
});

$("#toPreprocessBtn").addEventListener("click", async () => {
  fillSelect($("#preprocessFileSelect"), state.uploadedFiles.map(f => f.filename));
  state.currentPreprocessFile = $("#preprocessFileSelect").value;
  await loadSuggestions();
  showStep("preprocess");
});

// ---------------------------------------------------------------- STEP 4: preprocessing
$("#preprocessFileSelect").addEventListener("change", async () => {
  state.currentPreprocessFile = $("#preprocessFileSelect").value;
  await loadSuggestions();
});

async function loadSuggestions() {
  if (!state.currentPreprocessFile) return;
  const data = await api(`/api/preprocess-suggestions/${state.sessionId}/${encodeURIComponent(state.currentPreprocessFile)}`);
  state.suggestions = data;
  state.baselineSuggestions[state.currentPreprocessFile] = JSON.parse(JSON.stringify(data));
  renderQualitySummary(data);
  renderSuggestTable(data);
  $("#dupCount").textContent = data.duplicate_rows;
  $("#dropDupCheckbox").checked = data.duplicate_rows > 0;
}

function renderQualitySummary(data) {
  const box = $("#qualitySummary");
  box.innerHTML = `
    <div class="metric"><span class="value">${data.n_rows.toLocaleString()}</span><span class="label">ROWS</span></div>
    <div class="metric"><span class="value">${data.duplicate_pct}%</span><span class="label">DUPLICATE ROWS</span></div>
    <div class="metric"><span class="value">${data.outlier_rows_estimate}</span><span class="label">POTENTIAL OUTLIERS</span></div>
  `;
}

const MISSING_OPTIONS = {
  numeric: ["none", "median", "mean", "constant", "drop_rows"],
  categorical: ["none", "most_frequent", "constant", "drop_rows"],
  boolean: ["none", "most_frequent", "constant", "drop_rows"],
  identifier: ["none", "drop_rows"],
  text: ["none", "drop_rows"],
  datetime: ["none", "drop_rows"],
};
const ENCODE_OPTIONS = ["none", "onehot", "label"];
const SCALE_OPTIONS = ["none", "standard", "minmax"];
const OUTLIER_OPTIONS = ["none", "keep", "winsorize", "remove"];

function renderSuggestTable(data) {
  const tbody = $("#suggestTable tbody");
  tbody.innerHTML = "";
  data.columns.forEach(col => {
    const tr = document.createElement("tr");
    tr.dataset.column = col.column;
    tr.dataset.type = col.feature_type;

    const missingCell = col.missing_count > 0
      ? `${col.missing_count} (${col.missing_pct}%)` : "—";
    const outlierCell = col.outlier_count !== undefined
      ? (col.outlier_count > 0 ? `${col.outlier_count} (${col.outlier_pct}%)` : "—")
      : "—";

    tr.innerHTML = `
      <td class="mono-cell">${col.column}</td>
      <td class="mono-cell">${col.feature_type}</td>
      <td>${missingCell}</td>
      <td>${selectHtml("missing", MISSING_OPTIONS[col.feature_type] || ["none"], col.missing_strategy || "none")}</td>
      <td>${outlierCell}</td>
      <td>${col.feature_type === "numeric" ? selectHtml("outlier", OUTLIER_OPTIONS, col.outlier_action || "none") : "—"}</td>
      <td>${col.feature_type === "categorical" || col.feature_type === "boolean" ? selectHtml("encode", ENCODE_OPTIONS, col.encode || "none") : "—"}</td>
      <td>${col.feature_type === "numeric" ? selectHtml("scale", SCALE_OPTIONS, col.scale || "none") : "—"}</td>
    `;
    tbody.appendChild(tr);
  });
}

function selectHtml(name, options, selected) {
  const opts = options.map(o => `<option value="${o}" ${o === selected ? "selected" : ""}>${o}</option>`).join("");
  return `<select data-field="${name}">${opts}</select>`;
}

$("#applyBtn").addEventListener("click", async () => {
  const btn = $("#applyBtn");
  btn.disabled = true;
  btn.textContent = "Applying…";
  try {
    const columns = {};
    $all("#suggestTable tbody tr").forEach(tr => {
      const col = tr.dataset.column;
      const cfg = {};
      tr.querySelectorAll("select[data-field]").forEach(sel => {
        const field = sel.dataset.field;
        const val = sel.value;
        if (field === "missing") cfg.missing_strategy = val;
        if (field === "outlier") cfg.outlier_action = val;
        if (field === "encode") cfg.encode = val;
        if (field === "scale") cfg.scale = val;
      });
      columns[col] = cfg;
    });

    const body = { drop_duplicates: $("#dropDupCheckbox").checked, columns };
    const res = await api(`/api/preprocess/${state.sessionId}/${encodeURIComponent(state.currentPreprocessFile)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    // ── Build Client-Side Cached Comparison Diff (Zero DB queries) ─────────────
    const filename = state.currentPreprocessFile;
    const beforeData = state.baselineSuggestions[filename] || state.suggestions || { columns: [] };
    const missingBefore = (beforeData.columns || []).reduce((acc, col) => acc + (Number(col.missing_count) || 0), 0);
    const profileCols = res.profile?.columns || {};
    const missingAfter = Object.values(profileCols).reduce((acc, col) => acc + (Number(col.missing_count) || 0), 0);

    const comparison = {
      filename,
      timestamp: new Date().toLocaleTimeString(),
      before: {
        rows: beforeData.n_rows || (beforeData.columns?.[0]?.total_count) || 0,
        cols: (beforeData.columns || []).length,
        missing: missingBefore,
        duplicates: beforeData.duplicate_rows || 0,
        columns: beforeData.columns || [],
      },
      after: {
        rows: res.shape?.[0] || 0,
        cols: res.shape?.[1] || Object.keys(profileCols).length,
        missing: missingAfter,
        duplicates: res.profile?.duplicate_rows || 0,
        columns: Object.keys(profileCols),
        profile: res.profile,
      },
      config: body,
      log: res.log || [],
    };

    state.comparisons[filename] = comparison;
    try {
      sessionStorage.setItem(`dagMile_cmp_${state.sessionId}_${filename}`, JSON.stringify(comparison));
    } catch (e) {}

    showToast("Preprocessing transformations applied successfully!", "success");
    await loadFinalPanel();
    showStep("final");
  } catch (err) {
    showToast("Preprocessing failed: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Apply Preprocessing →";
  }
});

// ---------------------------------------------------------------- STEP 5: final & comparison
function renderComparison(filename) {
  const container = $("#comparisonSection");
  if (!container) return;

  // Retrieve comparison from state or client-side cache
  let comp = state.comparisons[filename];
  if (!comp && state.sessionId) {
    try {
      const cached = sessionStorage.getItem(`dagMile_cmp_${state.sessionId}_${filename}`);
      if (cached) {
        comp = JSON.parse(cached);
        state.comparisons[filename] = comp;
      }
    } catch (e) {}
  }

  const subtitle = $("#comparisonSubtitle");
  if (subtitle) {
    subtitle.textContent = comp
      ? `Audit for '${filename}': baseline schema vs. applied transformations vs. final output (${comp.timestamp}).`
      : `Review structural changes, handled missing values, encoded features, and deleted columns.`;
  }

  if (!comp) {
    $("#diffBeforeShape").textContent = "—";
    $("#diffAfterShape").textContent = "—";
    $("#diffBeforeMissing").textContent = "—";
    $("#diffAfterMissing").textContent = "—";
    $("#diffBeforeDuplicates").textContent = "—";
    $("#diffAfterDuplicates").textContent = "—";
    $("#diffMetricShapeSub").textContent = "Rows × Columns";
    $("#diffMetricMissingSub").textContent = "Total null count";
    $("#diffMetricDuplicatesSub").textContent = "Duplicates removed";
    $("#comparisonTableBody").innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 24px;" class="muted">No client-cached transformation diff found for '${escapeHtml(filename)}'. Run Step 4 Preprocessing to generate an audit comparison.</td></tr>`;
    return;
  }

  // Render Diff Metric Cards
  $("#diffBeforeShape").textContent = `${comp.before.rows.toLocaleString()} × ${comp.before.cols}`;
  $("#diffAfterShape").textContent = `${comp.after.rows.toLocaleString()} × ${comp.after.cols}`;
  if (comp.after.cols > comp.before.cols) {
    $("#diffMetricShapeSub").textContent = `+${comp.after.cols - comp.before.cols} features generated`;
  } else if (comp.after.cols < comp.before.cols) {
    $("#diffMetricShapeSub").textContent = `${comp.before.cols - comp.after.cols} features removed`;
  } else {
    $("#diffMetricShapeSub").textContent = `Dimensions preserved`;
  }

  $("#diffBeforeMissing").textContent = `${comp.before.missing.toLocaleString()}`;
  $("#diffAfterMissing").textContent = `${comp.after.missing.toLocaleString()}`;
  $("#diffMetricMissingSub").textContent = comp.before.missing > comp.after.missing
    ? `✓ ${comp.before.missing - comp.after.missing} nulls resolved`
    : `0 remaining nulls`;

  $("#diffBeforeDuplicates").textContent = `${comp.before.duplicates.toLocaleString()}`;
  $("#diffAfterDuplicates").textContent = `${comp.after.duplicates.toLocaleString()}`;
  $("#diffMetricDuplicatesSub").textContent = comp.before.duplicates > 0 && comp.after.duplicates === 0
    ? `✓ ${comp.before.duplicates} duplicates removed`
    : `0 duplicate rows`;

  // Render Feature Diff Table
  const afterColsSet = new Set(comp.after.columns || []);
  const tbody = $("#comparisonTableBody");
  tbody.innerHTML = "";

  (comp.before.columns || []).forEach(col => {
    const colName = col.column;
    const colType = col.feature_type || "feature";
    const cfg = comp.config.columns?.[colName] || {};

    // 1. Raw State Label
    const rawState = [];
    rawState.push(`<span class="mono">${escapeHtml(colType)}</span>`);
    if (col.missing_count > 0) {
      rawState.push(`<span style="color: var(--amber); font-weight: 600;">${col.missing_count} null (${col.missing_pct}%)</span>`);
    } else {
      rawState.push(`<span class="muted">0 null</span>`);
    }
    if (col.outlier_count > 0) {
      rawState.push(`<span style="color: var(--red);">${col.outlier_count} outliers</span>`);
    }

    // 2. Applied Actions Label
    const actions = [];
    if (cfg.missing_strategy && cfg.missing_strategy !== "none") {
      actions.push(`Impute: <strong>${cfg.missing_strategy}</strong>`);
    }
    if (cfg.outlier_action && cfg.outlier_action !== "none" && cfg.outlier_action !== "keep") {
      actions.push(`Outliers: <strong>${cfg.outlier_action}</strong>`);
    }
    if (cfg.encode && cfg.encode !== "none") {
      actions.push(`Encode: <strong>${cfg.encode}</strong>`);
    }
    if (cfg.scale && cfg.scale !== "none") {
      actions.push(`Scale: <strong>${cfg.scale}</strong>`);
    }
    const actionStr = actions.length > 0 ? actions.join(" • ") : `<span class="muted">Preserve raw</span>`;

    // 3. Result / Impact & Status Badge
    let statusBadge = "";
    let impactText = "";

    if (cfg.encode === "onehot") {
      const generatedCols = (comp.after.columns || []).filter(c => c.startsWith(`${colName}_`));
      statusBadge = `<span class="status-badge badge-encoded">🟣 Encoded</span>`;
      impactText = `One-Hot transformed into <strong>${generatedCols.length}</strong> indicator columns: <span class="mono" style="font-size: 11px;">${escapeHtml(generatedCols.slice(0, 3).join(", "))}${generatedCols.length > 3 ? ` (+${generatedCols.length - 3} more)` : ""}</span>`;
    } else if (!afterColsSet.has(colName)) {
      statusBadge = `<span class="status-badge badge-dropped">🔴 Dropped</span>`;
      impactText = `<span style="color: var(--red);">Feature eliminated from final dataset (column or rows dropped)</span>`;
    } else if (cfg.missing_strategy && cfg.missing_strategy !== "none") {
      statusBadge = `<span class="status-badge badge-imputed">🟢 Imputed</span>`;
      const afterColProfile = comp.after.profile?.columns?.[colName];
      const afterMissing = afterColProfile ? afterColProfile.missing_count : 0;
      impactText = `Nulls resolved (${col.missing_count} → ${afterMissing}). Preserved as <span class="mono">${escapeHtml(colName)}</span>.`;
      if (cfg.scale && cfg.scale !== "none") impactText += ` Scaled (${cfg.scale}).`;
    } else if (cfg.scale && cfg.scale !== "none") {
      statusBadge = `<span class="status-badge badge-scaled">🔵 Scaled</span>`;
      impactText = `Standardized with ${cfg.scale}. Preserved in dataset as <span class="mono">${escapeHtml(colName)}</span>.`;
    } else {
      statusBadge = `<span class="status-badge badge-preserved">⚪ Preserved</span>`;
      impactText = `Preserved original raw distribution in column <span class="mono">${escapeHtml(colName)}</span>.`;
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="mono-cell"><strong>${escapeHtml(colName)}</strong></td>
      <td>${rawState.join(" · ")}</td>
      <td>${actionStr}</td>
      <td style="font-size: 12.5px;">${impactText}</td>
      <td style="text-align: right;">${statusBadge}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function loadFinalPanel() {
  const title = $("#finalProjectTitle");
  const subtitle = $("#finalProjectSubtitle");
  if (title && state.currentProjectName) title.textContent = `${state.currentProjectName} · Final Dataset & Export`;
  if (subtitle) subtitle.textContent = "Review the latest dataset, then download its cleaned data and transformation audit log.";

  const logBox = $("#transformLog");
  try {
    const sessionData = await api(`/api/session/${state.sessionId}`);
    const files = sessionData.files || state.uploadedFiles;
    state.uploadedFiles = files;
    fillSelect($("#finalFileSelect"), files.map(f => f.filename));
    const selected = files.some(f => f.filename === state.currentPreprocessFile)
      ? state.currentPreprocessFile
      : files.at(-1)?.filename;
    state.currentPreprocessFile = selected || null;
    if (selected) $("#finalFileSelect").value = selected;

    logBox.innerHTML = "";
    for (const [fname, entries] of Object.entries(sessionData.log || {})) {
      const heading = document.createElement("div");
      heading.className = "file-heading";
      heading.textContent = `[${fname}]`;
      logBox.appendChild(heading);
      entries.forEach(e => {
        const line = document.createElement("div");
        line.textContent = "  " + e;
        if (e.startsWith("⚠")) line.classList.add("log-line-warn");
        logBox.appendChild(line);
      });
    }
    if (!logBox.children.length) logBox.textContent = "No transformations have been recorded for this session yet.";
    await loadFinalInlinePreview(selected);
    renderComparison(selected);
  } catch (err) {
    fillSelect($("#finalFileSelect"), state.uploadedFiles.map(f => f.filename));
    const selected = state.currentPreprocessFile || state.uploadedFiles.at(-1)?.filename;
    if (selected) $("#finalFileSelect").value = selected;
    logBox.textContent = "The saved project is available, but its live preprocessing session is no longer running. Start a new upload to restore the live preview and export session.";
    renderFinalPreviewMessage("Live preview is unavailable because this project's ML session has expired. Its saved file details remain available in the dashboard.");
    renderComparison(selected);
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function renderFinalPreviewMessage(message) {
  $("#finalPreviewHead").innerHTML = "";
  $("#finalPreviewBody").innerHTML = `<tr><td class="muted final-preview-message">${escapeHtml(message)}</td></tr>`;
  $("#finalPreviewSubtitle").textContent = "Latest available dataset preview";
}

async function loadFinalInlinePreview(filename) {
  if (!filename || !state.sessionId) {
    renderFinalPreviewMessage("No preprocessed dataset is available for this project yet.");
    return;
  }
  $("#finalPreviewSubtitle").textContent = `Loading the first rows of ${filename}…`;
  $("#finalPreviewHead").innerHTML = "";
  $("#finalPreviewBody").innerHTML = `<tr><td class="muted final-preview-message">Loading preview…</td></tr>`;
  try {
    const preview = await api(`/api/v1/preview/${encodeURIComponent(state.sessionId)}/${encodeURIComponent(filename)}`);
    $("#finalPreviewSubtitle").textContent = `${filename} · ${preview.previewRowCount} rows shown · ${preview.columns.length} columns`;
    $("#finalPreviewHead").innerHTML = `<tr>${preview.columns.map(column => `<th>${escapeHtml(column)}</th>`).join("")}</tr>`;
    $("#finalPreviewBody").innerHTML = preview.rows.length
      ? preview.rows.map(row => `<tr>${row.map(cell => `<td class="mono-cell">${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")
      : `<tr><td colspan="${Math.max(preview.columns.length, 1)}" class="muted final-preview-message">No data rows are available in this file.</td></tr>`;
  } catch (err) {
    renderFinalPreviewMessage(`Preview could not be loaded: ${err.message}`);
  }
}

$("#finalFileSelect").addEventListener("change", event => {
  state.currentPreprocessFile = event.target.value;
  loadFinalInlinePreview(state.currentPreprocessFile);
  renderComparison(state.currentPreprocessFile);
});

$("#downloadDataBtn").addEventListener("click", () => {
  const fname = $("#finalFileSelect").value;
  const token = localStorage.getItem("dagMileAccessToken");
  window.open(`${API_BASE}/api/download/${state.sessionId}/${encodeURIComponent(fname)}?token=${encodeURIComponent(token || "")}`, "_blank");
});

const downloadJsonBtn = $("#downloadJsonBtn");
if (downloadJsonBtn) {
  downloadJsonBtn.addEventListener("click", () => {
    const fname = $("#finalFileSelect").value;
    const token = localStorage.getItem("dagMileAccessToken");
    window.open(`${API_BASE}/api/v1/export/${state.sessionId}/${encodeURIComponent(fname)}?format=json&token=${encodeURIComponent(token || "")}`, "_blank");
  });
}

$("#downloadLogBtn").addEventListener("click", () => {
  const token = localStorage.getItem("dagMileAccessToken");
  window.open(`${API_BASE}/api/download-log/${state.sessionId}?token=${encodeURIComponent(token || "")}`, "_blank");
});
