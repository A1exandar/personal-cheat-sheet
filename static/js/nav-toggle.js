/*
 * Mobile hamburger menu - toggles the dropdown version of the shared
 * `nav` (see the @media (max-width: 900px) rules in style.css). Separate
 * file from i18n.js since this is an unrelated concern (menu open/close,
 * not language switching).
 */
(function () {
    var toggle = document.querySelector("[data-nav-toggle]");
    var nav = document.getElementById("site-nav");
    if (!toggle || !nav) return;

    function setOpen(open) {
        nav.classList.toggle("nav-open", open);
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
    }

    toggle.addEventListener("click", function () {
        setOpen(!nav.classList.contains("nav-open"));
    });

    nav.addEventListener("click", function (e) {
        if (e.target.tagName === "A") {
            setOpen(false);
        }
    });
})();
