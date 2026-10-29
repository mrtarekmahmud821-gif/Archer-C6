(() => {
  const tg = window.Telegram?.WebApp;
  tg?.ready();
  tg?.expand();

  const status = document.getElementById("status");
  const requests = document.getElementById("requests");
  const refreshButton = document.getElementById("refresh");

  function authHeaders() {
    const initData = tg?.initData;
    if (!initData) {
      throw new Error("Open this page inside Telegram.");
    }

    return {
      "Content-Type": "application/json",
      "Authorization": `tma ${initData}`
    };
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        ...authHeaders(),
        ...(options.headers || {})
      }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Request failed (${response.status})`);
    }

    return data;
  }

  function safeText(value) {
    return String(value ?? "");
  }

  async function review(id, decision, noteInput) {
    const note = noteInput.value.trim();

    if (
      decision === "approve" &&
      !confirm("Have you manually sent the bKash payment?")
    ) {
      return;
    }

    if (
      decision === "reject" &&
      !confirm("Reject this request and return its points?")
    ) {
      return;
    }

    try {
      await api(`/api/admin/withdrawals/${encodeURIComponent(id)}/review`, {
        method: "POST",
        body: JSON.stringify({ decision, note })
      });

      status.textContent = "Request reviewed successfully.";
      await loadRequests();
    } catch (error) {
      status.textContent = error.message;
    }
  }

  async function loadRequests() {
    requests.replaceChildren();
    status.textContent = "Loading requests…";

    try {
      const list = await api("/api/admin/withdrawals");

      if (!list.length) {
        status.textContent = "No pending withdrawals.";
        return;
      }

      status.textContent = `${list.length} pending request(s).`;

      list.forEach(item => {
        const card = document.createElement("article");
        card.className = "card";

        const title = document.createElement("h3");
        title.textContent = `${item.points} points`;

        const info = document.createElement("p");
        info.className = "muted";
        info.textContent =
          `Telegram ID: ${safeText(item.telegramId)} · ` +
          `bKash: ${safeText(item.bkashNumber)}`;

        const note = document.createElement("input");
        note.placeholder = "Admin note (optional)";
        note.maxLength = 300;
        note.setAttribute("aria-label", "Admin note");

        const approve = document.createElement("button");
        approve.className = "approve";
        approve.textContent = "Approve paid request";
        approve.addEventListener("click", () =>
          review(item.id, "approve", note)
        );

        const reject = document.createElement("button");
        reject.className = "reject";
        reject.textContent = "Reject & refund";
        reject.addEventListener("click", () =>
          review(item.id, "reject", note)
        );

        card.append(title, info, note, approve, reject);
        requests.appendChild(card);
      });
    } catch (error) {
      status.textContent = error.message;
    }
  }

  refreshButton.addEventListener("click", loadRequests);
  loadRequests();
})();
