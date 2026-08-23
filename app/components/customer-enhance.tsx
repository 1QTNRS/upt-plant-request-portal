import { CustomerLightboxRoot } from "./customer-photo-gallery";

/**
 * Isolated progressive-enhancement scripts for app-proxy pages.
 *
 * The storefront never hydrates. These run as a plain inline script: they must
 * not become React state, and the pages still work when the script is blocked.
 */

export const CUSTOMER_TIME_SCRIPT = `
(function () {
  var tz;
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch (error) {
    return;
  }
  if (!tz) return;

  document.querySelectorAll('input[name="customerTimeZone"]').forEach(function (field) {
    if (field instanceof HTMLInputElement) field.value = tz;
  });

  document.querySelectorAll("time[data-customer-time][datetime]").forEach(function (node) {
    var iso = node.getAttribute("datetime");
    if (!iso) return;
    var date = new Date(iso);
    if (isNaN(date.getTime())) return;
    node.textContent = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
      timeZoneName: "short",
    }).format(date);
  });

  var capture = document.querySelector("form[data-tz-capture]");
  if (!(capture instanceof HTMLFormElement)) return;
  var known = capture.getAttribute("data-known-tz") || "";
  if (known === tz) return;
  var body = new FormData(capture);
  body.set("intent", "save-timezone");
  body.set("customerTimeZone", tz);
  if (typeof fetch === "function") {
    fetch(capture.action, { method: "POST", body: body, credentials: "same-origin" });
  }
})();
`.trim();

export const FEDEX_WARNING_SCRIPT = `
(function () {
  var box = document.getElementById("fedex-upgrade");
  var dialog = document.getElementById("fedex-removal-dialog");
  var keep = document.getElementById("fedex-keep");
  var remove = document.getElementById("fedex-confirm-remove");
  var ack = document.getElementById("fedex-ack");
  var label = document.getElementById("fedex-upgrade-label");
  if (!(box instanceof HTMLInputElement) || !(dialog instanceof HTMLElement)) return;

  function acceptedCount() {
    var names = {};
    var count = 0;
    Array.prototype.forEach.call(
      document.querySelectorAll('input[type="radio"][name^="choice-"]'),
      function (radio) {
        if (!(radio instanceof HTMLInputElement)) return;
        if (radio.checked && radio.value === "accept") names[radio.name] = true;
      },
    );
    Object.keys(names).forEach(function () { count += 1; });
    return count;
  }

  function setChrome(enabled) {
    box.disabled = !enabled;
    if (label) {
      label.style.opacity = enabled ? "1" : "0.55";
      label.style.cursor = enabled ? "pointer" : "not-allowed";
    }
    box.setAttribute("aria-disabled", enabled ? "false" : "true");
  }

  function pinDialog() {
    if (dialog.parentNode !== document.body) {
      document.body.appendChild(dialog);
    }
  }

  function openDialog() {
    pinDialog();
    dialog.hidden = false;
    dialog.setAttribute("aria-hidden", "false");
    if (keep instanceof HTMLButtonElement) keep.focus();
  }

  function closeDialog() {
    dialog.hidden = true;
    dialog.setAttribute("aria-hidden", "true");
  }

  var previousAccepted = acceptedCount();

  function applyAcceptedChange() {
    var count = acceptedCount();
    var enabled = count > 0;
    setChrome(enabled);
    if (!enabled) {
      box.checked = false;
      if (ack instanceof HTMLInputElement) ack.value = "";
      closeDialog();
    } else if (previousAccepted === 0) {
      box.checked = true;
      if (ack instanceof HTMLInputElement) ack.value = "";
      closeDialog();
    }
    previousAccepted = count;
  }

  box.addEventListener("change", function () {
    if (box.checked) {
      if (ack instanceof HTMLInputElement) ack.value = "";
      closeDialog();
      return;
    }
    if (acceptedCount() === 0) {
      if (ack instanceof HTMLInputElement) ack.value = "";
      closeDialog();
      return;
    }
    box.checked = true;
    openDialog();
  });

  if (keep) {
    keep.addEventListener("click", function () {
      box.checked = true;
      if (ack instanceof HTMLInputElement) ack.value = "";
      closeDialog();
    });
  }

  if (remove) {
    remove.addEventListener("click", function () {
      box.checked = false;
      if (ack instanceof HTMLInputElement) ack.value = "true";
      closeDialog();
    });
  }

  dialog.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      box.checked = true;
      if (ack instanceof HTMLInputElement) ack.value = "";
      closeDialog();
    }
  });

  document.addEventListener("change", function (event) {
    var target = event.target;
    if (
      target instanceof HTMLInputElement &&
      target.type === "radio" &&
      target.name.indexOf("choice-") === 0
    ) {
      applyAcceptedChange();
    }
  });

  applyAcceptedChange();

  var form = box.form;
  if (form) {
    form.addEventListener("submit", function (event) {
      if (box.disabled) return;
      if (box.checked) return;
      if (ack instanceof HTMLInputElement && ack.value === "true") return;
      if (acceptedCount() === 0) return;
      event.preventDefault();
      openDialog();
    });
  }
})();
`.trim();

export const CUSTOMER_LIGHTBOX_SCRIPT = `
(function () {
  if (window.__uptCustomerLightbox) return;
  window.__uptCustomerLightbox = true;

  var root;
  var image;
  var status;
  var prev;
  var next;
  var stage;

  function pinToBody() {
    var nodes = document.querySelectorAll("[data-customer-lightbox]");
    if (!nodes.length) return null;
    var keep = nodes[0];
    for (var i = 1; i < nodes.length; i++) {
      if (nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
    }
    if (keep.parentNode !== document.body) {
      document.body.appendChild(keep);
    }
    return keep;
  }

  function bind() {
    root = pinToBody();
    if (!(root instanceof HTMLElement)) return false;
    image = root.querySelector("[data-lightbox-image]");
    status = root.querySelector("[data-lightbox-status]");
    prev = root.querySelector("[data-lightbox-prev]");
    next = root.querySelector("[data-lightbox-next]");
    stage = root.querySelector("[data-lightbox-stage]");
    return image instanceof HTMLImageElement;
  }

  if (!bind()) return;

  var urls = [];
  var alts = [];
  var index = 0;
  var startX = 0;
  var startY = 0;
  var tracking = false;

  function render() {
    if (!urls.length || !(image instanceof HTMLImageElement)) return;
    image.src = urls[index];
    image.alt = alts[index] || "";
    if (status) {
      status.textContent = urls.length > 1
        ? (index + 1) + " of " + urls.length
        : "";
    }
    var many = urls.length > 1;
    if (prev instanceof HTMLElement) prev.hidden = !many;
    if (next instanceof HTMLElement) next.hidden = !many;
  }

  function openFrom(link) {
    bind();
    var gallery = link.getAttribute("data-gallery") || "";
    var nodes = document.querySelectorAll("a[data-customer-photo]");
    urls = [];
    alts = [];
    Array.prototype.forEach.call(nodes, function (node) {
      if (!(node instanceof HTMLAnchorElement)) return;
      if ((node.getAttribute("data-gallery") || "") !== gallery) return;
      urls.push(node.href);
      alts.push(node.getAttribute("data-alt") || "");
    });
    if (!urls.length) {
      urls = [link.href];
      alts = [link.getAttribute("data-alt") || ""];
    }
    index = parseInt(link.getAttribute("data-index") || "0", 10);
    if (Number.isNaN(index) || index < 0 || index >= urls.length) index = 0;
    root.hidden = false;
    root.tabIndex = -1;
    root.focus();
    render();
  }

  function close() {
    if (!root) return;
    root.hidden = true;
    if (image instanceof HTMLImageElement) image.removeAttribute("src");
  }

  function move(delta) {
    if (urls.length <= 1) return;
    index = (index + delta + urls.length) % urls.length;
    render();
  }

  document.addEventListener("click", function (event) {
    var target = event.target;
    if (!(target instanceof Element)) return;
    var link = target.closest("a[data-customer-photo]");
    if (link instanceof HTMLAnchorElement) {
      event.preventDefault();
      openFrom(link);
      return;
    }
    if (target.closest("[data-lightbox-close]")) {
      event.preventDefault();
      close();
      return;
    }
    if (target.closest("[data-lightbox-prev]")) {
      event.preventDefault();
      move(-1);
      return;
    }
    if (target.closest("[data-lightbox-next]")) {
      event.preventDefault();
      move(1);
      return;
    }
    if (target.closest("[data-lightbox-image]")) return;
    if (target.closest("[data-customer-lightbox]")) {
      event.preventDefault();
      close();
    }
  });

  document.addEventListener("keydown", function (event) {
    if (root.hidden) return;
    if (event.key === "Escape") close();
    if (event.key === "ArrowLeft") move(-1);
    if (event.key === "ArrowRight") move(1);
  });

  function onPointerDown(event) {
    if (!event.isPrimary) return;
    tracking = true;
    startX = event.clientX;
    startY = event.clientY;
    if (stage instanceof HTMLElement && event.pointerId != null) {
      try { stage.setPointerCapture(event.pointerId); } catch (err) {}
    }
  }
  function onPointerUp(event) {
    if (!tracking) return;
    tracking = false;
    var dx = event.clientX - startX;
    var dy = event.clientY - startY;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
    move(dx > 0 ? -1 : 1);
  }
  if (stage instanceof HTMLElement) {
    stage.addEventListener("pointerdown", onPointerDown);
    stage.addEventListener("pointerup", onPointerUp);
    stage.addEventListener("pointercancel", function () { tracking = false; });
  }
})();
`.trim();

export function CustomerEnhanceScripts({
  includeFedexWarning = false,
}: {
  includeFedexWarning?: boolean;
}) {
  const source = [
    CUSTOMER_TIME_SCRIPT,
    CUSTOMER_LIGHTBOX_SCRIPT,
    includeFedexWarning ? FEDEX_WARNING_SCRIPT : "",
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <>
      <CustomerLightboxRoot />
      <script dangerouslySetInnerHTML={{ __html: source }} />
    </>
  );
}

export function CustomerTime({
  iso,
  children,
}: {
  iso: string;
  children: string;
}) {
  return (
    <time dateTime={iso} data-customer-time>
      {children}
    </time>
  );
}
