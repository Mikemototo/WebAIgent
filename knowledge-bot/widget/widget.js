(function(){
  const API = window.__BOT_API__ || "http://localhost:8787/chat";
  const TENANT = window.__BOT_TENANT__ || "TENANT_123";
  const OPTIONS = window.__BOT_OPTIONS__ || {};

  const toNumber = (value, fallback) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  };

  const width = Math.max(toNumber(OPTIONS.width, 320), 220);
  const maxHeight = Math.max(toNumber(OPTIONS.maxHeight, 240), 160);
  const offsetX = Math.max(toNumber(OPTIONS.offsetX ?? OPTIONS.offset, 20), 0);
  const offsetY = Math.max(toNumber(OPTIONS.offsetY ?? OPTIONS.offset, 20), 0);
  const zIndex = toNumber(OPTIONS.zIndex, 9999);
  const borderRadius = Math.max(toNumber(OPTIONS.borderRadius, 12), 0);
  const inputRadius = Math.max(toNumber(OPTIONS.inputRadius, 8), 0);
  const maxHistory = Math.min(Math.max(toNumber(OPTIONS.maxHistory, 20), 1), 100);

  const accent = OPTIONS.accentColor || "#4f46e5";
  const background = OPTIONS.backgroundColor || "#fff";
  const border = OPTIONS.borderColor || "#ddd";
  const textColor = OPTIONS.textColor || "#111";
  const mutedColor = OPTIONS.mutedColor || "#666";
  const logBackground = OPTIONS.logBackgroundColor || background;
  const errorColor = OPTIONS.errorColor || "#b00020";
  const successColor = OPTIONS.successColor || accent;

  const position = typeof OPTIONS.position === "string" ? OPTIONS.position.toLowerCase() : "bottom-right";
  const [vertical, horizontal] = position.split("-");
  const title = typeof OPTIONS.title === "string" ? OPTIONS.title : "Ask us";
  const placeholder = typeof OPTIONS.placeholder === "string" ? OPTIONS.placeholder : "Type a question...";
  const history = [];

  const box = document.createElement("div");
  box.style.position = "fixed";
  box.style.width = `${width}px`;
  box.style.padding = "12px";
  box.style.borderRadius = `${borderRadius}px`;
  box.style.border = `1px solid ${border}`;
  box.style.background = background;
  box.style.fontFamily = OPTIONS.fontFamily || "Inter, system-ui, sans-serif";
  box.style.boxShadow = OPTIONS.boxShadow || "0 8px 24px rgba(0,0,0,.12)";
  box.style.zIndex = String(zIndex);
  box.style.color = textColor;

  box.style.top = "auto";
  box.style.bottom = "auto";
  if (vertical === "top") {
    box.style.top = `${offsetY}px`;
  } else {
    box.style.bottom = `${offsetY}px`;
  }
  box.style.left = "auto";
  box.style.right = "auto";
  if (horizontal === "left") {
    box.style.left = `${offsetX}px`;
  } else {
    box.style.right = `${offsetX}px`;
  }

  const header = document.createElement("div");
  header.textContent = title;
  header.style.fontWeight = "700";
  header.style.marginBottom = "8px";
  header.style.fontSize = "15px";
  box.appendChild(header);

  const log = document.createElement("div");
  log.style.maxHeight = `${maxHeight}px`;
  log.style.overflow = "auto";
  log.style.border = `1px solid ${border}`;
  log.style.padding = "8px";
  log.style.marginBottom = "8px";
  log.style.fontSize = "14px";
  log.style.lineHeight = "1.4";
  log.style.background = logBackground;
  log.style.color = textColor;
  box.appendChild(log);

  const status = document.createElement("div");
  status.style.minHeight = "18px";
  status.style.fontSize = "12px";
  status.style.color = mutedColor;
  status.style.marginBottom = "6px";
  box.appendChild(status);

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = placeholder;
  input.setAttribute("aria-label", OPTIONS.inputLabel || "Ask a question");
  input.style.width = "100%";
  input.style.padding = "8px";
  input.style.border = `1px solid ${border}`;
  input.style.borderRadius = `${inputRadius}px`;
  input.style.fontSize = "14px";
  input.style.color = textColor;
  input.style.background = OPTIONS.inputBackgroundColor || "#fff";
  box.appendChild(input);

  document.body.appendChild(box);

  function render() {
    log.innerHTML = history
      .slice(-maxHistory)
      .map((item) =>
        item.type === "user"
          ? `<div><strong>You:</strong> ${item.text}</div>`
          : `<div><strong>Bot:</strong> ${item.text}${item.citations}</div>`
      )
      .join("");
    log.scrollTop = log.scrollHeight;
  }

  function setStatus(message, variant = "info") {
    const colors = { info: mutedColor, error: errorColor, success: successColor };
    status.textContent = message || "";
    status.style.color = colors[variant] || colors.info;
  }

  async function ask(question) {
    try {
      setStatus("Thinking...");
      const res = await fetch(API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tenant-Id": TENANT
        },
        body: JSON.stringify({ question, top_k: 5 })
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setStatus("");
      return data;
    } catch (error) {
      console.error("Widget request failed", error);
      setStatus("Something went wrong. Please try again.", "error");
      throw error;
    }
  }

  async function handleSubmit(value) {
    const question = value.trim();
    if (!question) return;
    input.value = "";
    history.push({ type: "user", text: question });
    render();

    try {
      const { answer, citations } = await ask(question);
      const citeMarkup = (citations || [])
        .filter((c) => c && (c.title || c.url))
        .map(
          (c) =>
            `<a href="${c.url || "#"}" target="_blank" rel="noopener" style="color:${accent}">${c.title || c.url}</a>`
        )
        .join(", ");
      history.push({
        type: "bot",
        text: answer || "I’m not sure how to answer that yet.",
        citations: citeMarkup
          ? `<div style="font-size:12px;opacity:.7;margin-top:4px">Sources: ${citeMarkup}</div>`
          : ""
      });
      setStatus("");
    } catch (_) {
      history.push({
        type: "bot",
        text: "I couldn’t reach the knowledge service.",
        citations: ""
      });
    }
    render();
  }

  input.addEventListener("keydown", async (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      await handleSubmit(input.value);
    }
  });

  render();
})();
