/* Thin i18n layer on top of Cockpit's gettext (base1/cockpit.js).
 *
 * Translations come from po/<lang>.po files, compiled to po.<lang>.js by
 * the build (tools/cockpit-po-plugin.js).  index.html loads `po.js`, which
 * cockpit-ws serves in the language of the Cockpit session — so the UI
 * language always follows the language chosen in Cockpit's settings.
 * That script calls cockpit.locale(), which fills cockpit.gettext() and
 * sets cockpit.language, before this module is ever used.
 *
 * The fallback everywhere is the English msgid itself. */

const cockpit = () => window.cockpit;

/* Current Cockpit session language, e.g. "ru" (falls back to "en"). */
export function lang() {
    return (cockpit() && cockpit().language) || "en";
}

/* Translate a string, filling {name} placeholders from `vars`. */
export function t(str, vars) {
    let s = cockpit() ? cockpit().gettext(str) : str;
    if (vars)
        for (const [k, v] of Object.entries(vars))
            s = s.split("{" + k + "}").join(String(v));
    return s;
}

/* Translate a string with a msgctxt qualifier (see tc in the .po files);
 * lets one English word have several translations by grammatical role. */
export function tc(context, str, vars) {
    let s = cockpit() ? cockpit().gettext(context, str) : str;
    if (vars)
        for (const [k, v] of Object.entries(vars))
            s = s.split("{" + k + "}").join(String(v));
    return s;
}

/* Plural form: cockpit.ngettext picks the right msgstr for `n` according
 * to the language's Plural-Forms formula; placeholders are filled after. */
export function tn(n, singular, plural, vars) {
    let s = cockpit() ? cockpit().ngettext(singular, plural, n) : (n === 1 ? singular : plural);
    if (vars)
        for (const [k, v] of Object.entries(vars))
            s = s.split("{" + k + "}").join(String(v));
    return s;
}

/* Keep the document language attribute in sync with the Cockpit session. */
export function initI18n() {
    document.documentElement.lang = lang();
}
