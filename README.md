# XBIT Walkthrough Dashboard

Pure static deployment for the XBIT Walkthrough Dashboard.

## CSV update flow

1. Export the Confluence Database as CSV.
2. Replace `data/walkthrough.csv`.
3. Run `npm run generate`.
4. Commit and push the updated CSV and generated `index.html`.

`index.html` contains the pre-rendered dashboard data, so mobile browsers can show the default Chinese view even if client-side JavaScript is blocked.
