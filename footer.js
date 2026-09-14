/* Shared site footer for College Path secondary pages. */
(function () {
  var LINKS = [
    { href: "index.html", label: "Explorer" },
    { href: "premed-playbook.html", label: "Premed playbook" },
    { href: "mcat-prep.html", label: "MCAT prep" },
    { href: "med-business-playbook.html", label: "Med+Business" },
    { href: "salaries.html", label: "Salaries" },
    { href: "parents.html", label: "Parents" },
    { href: "tag.html", label: "TAG" },
    { href: "news.html", label: "News" },
    { href: "international.html", label: "International" },
    { href: "this-week.html", label: "This week" },
    { href: "assumptions.html", label: "Assumptions" }
  ];

  function navHtml() {
    return LINKS.map(function (l) {
      return '<a href="' + l.href + '">' + l.label + "</a>";
    }).join("\n    ");
  }

  function ensureFooterCss() {
    if (document.getElementById("site-footer-css")) return;
    var style = document.createElement("style");
    style.id = "site-footer-css";
    style.textContent =
      ".site-footer{text-align:center;color:var(--muted,#5b6b7c);font-size:.82rem;padding:24px 16px 36px;line-height:1.55;max-width:820px;margin:0 auto}" +
      ".site-footer nav{display:flex;flex-wrap:wrap;gap:8px 14px;justify-content:center;margin-bottom:12px}" +
      ".site-footer nav a{color:var(--accent,#0f766e);font-weight:650;text-decoration:none}" +
      ".site-footer nav a:hover{text-decoration:underline}";
    document.head.appendChild(style);
  }

  function buildFooter(extraLine) {
    var foot = document.createElement("footer");
    foot.className = "site-footer";
    foot.innerHTML =
      '<nav aria-label="More pages">\n    ' +
      navHtml() +
      "\n  </nav>\n  <div>" +
      (extraLine ||
        "Planning tool · not official admissions advice<br>Always confirm deadlines and major rules on campus sites.") +
      "</div>";
    return foot;
  }

  function inject() {
    ensureFooterCss();
    var slot = document.getElementById("site-footer-slot");
    var extra = (slot && slot.getAttribute("data-extra")) || "";
    var foot = buildFooter(extra || undefined);

    if (slot) {
      slot.replaceWith(foot);
      return;
    }

    var existing = document.querySelector("footer.site-footer");
    if (existing) {
      var note = existing.querySelector("div");
      var keep = note ? note.innerHTML : "";
      var replacement = buildFooter(keep || undefined);
      existing.replaceWith(replacement);
      return;
    }

    document.body.appendChild(foot);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", inject);
  } else {
    inject();
  }
})();
