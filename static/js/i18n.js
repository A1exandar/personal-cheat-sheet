/*
 * Client-side UI language toggle (English/German). Only chrome text - nav,
 * hero copy, footer status, the /sheets intro line - is translated; cheat
 * sheet article content always stays English, so it's never touched here.
 * English is always the server-rendered default (source of truth); German
 * strings are swapped in on top of it and the original is restored when
 * switching back, so there's no risk of the two drifting apart.
 */
(function () {
    var de = {
        "nav.home": "./start",
        "nav.about": "./über-mich",
        "hero.personal": "Persönliches",
        "hero.description": "Praktische Notizen, Befehle und Lösungen<br>für Linux, Infrastruktur und Automatisierung.",
        "footer.ready": "Bereit.",
        "sheets.description": "Eine persönliche Referenz für häufig verwendete Linux-Befehle und Systemadministrationsaufgaben."
    };

    var STORAGE_KEY = "site-lang";

    function getStoredLang() {
        try {
            return localStorage.getItem(STORAGE_KEY);
        } catch (e) {
            return null;
        }
    }

    function setStoredLang(lang) {
        try {
            localStorage.setItem(STORAGE_KEY, lang);
        } catch (e) {
            /* private browsing / storage blocked - toggle still works for this page view */
        }
    }

    function apply(lang) {
        document.documentElement.setAttribute("lang", lang);

        document.querySelectorAll("[data-i18n]").forEach(function (el) {
            var key = el.getAttribute("data-i18n");
            if (el.dataset.i18nOriginal === undefined) {
                el.dataset.i18nOriginal = el.innerHTML;
            }
            if (lang === "de" && de[key] !== undefined) {
                el.innerHTML = de[key];
            } else {
                el.innerHTML = el.dataset.i18nOriginal;
            }
        });

        var toggle = document.querySelector("[data-lang-toggle]");
        if (toggle) {
            toggle.textContent = lang === "de" ? "EN" : "DE";
            toggle.setAttribute("aria-label", lang === "de" ? "Switch to English" : "Auf Deutsch umschalten");
        }
    }

    var currentLang = getStoredLang() === "de" ? "de" : "en";
    apply(currentLang);

    document.addEventListener("click", function (e) {
        var toggle = e.target.closest("[data-lang-toggle]");
        if (!toggle) return;
        currentLang = currentLang === "de" ? "en" : "de";
        setStoredLang(currentLang);
        apply(currentLang);
    });
})();
