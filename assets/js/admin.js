// Admin dashboard (moved out of admin.html for a strict CSP).
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut }
    from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import {
    getFirestore, collection, onSnapshot, query, orderBy, where, doc, deleteDoc,
    limit, getDocs, updateDoc, writeBatch, getCountFromServer, Timestamp
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyDSH6Ryd0MtbQOTiK1GYBSQa8oe65TGXpA",
    authDomain: "portfolio-contact-39c14.firebaseapp.com",
    projectId: "portfolio-contact-39c14",
    storageBucket: "portfolio-contact-39c14.firebasestorage.app",
    messagingSenderId: "1011375934660",
    appId: "1:1011375934660:web:ac5b4ab463dc122de48d91"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const contactsCol = collection(db, "contacts");

// UI gate only — real protection must come from Firestore security rules.
const ALLOWED_EMAIL = "kaviyarasu.0aasai@gmail.com";
const PAGE_SIZE = 10;

let pages = 1;               // live window = PAGE_SIZE * pages (keeps "Load More" results live too)
let allMessages = [];
let hasMore = false;
let unsubscribe = null;
let deleteTargetId = null;
let activeFilter = "all";

const $ = (id) => document.getElementById(id);
const loginBox = $("loginBox"), dashboard = $("dashboard"), loginError = $("loginError");
const msgContainer = $("messages"), searchInput = $("searchInput"), deleteModal = $("deleteModal");
const loadMoreBtn = $("loadMoreBtn");

function toast(text, isErr = false) {
    const t = $("toast");
    t.textContent = text;
    t.className = "toast show" + (isErr ? " err" : "");
    clearTimeout(t._h);
    t._h = setTimeout(() => t.className = "toast", 2600);
}

// ── LOGIN ──
async function doLogin() {
    const email = $("adminEmail").value.trim();
    const pass = $("adminPassword").value;
    loginError.style.display = "none";
    if (!email || !pass) {
        loginError.textContent = "Enter your email and password.";
        loginError.style.display = "block";
        return;
    }
    if (email.toLowerCase() !== ALLOWED_EMAIL) {
        loginError.textContent = "⛔ Access denied. Only the admin can log in.";
        loginError.style.display = "block";
        return;
    }
    const btn = $("loginBtn");
    btn.disabled = true;
    try {
        await signInWithEmailAndPassword(auth, email, pass);
    } catch (e) {
        loginError.textContent = e.code === "auth/too-many-requests"
            ? "Too many attempts. Please wait a few minutes and try again."
            : "❌ Invalid credentials. Try again.";
        loginError.style.display = "block";
    } finally {
        btn.disabled = false;
    }
}
$("loginBtn").addEventListener("click", doLogin);
["adminEmail", "adminPassword"].forEach(id =>
    $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); }));

$("logoutBtn").addEventListener("click", () => signOut(auth));

// ── AUTH STATE ──
onAuthStateChanged(auth, (user) => {
    const ok = user && (user.email || "").toLowerCase() === ALLOWED_EMAIL;
    if (!ok) {
        loginBox.style.display = "flex";
        dashboard.style.display = "none";
        if (unsubscribe) { unsubscribe(); unsubscribe = null; }
        if (user) {
            signOut(auth);
            loginError.textContent = "⛔ Access denied. Unauthorized account.";
            loginError.style.display = "block";
        }
        return;
    }
    loginBox.style.display = "none";
    dashboard.style.display = "block";
    pages = 1;
    startLiveListener();
});

// ── REAL-TIME LISTENER (window grows with Load More) ──
function startLiveListener() {
    if (unsubscribe) unsubscribe();
    const windowSize = PAGE_SIZE * pages;
    const q = query(contactsCol, orderBy("createdAt", "desc"), limit(windowSize));
    unsubscribe = onSnapshot(q, (snap) => {
        allMessages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        hasMore = snap.size === windowSize;
        loadMoreBtn.disabled = !hasMore;
        loadMoreBtn.innerHTML = hasMore
            ? '<i class="fa fa-plus" aria-hidden="true"></i> Load More'
            : '<i class="fa fa-check" aria-hidden="true"></i> All messages loaded';
        renderMessages();
        refreshCounts();
    }, (err) => {
        console.error(err);
        toast("Couldn't load messages: " + (err.code || err.message), true);
    });
}

loadMoreBtn.addEventListener("click", () => {
    if (!hasMore) return;
    pages++;
    startLiveListener();
});

// ── STATS: true totals from the server, not just the loaded page ──
async function refreshCounts() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart); weekStart.setDate(weekStart.getDate() - 6);
    const count = async (q) => (await getCountFromServer(q)).data().count;
    try {
        const [total, unread, today, week] = await Promise.all([
            count(contactsCol),
            count(query(contactsCol, where("isRead", "==", false))),
            count(query(contactsCol, where("createdAt", ">=", Timestamp.fromDate(todayStart)))),
            count(query(contactsCol, where("createdAt", ">=", Timestamp.fromDate(weekStart))))
        ]);
        $("statTotal").textContent = total;
        $("statUnread").textContent = unread;
        $("statToday").textContent = today;
        $("statWeek").textContent = week;
        $("loadedInfo").textContent = `Showing ${allMessages.length} of ${total} messages`;
    } catch (e) {
        // Fallback: count what is loaded
        console.warn("Count query failed, using loaded messages:", e);
        $("statTotal").textContent = allMessages.length + (hasMore ? "+" : "");
        $("statUnread").textContent = allMessages.filter(m => !m.isRead).length;
        const isAfter = (m, d) => m.createdAt?.toDate && m.createdAt.toDate() >= d;
        $("statToday").textContent = allMessages.filter(m => isAfter(m, todayStart)).length;
        $("statWeek").textContent = allMessages.filter(m => isAfter(m, weekStart)).length;
        $("loadedInfo").textContent = `Showing ${allMessages.length} messages`;
    }
}

// ── FILTER + SEARCH ──
function visibleMessages() {
    const term = searchInput.value.toLowerCase().trim();
    return allMessages
        .filter(m => activeFilter === "all" || (activeFilter === "unread" ? !m.isRead : !!m.isStarred))
        .filter(m => !term ||
            `${m.firstName || ""} ${m.lastName || ""}`.toLowerCase().includes(term) ||
            (m.email || "").toLowerCase().includes(term) ||
            (m.subject || "").toLowerCase().includes(term) ||
            (m.message || "").toLowerCase().includes(term))
        .sort((a, b) => (b.isStarred ? 1 : 0) - (a.isStarred ? 1 : 0)); // starred first, then newest
}

document.querySelectorAll(".chip-btn").forEach(btn => btn.addEventListener("click", () => {
    activeFilter = btn.dataset.filter;
    document.querySelectorAll(".chip-btn").forEach(b => b.classList.toggle("active", b === btn));
    renderMessages();
}));
searchInput.addEventListener("input", renderMessages);

// ── RENDER ──
const esc = (str) => String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function renderMessages() {
    $("nAll").textContent = `(${allMessages.length})`;
    $("nUnread").textContent = `(${allMessages.filter(m => !m.isRead).length})`;
    $("nStarred").textContent = `(${allMessages.filter(m => m.isStarred).length})`;

    const list = visibleMessages();
    if (!list.length) {
        const term = searchInput.value.trim();
        msgContainer.innerHTML = `<div class="empty-state"><i class="fa fa-inbox"></i>
            <p>${term || activeFilter !== "all" ? "No messages match this view." : "No messages yet."}</p></div>`;
        return;
    }

    msgContainer.innerHTML = list.map((m, i) => {
        const time = m.createdAt?.toDate
            ? m.createdAt.toDate().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
        const name = `${m.firstName || ""} ${m.lastName || ""}`.trim();
        const mailto = `mailto:${encodeURIComponent(m.email || "")}?subject=${encodeURIComponent("Re: " + (m.subject || "Your message"))}`;
        return `
        <div class="msg-card" style="animation-delay:${Math.min(i, 10) * 40}ms;${!m.isRead ? "border-left:4px solid var(--indigo);" : ""}">
            <div class="msg-header">
                <div>
                    <div class="msg-sender">
                        ${m.isStarred ? '<i class="fa fa-star" style="color:#facc15;margin-right:6px" aria-hidden="true"></i>' : ""}
                        ${esc(name || "(no name)")}
                        ${!m.isRead ? '<span style="margin-left:8px;font-size:.7rem;color:var(--indigo);font-weight:700">NEW</span>' : ""}
                    </div>
                    <div class="msg-email">${esc(m.email)}</div>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                    <a class="btn btn-ghost btn-sm" href="${mailto}" title="Reply by email" aria-label="Reply"><i class="fa fa-reply"></i></a>
                    <button type="button" class="btn btn-ghost btn-sm" data-act="read" data-id="${esc(m.id)}" data-v="${m.isRead ? 1 : 0}"
                        title="${m.isRead ? "Mark as unread" : "Mark as read"}" aria-label="${m.isRead ? "Mark as unread" : "Mark as read"}">
                        <i class="fa ${m.isRead ? "fa-envelope-open" : "fa-envelope"}"></i></button>
                    <button type="button" class="btn btn-ghost btn-sm" data-act="star" data-id="${esc(m.id)}" data-v="${m.isStarred ? 1 : 0}"
                        title="${m.isStarred ? "Unstar" : "Star"}" aria-label="${m.isStarred ? "Unstar" : "Star"}">
                        <i class="${m.isStarred ? "fa fa-star" : "fa-regular fa-star"}"></i></button>
                    <button type="button" class="btn btn-danger btn-sm" data-act="delete" data-id="${esc(m.id)}" title="Delete" aria-label="Delete">
                        <i class="fa fa-trash"></i></button>
                </div>
            </div>
            <div class="msg-subject"><i class="fa fa-tag" style="opacity:.5;margin-right:6px"></i>${esc(m.subject || "No subject")}</div>
            <div class="msg-body">${esc(m.message)}</div>
            <div class="msg-time"><i class="fa fa-clock"></i> ${time}</div>
        </div>`;
    }).join("");
}

// One delegated handler for all card buttons
msgContainer.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const { act, id } = btn.dataset;
    if (act === "delete") { deleteTargetId = id; deleteModal.classList.add("show"); $("cancelDelete").focus(); return; }
    btn.disabled = true;
    try {
        if (act === "read") await updateDoc(doc(db, "contacts", id), { isRead: btn.dataset.v !== "1" });
        if (act === "star") await updateDoc(doc(db, "contacts", id), { isStarred: btn.dataset.v !== "1" });
    } catch (err) {
        console.error(err);
        toast("Update failed: " + (err.code || err.message), true);
        btn.disabled = false;
    }
});

// ── DELETE ──
const closeModal = () => { deleteModal.classList.remove("show"); deleteTargetId = null; };
$("cancelDelete").addEventListener("click", closeModal);
deleteModal.addEventListener("click", (e) => { if (e.target === deleteModal) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && deleteModal.classList.contains("show")) closeModal(); });
$("confirmDelete").addEventListener("click", async () => {
    if (!deleteTargetId) return;
    try {
        await deleteDoc(doc(db, "contacts", deleteTargetId));
        toast("Message deleted");
    } catch (e) {
        console.error("Delete failed:", e);
        toast("Delete failed: " + (e.code || e.message), true);
    }
    closeModal();
});

// ── MARK SHOWN AS READ (single batched write) ──
$("markAllReadBtn").addEventListener("click", async () => {
    const targets = visibleMessages().filter(m => !m.isRead);
    if (!targets.length) { toast("Nothing unread in this view"); return; }
    try {
        const batch = writeBatch(db);
        targets.forEach(m => batch.update(doc(db, "contacts", m.id), { isRead: true }));
        await batch.commit();
        toast(`Marked ${targets.length} as read`);
    } catch (e) {
        console.error(e);
        toast("Couldn't mark as read: " + (e.code || e.message), true);
    }
});

// ── EXPORT ALL MESSAGES TO EXCEL ──
$("exportBtn").addEventListener("click", async () => {
    if (!window.XLSX) { toast("Excel library failed to load", true); return; }
    const btn = $("exportBtn");
    btn.disabled = true;
    try {
        const snap = await getDocs(query(contactsCol, orderBy("createdAt", "desc")));
        const rows = snap.docs.map(d => {
            const m = d.data();
            return {
                Date: m.createdAt?.toDate ? m.createdAt.toDate().toLocaleString("en-IN") : "",
                Name: `${m.firstName || ""} ${m.lastName || ""}`.trim(),
                Email: m.email || "",
                Subject: m.subject || "",
                Message: m.message || "",
                Read: m.isRead ? "Yes" : "No",
                Starred: m.isStarred ? "Yes" : "No"
            };
        });
        const ws = XLSX.utils.json_to_sheet(rows);
        ws["!cols"] = [{ wch: 20 }, { wch: 22 }, { wch: 30 }, { wch: 30 }, { wch: 70 }, { wch: 6 }, { wch: 8 }];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Messages");
        XLSX.writeFile(wb, `portfolio_messages_${new Date().toISOString().slice(0, 10)}.xlsx`);
        toast(`Exported ${rows.length} messages`);
    } catch (e) {
        console.error(e);
        toast("Export failed: " + (e.code || e.message), true);
    } finally {
        btn.disabled = false;
    }
});

// ── THEME TOGGLE (icon shows the theme you will switch to) ──
const themeIcon = $("themeIcon");
const syncThemeIcon = () => {
    themeIcon.className = document.documentElement.getAttribute("data-theme") === "dark" ? "fa fa-sun" : "fa fa-moon";
};
syncThemeIcon();
$("themeToggle").addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("kk-theme", next); } catch (e) { }
    syncThemeIcon();
});
