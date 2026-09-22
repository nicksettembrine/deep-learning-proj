# Submission checklist

Due September 21, 2026 at 11:59 PM Eastern. Submit the GitHub repository link and a live demo video of at most three minutes through Canvas.

## Before recording

- Start both servers using README.md. Open the viewer and confirm a recording loads.
- Practice adding one annotation and reloading to confirm it persists.
- Keep the browser at a readable size and enable microphone recording.
- Use the outline below as talking points, in your own words.

## Demo outline (aim for 2:40)

**0:00–0:20 — Introduce the project.**
“This is Sleep Signal Viewer. It displays heart rate and wrist acceleration from the BIDSleep dataset alongside EEG sleep-stage labels.”

**0:20–1:00 — Explore the data.**
Select another participant or night. Drag to zoom and double-click to reset. Switch to Overlay and toggle signals. Explain that the measurements share a time axis but have different units.

**1:00–1:50 — Annotate.**
Click Add annotation, drag to mark an interval, enter a label such as “Movement spike,” and save. Click the saved label to revisit the interval. Briefly demonstrate editing.

**1:50–2:20 — Demonstrate persistence.**
Reload the browser and show the saved annotation still appears. Explain: “The React frontend sends annotations to a Python FastAPI backend, which stores them in a local SQLite database.” Select the same recording again if needed after reload.

**2:20–2:40 — Explain the next step.**
“A future model could estimate sleep stages from heart rate and movement using the EEG labels as targets. This version focuses on viewing and annotating the data.”

## GitHub and final submission

- Upload source code, README, dependency files, and prepared public/data samples.
- Do not upload raw data, node_modules, .venv, secrets, or the local annotation database. These are excluded in .gitignore.
- Verify the repository opens for the instructor. If private, grant the required access.
- Test the README instructions from a separate checkout before submission.
- Watch the video: confirm audio, readable text, duration under three minutes, annotation creation, and persistence after reload.
- Submit the repository URL and video through the Canvas assignment Dropbox.
- Verify Canvas shows the submission and that the video can be played.

## Know your project

- Frontend: React with Vite; Plotly displays the signals.
- Data: BIDSleep on PhysioNet, a prepared sample of two participants and four nights.
- Preprocessing: Python exports JSON; acceleration magnitude is averaged into one-second bins for display.
- Backend: FastAPI validates and stores annotations using SQLite.
- Files: src/App.jsx (viewer), src/AnnotationPanel.jsx (form/list), src/useAnnotations.js (annotation state/API), backend/app.py (API/database).
- Start: two terminals, one for Uvicorn and one for npm run dev; see README.

Local validation completed: frontend lint/build and backend persistence/validation tests passed. A fresh-checkout installation and Canvas submission still need verification.
