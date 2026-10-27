// Contact form: saves to Firestore and sends email via EmailJS (moved out of contact.html for a strict CSP).
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getFirestore, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

try { emailjs.init({ publicKey: "Q-IEP7ifmgja43yFs" }); } catch (e) { console.warn("EmailJS unavailable", e); }

const firebaseConfig = {
  apiKey: "AIzaSyDSH6Ryd0MtbQOTiK1GYBSQa8oe65TGXpA",
  authDomain: "portfolio-contact-39c14.firebaseapp.com",
  projectId: "portfolio-contact-39c14",
  storageBucket: "portfolio-contact-39c14.firebasestorage.app",
  messagingSenderId: "1011375934660",
  appId: "1:1011375934660:web:ac5b4ab463dc122de48d91",
  measurementId: "G-7JFCLZBL0C"
};

const EMAILJS_SERVICE = "service_7247d77";
const TEMPLATE_TO_ME = "template_7izn0kc";      // notification to Kavi
const TEMPLATE_AUTOREPLY = "template_v7qgder";  // auto-reply to visitor

const db = getFirestore(initializeApp(firebaseConfig));

const form = document.getElementById("contactForm");
const btn = document.getElementById("submit-btn");
const btnText = document.getElementById("btn-text");
const status = document.getElementById("form-status");
const msgEl = document.getElementById("message");
const charCount = document.getElementById("charCount");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Firestore retries offline writes forever; cap the wait so the button never hangs
const withTimeout = (promise, ms) => Promise.race([
  promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))
]);

const val = (id) => document.getElementById(id).value.trim();
const setStatus = (text, kind) => { status.textContent = text; status.className = kind || ""; };
const setBusy = (busy, label) => { btn.disabled = busy; btnText.textContent = label; };

// Prefill from the footer "Have a project in mind?" box (contact.html?email=…)
const pre = new URLSearchParams(location.search).get("email");
if (pre && EMAIL_RE.test(pre)) {
  document.getElementById("email-input").value = pre;
  document.getElementById("first-name").focus();
}

msgEl.addEventListener("input", () => { charCount.textContent = `${msgEl.value.length} / 3000`; });

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (btn.disabled) return;

  const data = {
    firstName: val("first-name"),
    lastName: val("last-name"),
    email: val("email-input"),
    subject: val("subject"),
    message: val("message"),
  };

  // Validation (custom so messages are friendly and consistent)
  if (!data.firstName || !data.email || !data.subject || !data.message) {
    setStatus("Please fill in all required fields.", "err");
    return;
  }
  if (!EMAIL_RE.test(data.email)) {
    setStatus("Please enter a valid email address.", "err");
    document.getElementById("email-input").focus();
    return;
  }
  if (data.message.length < 10) {
    setStatus("Add a few more details — at least 10 characters.", "err");
    msgEl.focus();
    return;
  }

  // Honeypot filled → silently pretend success (bot)
  if (val("company-website")) {
    setStatus("Message sent. Taking you to the confirmation page…", "ok");
    return;
  }

  setBusy(true, "Sending...");
  setStatus("", "");

  // 1) Save to Firestore (field names unchanged so the admin dashboard and security rules keep working)
  let saved = false;
  try {
    await withTimeout(addDoc(collection(db, "contacts"), {
      ...data, isRead: false, isStarred: false, createdAt: serverTimestamp()
    }), 12000);
    saved = true;
  } catch (err) {
    console.error("Firestore save failed:", err);
  }

  // 2) Email notification + auto-reply (do not block success if email fails but the message was saved)
  let notified = false;
  if (window.emailjs) {
    const results = await Promise.allSettled([
      emailjs.send(EMAILJS_SERVICE, TEMPLATE_TO_ME, {
        first_name: data.firstName, last_name: data.lastName, email: data.email,
        subject: data.subject, message: data.message
      }),
      emailjs.send(EMAILJS_SERVICE, TEMPLATE_AUTOREPLY, {
        to_email: data.email, first_name: data.firstName
      })
    ]);
    notified = results[0].status === "fulfilled";
    results.forEach((r) => { if (r.status === "rejected") console.error("EmailJS error:", r.reason); });
  }

  if (saved || notified) {
    setStatus("Message sent. Taking you to the confirmation page…", "ok");
    btnText.textContent = "Sent";
    form.reset();
    setTimeout(() => { window.location.href = "thank-you.html"; }, 1200);
  } else {
    setStatus("Couldn't send right now. Please email kaviyarasukanthavel@gmail.com or message me on WhatsApp.", "err");
    setBusy(false, "Send message");
  }
});
