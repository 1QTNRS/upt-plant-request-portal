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
  if (!(box instanceof HTMLInputElement) || !(dialog instanceof HTMLElement)) return;

  function acceptedAnything() {
    return Array.prototype.some.call(
      document.querySelectorAll('input[type="radio"][name^="choice-"]'),
      function (radio) {
        return radio instanceof HTMLInputElement && radio.checked && radio.value === "accept";
      },
    );
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

  box.addEventListener("change", function () {
    if (box.checked) {
      if (ack instanceof HTMLInputElement) ack.value = "";
      closeDialog();
      return;
    }
    if (!acceptedAnything()) {
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
