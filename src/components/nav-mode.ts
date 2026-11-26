// tasks/plan-ui.md U19: the wide sidebar folded to a rail or unfolded, remembered on this browser. Not a client module:
// the root layout inlines NAV_SCRIPT, so <html data-nav="rail"> is set before the first paint and the CSS (globals.css
// `rail:`) lays the sidebar out without a flash or a shift. Unfolded is the default; storage may be refused (private mode).
export const NAV_KEY = "nav-rail";
export const NAV_SCRIPT = `try{if(localStorage.getItem("${NAV_KEY}")==="1")document.documentElement.dataset.nav="rail"}catch(e){}`;
