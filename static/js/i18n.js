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
        "sheets.description": "Eine persönliche Referenz für häufig verwendete Linux-Befehle und Systemadministrationsaufgaben.",

        "about.body": "<p>Ich bin Aleksandar, ein Linux-Enthusiast mit großem Interesse an technischem Support und Systemadministration.</p>\n<p>Ich lerne gerne, wie Systeme funktionieren, löse praktische Probleme und baue zuverlässige Linux-Workflows für den Alltag auf. Diese Seite ist meine persönliche Referenz für Befehle, Tools und Administrationsnotizen, die ich oft nutze und wieder aufsuche.</p>\n<p>Neben der Technik begeistere ich mich für Fitness und Radfahren. Beides hilft mir, fokussiert, diszipliniert und neugierig zu bleiben - die gleiche Einstellung, die ich beim Lernen und Arbeiten mit Technologie mitbringe.</p>",

        "card.100-linux-commands.description": "Eine kuratierte Auswahl von 100 essenziellen Linux-Befehlen für Sysadmins und Power-User, nach Kategorien gruppiert mit praktischen Beispielen und Sicherheitshinweisen.",
        "card.bash-scripting-basics-cheat-sheet.description": "Praktische Bash-Skripte schreiben: Variablen, Quoting, Argumente, Bedingungen, Schleifen, Funktionen, Arrays, Exit-Codes und die Sicherheits-Flags, mit denen jedes Skript beginnen sollte.",
        "card.cat-cheat-sheet.description": "Praktische Anwendungen von cat: Dateien anzeigen, Zeilen nummerieren, Steuerzeichen sichtbar machen und Dateien zusammenführen.",
        "card.crontab-cheat-sheet.description": "Wiederkehrende Jobs mit cron planen: crontab-Syntax, Zeitausdrücke, Sonderwerte, Logging, MAILTO und sicheres Locking mit flock.",
        "card.docker-cheat-sheet.description": "Docker-Images und Container ausführen, bauen und verwalten, dazu Volumes, Netzwerke, Compose-Grundlagen und sicheres Aufräumen.",
        "card.find-cheat-sheet.description": "Dateien mit find nach Name, Typ, Größe, Zeit, Besitzer und Berechtigungen finden und mit grep kombinieren, um Dateiinhalte zu durchsuchen.",
        "card.grep-cheat-sheet.description": "Text mit grep durchsuchen: rekursiv, ohne Groß-/Kleinschreibung, ganzes Wort, invertiert und mit Regex-Matching, mit Beispielen aus /etc und Log-Dateien.",
        "card.iptables-firewalld-cheat-sheet.description": "Linux-Firewall-Regeln direkt mit iptables verwalten oder über die Zonen von firewalld auf Fedora/RHEL, ohne sich selbst auszusperren.",
        "card.journalctl-cheat-sheet.description": "Das systemd-Journal mit journalctl lesen und filtern: nach Dienst, Zeitraum, Priorität und Boot, Logs live verfolgen und den Speicherplatz des Journals verwalten.",
        "card.linux-disk-check.description": "Speicherplatz, Partitionen und eingehängte Dateisysteme mit df, du, lsblk, mount, fdisk und blkid überprüfen.",
        "card.linux-file-permissions.description": "ls -l-Ausgaben lesen, Berechtigungsklassen und oktale Modi verstehen, chmod und chown sicher einsetzen und mit SUID, SGID, Sticky-Bit, umask und ACLs arbeiten.",
        "card.linux-file-system-hierarchy.description": "Eine praktische Referenz zur Linux-Dateisystemhierarchie: wofür jedes Top-Level-Verzeichnis da ist, virtuelle Dateisysteme, usr-merge und die Fehlersuche bei vollen Festplatten.",
        "card.log-troubleshooting-cheat-sheet.description": "Ein praktischer Workflow zur Fehlersuche mit Klartext-Logs in /var/log: wo man zuerst nachsieht, schnelles Tailing und Suchen, das Korrelieren von Logs über mehrere Dienste hinweg, Log-Rotation und die Wiederherstellung bei voller Festplatte.",
        "card.nginx-multiple-websites-server.description": "Nginx-Server-Blocks, PHP-FPM, MySQL und WordPress für eine oder mehrere Websites unter Ubuntu einrichten.",
        "card.package-management-cheat-sheet.description": "Pakete installieren, aktualisieren, entfernen und suchen auf Debian/Ubuntu (apt) und RHEL/Fedora (dnf), im direkten Vergleich.",
        "card.rsync-cheat-sheet.description": "Dateien und Verzeichnisse lokal oder über SSH mit rsync synchronisieren: zentrale Flags, Ausschlüsse, Probeläufe, Sicherheit beim Löschen, Bandbreitenlimits und Backup-Rezepte.",
        "card.sed-awk-cheat-sheet.description": "Textströme mit sed bearbeiten (Ersetzen, Löschen, In-Place-Bearbeitung, Adressierung) und Spalten mit awk verarbeiten (Felder, Muster, eingebaute Variablen, One-Liner).",
        "card.ssh-cheat-sheet.description": "Verbinden, mit Schlüsseln authentifizieren, ~/.ssh/config konfigurieren, Dateien übertragen, Ports tunneln und sshd sicher härten.",
        "card.systemctl.description": "Nützliche systemctl-Befehle zur Verwaltung von Linux-Diensten.",
        "card.tar-compression-cheat-sheet.description": "tar-Archive erstellen, extrahieren und untersuchen, mit gzip/bzip2/xz-Kompression kombinieren und mit zip arbeiten - mit den Flags, die im Alltag wirklich wichtig sind.",
        "card.ufw-firewall-cheat-sheet.description": "UFW unter Ubuntu/Debian sicher einrichten: zuerst SSH erlauben, Standardrichtlinien festlegen, Web-Ports öffnen, App-Profile nutzen und Fehler beheben.",
        "card.vim-neovim-cheat-sheet.description": "Zentrale modale Vim-Befehle, die in Vim und Neovim identisch funktionieren, plus die tatsächlichen Unterschiede zwischen beiden - Konfigurationsdateien, LSP-Unterstützung und das Plugin-Ökosystem.",
        "card.wordpress-nginx-troubleshooting-cheat-sheet.description": "Runbook von Symptom zu Lösung für WordPress hinter Nginx und PHP-FPM unter Ubuntu: Gateway-Fehler, Berechtigungen, Datenbankprobleme, TLS, Performance und Server-Wartung."
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
