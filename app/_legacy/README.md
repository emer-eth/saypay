# Legacy React UI

The previous in-app React screens (composer, profile, activity, etc.) were retired
from the home route so they cannot interfere with the design artifact.

Product UI: `public/saypay-ui.html` + host bridge `app/design-shell.tsx`.
Home route: `app/page.tsx` → DesignShell only.

Request/split public pay pages remain under `app/request` and `app/split`.
