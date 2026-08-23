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

  function openDialog() {
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
})();
`.trim();

export function CustomerEnhanceScripts({
  includeFedexWarning = false,
}: {
  includeFedexWarning?: boolean;
}) {
  const source = includeFedexWarning
    ? `${CUSTOMER_TIME_SCRIPT}\n${FEDEX_WARNING_SCRIPT}`
    : CUSTOMER_TIME_SCRIPT;
  return <script dangerouslySetInnerHTML={{ __html: source }} />;
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
